// Independent archive peer using the existing ordinary value codec. It never
// imports native implementation code or treats an archive as execution authority.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {decodeSchema, decodeValue, encodeValue} from '../../runtime/values.mjs';
import {loadWorldRuntime} from '../../runtime/world.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest();
const key = reference => Buffer.from(reference[0]).toString('hex');
const taskFields = ['id', 'application_id', 'input_schema_id', 'output_schema_id', 'failure_schema_id', 'message_schema_id', 'principal', 'tenant', 'profile_id', 'profile', 'resources', 'image', 'runtime_identity', 'input', 'checkpoint', 'outcome', 'outcome_kind', 'current_occurrence', 'revision', 'execution_revision', 'schedule', 'cancellation', 'cancellation_applied', 'blocker', 'result', 'client_result', 'result_artifact', 'event_floor', 'event_high', 'next_message', 'messages', 'inference_attempts', 'inference_request_bytes', 'inference_output_tokens', 'evidence_bytes'];

export function readArchive(bytes) {
  assert.equal(bytes.subarray(0, 8).toString(), 'AGNX0001');
  const schemaLength = bytes.readUInt32LE(8), manifestLength = bytes.readUInt32LE(12);
  assert(schemaLength <= 65536 && manifestLength <= 1048576);
  assert.equal(bytes.readUInt32LE(20), 0);
  const schemaBytes = bytes.subarray(32, 32 + schemaLength);
  const schema = decodeSchema(schemaBytes);
  const manifest = decodeValue(schema, bytes.subarray(32 + schemaLength, 32 + schemaLength + manifestLength));
  assert.equal(manifest.length, 11);
  assert.deepEqual(manifest.slice(0, 3), [1, 0, 0]);
  const [,,, taskReference, buildReference, definitions,,,,, references] = manifest;
  assert.equal(references.length, bytes.readUInt32LE(16));
  let offset = 32 + schemaLength + manifestLength;
  assert.equal(BigInt(bytes.length - offset), bytes.readBigUInt64LE(24));
  const objects = new Map();
  let previous = '';
  for (const reference of references) {
    const digest = key(reference), length = Number(reference[1]);
    assert(Number.isSafeInteger(length) && length >= 0 && length <= 16 * 1024 * 1024);
    assert(previous < digest);
    const value = bytes.subarray(offset, offset + length);
    assert.equal(value.length, length);
    assert.equal(hash(value).toString('hex'), digest);
    objects.set(digest, value);
    offset += length;
    previous = digest;
  }
  assert.equal(offset, bytes.length);
  const object = reference => {
    const bytes = objects.get(key(reference));
    assert(bytes, 'missing independent archive object');
    assert.equal(BigInt(bytes.length), reference[1]);
    return bytes;
  };
  const schemas = new Map(definitions.map(([name, reference]) => [name, decodeSchema(object(reference))]));
  assert.deepEqual([...schemas.keys()], ['task', 'event', 'receipt', 'occurrence', 'question', 'message', 'artifact', 'capture', 'attempt', 'origin']);
  const taskValue = decodeValue(schemas.get('task'), object(taskReference));
  assert.equal(taskValue.length, taskFields.length);
  const task = Object.fromEntries(taskFields.map((name, index) => [name, taskValue[index]]));
  const build = JSON.parse(object(buildReference));
  assert.equal(object(task.image).subarray(0, 8).toString(), 'ABL_BPI3');
  assert.equal(object(task.checkpoint).subarray(0, 8).toString(), 'ABL_PST3');
  assert.equal(object(task.outcome).subarray(0, 8).toString(), 'ABL_PKO3');
  assert.equal(key(task.image), build.program_sha256);
  return {schemaBytes, schema, manifest, objects, schemas, taskValue, task, build, object};
}

function encode(archive) {
  const references = [...archive.objects].sort(([left], [right]) => left.localeCompare(right)).map(([digest, bytes]) => [[...Buffer.from(digest, 'hex')], BigInt(bytes.length)]);
  archive.manifest[10] = references;
  const manifest = Buffer.from(encodeValue(archive.schema, archive.manifest));
  const body = references.map(reference => archive.objects.get(key(reference)));
  const header = Buffer.alloc(32);
  header.write('AGNX0001');
  header.writeUInt32LE(archive.schemaBytes.length, 8);
  header.writeUInt32LE(manifest.length, 12);
  header.writeUInt32LE(references.length, 16);
  header.writeBigUInt64LE(BigInt(body.reduce((n, bytes) => n + bytes.length, 0)), 24);
  return Buffer.concat([header, archive.schemaBytes, manifest, ...body]);
}
function replace(archive, oldReference, bytes) {
  if (oldReference) archive.objects.delete(key(oldReference));
  const digest = hash(bytes);
  archive.objects.set(digest.toString('hex'), bytes);
  return [[...digest], BigInt(bytes.length)];
}
export function missingCheckpoint(bytes) {
  const archive = readArchive(bytes);
  archive.objects.delete(key(archive.task.checkpoint));
  return encode(archive);
}

export function cancellationState(bytes, applied, reason = null) {
  const archive = readArchive(bytes);
  archive.taskValue[taskFields.indexOf('cancellation')] = reason === null ? {tag: 0, value: null} : {tag: 1, value: reason};
  archive.taskValue[taskFields.indexOf('cancellation_applied')] = applied;
  archive.manifest[3] = replace(archive, archive.manifest[3], Buffer.from(encodeValue(archive.schemas.get('task'), archive.taskValue)));
  return encode(archive);
}

export function retainedEventSuffix(bytes, floor) {
  const archive = readArchive(bytes);
  assert(floor > archive.task.event_floor && floor <= archive.task.event_high);
  const removed = archive.manifest[7].filter(row => row[0] < floor);
  assert(removed.length > 0);
  archive.manifest[7] = archive.manifest[7].filter(row => row[0] >= floor);
  for (const row of removed) archive.objects.delete(key(row[2]));
  archive.taskValue[taskFields.indexOf('event_floor')] = floor;
  archive.manifest[3] = replace(archive, archive.manifest[3], Buffer.from(encodeValue(archive.schemas.get('task'), archive.taskValue)));
  return encode(archive);
}
export function changedProfile(bytes) {
  const archive = readArchive(bytes);
  const profile = JSON.parse(archive.object(archive.task.profile));
  archive.taskValue[9] = replace(archive, null, Buffer.from(JSON.stringify({...profile, changed_profile: true})));
  archive.manifest[3] = replace(archive, archive.manifest[3], Buffer.from(encodeValue(archive.schemas.get('task'), archive.taskValue)));
  return encode(archive);
}
export function unknownOccurrence(bytes) {
  const archive = readArchive(bytes);
  assert.equal(archive.task.current_occurrence.tag, 1);
  const id = Buffer.from(archive.task.current_occurrence.value).toString('hex');
  const row = archive.manifest[6].find(([kind, rowId]) => kind === 0 && Buffer.from(rowId).toString('hex') === id);
  assert(row);
  const value = decodeValue(archive.schemas.get('occurrence'), archive.object(row[2]));
  assert.equal(value[3].tag, 2); // durable human waiting
  value[3] = {tag: 3, value: [value[3].value[0]]}; // unknown attempt
  row[2] = replace(archive, row[2], Buffer.from(encodeValue(archive.schemas.get('occurrence'), value)));
  return encode(archive);
}

export function missingReplayObject(bytes) {
  const archive = readArchive(bytes);
  const row = archive.manifest[6].find(([kind]) => kind === 4); // capture
  assert(row);
  const capture = decodeValue(archive.schemas.get('capture'), archive.object(row[2]));
  assert.equal(capture[6].tag, 1);
  const [reference] = capture[6].value[1];
  assert(reference, 'recorded provider reply must retain replay data');
  archive.objects.delete(key(reference));
  return encode(archive);
}

export function missingCaptures(bytes, change = 'all') {
  const archive = readArchive(bytes);
  assert.equal(archive.task.inference_output_tokens, 0n, 'absent usage must not mask capture completeness');
  const captures = archive.manifest[6].filter(([kind]) => kind === 4);
  assert(captures.length > 1);
  const removed = change === 'all' ? captures : captures.slice(0, 1);
  for (const row of removed) {
    const capture = decodeValue(archive.schemas.get('capture'), archive.object(row[2]));
    assert.equal(capture[4].tag, 1);
    assert.equal(capture[6].tag, 1);
    archive.objects.delete(key(row[2]));
    archive.objects.delete(key(capture[4].value));
    for (const reference of capture[6].value[1]) archive.objects.delete(key(reference));
    archive.manifest[6] = archive.manifest[6].filter(candidate => candidate !== row);
    if (change === 'prepared-marker') {
      const attempt = archive.manifest[6].find(([kind, id]) => kind === 5 && Buffer.from(id).equals(Buffer.from(row[1])));
      assert(attempt);
      const value = decodeValue(archive.schemas.get('attempt'), archive.object(attempt[2]));
      assert.equal(value[7].tag, 1);
      // Prepared bytes remain charged in the task counter. Preserve the byte
      // total so this sibling reaches handler/attempt coherence admission.
      archive.taskValue[taskFields.indexOf('inference_request_bytes')] += value[3][1] - value[7].value[1];
      archive.objects.delete(key(value[7].value));
      value[7] = {tag: 0, value: null};
      attempt[2] = replace(archive, attempt[2], Buffer.from(encodeValue(archive.schemas.get('attempt'), value)));
      archive.manifest[3] = replace(archive, archive.manifest[3], Buffer.from(encodeValue(archive.schemas.get('task'), archive.taskValue)));
    }
  }
  return encode(archive);
}

export function invalidQueuedMessage(bytes, change) {
  const archive = readArchive(bytes);
  assert.equal(archive.task.messages.length, 1);
  const id = Buffer.from(archive.task.messages[0]).toString('hex');
  const row = archive.manifest[6].find(([kind, identity]) => kind === 2 && Buffer.from(identity).toString('hex') === id);
  assert(row);
  const message = decodeValue(archive.schemas.get('message'), archive.object(row[2]));
  assert.equal(message.length, 7);
  assert.equal(message[5], 0); // queued
  assert.equal(message[6].tag, 0); // unbound
  assert.equal(archive.task.current_occurrence.tag, 1);
  switch (change) {
    case 'omitted':
    case 'omitted-acquired':
    case 'omitted-record':
      archive.taskValue[taskFields.indexOf('messages')] = [];
      archive.manifest[3] = replace(archive, archive.manifest[3], Buffer.from(encodeValue(archive.schemas.get('task'), archive.taskValue)));
      if (change === 'omitted-record') {
        archive.manifest[6] = archive.manifest[6].filter(candidate => candidate !== row);
        archive.objects.delete(key(row[2]));
        archive.objects.delete(key(message[4]));
        return encode(archive);
      }
      if (change === 'omitted-acquired') message[5] = 1;
      break;
    case 'acquired-unbound': message[5] = 1; break;
    case 'queued-bound': message[6] = {tag: 1, value: archive.task.current_occurrence.value}; break;
    case 'acquired-question': message[5] = 1; message[6] = {tag: 1, value: archive.task.current_occurrence.value}; break;
    case 'consumed': message[5] = 2; break;
    case 'not-consumed': message[5] = 3; break;
    case 'schema': message[3] = 'other.message.v1'; break;
    case 'ordinal-zero': message[2] = 0n; break;
    case 'ordinal-future': message[2] = archive.task.next_message; break;
    case 'payload': message[4] = replace(archive, message[4], Buffer.from([255])); break;
    case 'admission-payload': {
      const payload = archive.object(message[4]);
      const changed = Buffer.from(payload);
      assert(changed.includes(Buffer.from('Include')));
      changed[changed.indexOf(Buffer.from('Include'))] = 'E'.charCodeAt(0);
      message[4] = replace(archive, message[4], changed);
      break;
    }
    default: throw new Error(`unknown queue mutation: ${change}`);
  }
  row[2] = replace(archive, row[2], Buffer.from(encodeValue(archive.schemas.get('message'), message)));
  return encode(archive);
}

export function invalidConsumedMessage(bytes, change) {
  const archive = readArchive(bytes);
  const row = archive.manifest[6].find(([kind,, ref]) => kind === 2 && decodeValue(archive.schemas.get('message'), archive.object(ref))[5] === 2);
  assert(row, 'fixture must retain a consumed message');
  const message = decodeValue(archive.schemas.get('message'), archive.object(row[2]));
  assert.equal(message[6].tag, 1);
  if (change === 'dangling-occurrence') message[6].value = Array(32).fill(253);
  else if (change === 'requeued') {
    message[5] = 0;
    message[6] = {tag: 0, value: null};
    archive.taskValue[taskFields.indexOf('messages')] = [message[0]];
    archive.manifest[3] = replace(archive, archive.manifest[3], Buffer.from(encodeValue(archive.schemas.get('task'), archive.taskValue)));
  } else throw new Error(change);
  row[2] = replace(archive, row[2], Buffer.from(encodeValue(archive.schemas.get('message'), message)));
  return encode(archive);
}

export function changedOperationKey(bytes, change = 'key') {
  const archive = readArchive(bytes);
  const row = archive.manifest[8].find(row => decodeValue(archive.schemas.get('receipt'), archive.object(row[2]))[2] === 0);
  assert(row, 'fixture must retain submission receipt');
  if (change === 'omitted') {
    archive.manifest[8] = archive.manifest[8].filter(item => item !== row);
    archive.objects.delete(key(row[2]));
  } else row[0] = 'f'.repeat(64);
  archive.manifest[8].sort((a, b) => a[0].localeCompare(b[0]));
  return encode(archive);
}
export function invalidEventData(bytes, change) {
  const archive = readArchive(bytes);
  const row = archive.manifest[7].find(row => decodeValue(archive.schemas.get('event'), archive.object(row[2]))[3] === (change === 'question-counter' ? 1 : 0));
  assert(row);
  const value = decodeValue(archive.schemas.get('event'), archive.object(row[2]));
  const payload = JSON.parse(Buffer.from(value[4]).toString());
  const replacement = change === 'null' ? null : change === 'extra-field' ? {extra: true} : {...payload, question_revision: 1};
  value[4] = [...Buffer.from(JSON.stringify(replacement))];
  row[2] = replace(archive, row[2], Buffer.from(encodeValue(archive.schemas.get('event'), value)));
  return encode(archive);
}

// Keep the event schema, task/sequence/revision and every object digest valid,
// but contradict a retained fact. These independently encoded archives exercise
// admission rather than the producer's projection helper.
export function falseEventFact(bytes, change) {
  const archive = readArchive(bytes);
  const question = change.startsWith('question-');
  const message = change.startsWith('message-');
  const admission = change.startsWith('admission-');
  const answerRevision = change === 'answer-revision';
  const imported = change === 'import-origin';
  const row = archive.manifest[7].find(row => decodeValue(archive.schemas.get('event'), archive.object(row[2]))[3] === (question || admission ? 1 : message ? 3 : answerRevision ? 2 : imported ? 14 : 0));
  assert(row);
  const value = decodeValue(archive.schemas.get('event'), archive.object(row[2]));
  let payload = JSON.parse(Buffer.from(value[4]).toString());
  if (admission) {
    const kind = change.slice('admission-'.length);
    value[3] = ({accepted: 0, input_accepted: 2, cancellation_requested: 6, resumed: 8, imported: 14})[kind];
    assert.notEqual(value[3], undefined);
    payload = kind === 'imported' ? {archive_sha256: 'f'.repeat(64)} : {};
  } else if (answerRevision || change === 'message-admission-revision') {
    const previous = archive.manifest[7][archive.manifest[7].indexOf(row) - 1];
    assert(previous && previous[1] < row[1]);
    row[1] = value[2] = previous[1];
  } else if (imported) {
    payload.archive_sha256 = 'f'.repeat(64);
  } else if (question) {
    const field = change.slice('question-'.length);
    payload[field] = ({question_id: 'f'.repeat(64), question_revision: '2', request_digest: 'e'.repeat(64), answer_schema_id: 'false.answer.v1', prompt: {false_prompt: true}})[field];
    assert.notEqual(payload[field], undefined);
  } else if (message) {
    const field = change.slice('message-'.length);
    if (field === 'false-consumption') {
      value[3] = 4;
      payload.disposition = 'consumed';
    } else {
      payload[field] = ({message_id: 'f'.repeat(64), ordinal: '999', disposition: 'not_consumed'})[field];
      assert.notEqual(payload[field], undefined);
    }
  } else {
    value[3] = ({completed: 11, failed: 12, cancelled: 13})[change];
    assert.notEqual(value[3], undefined);
  }
  value[4] = [...Buffer.from(JSON.stringify(payload))];
  row[2] = replace(archive, row[2], Buffer.from(encodeValue(archive.schemas.get('event'), value)));
  return encode(archive);
}

// Resume the actual repository checkpoint using its recorded native replies.
// World owns both PKI3 encoding and execution; no provider/application policy is
// reproduced here. The existing native API probe accepts the same envelope.
export async function compareContinuation(runtimePath, probe, inputPath, pendingBytes, completedBytes) {
  const pending = readArchive(pendingBytes), completed = readArchive(completedBytes);
  const quantum = 256; // same non-cancellation quantum as the native task owner
  const runtime = await loadWorldRuntime({runtimePath, quantum, limits: {input: 4 * 1024 * 1024, working: 16 * 1024 * 1024, output: 4 * 1024 * 1024}});
  const world = await import(pathToFileURL(runtime.identity.entrypoint).href);
  const image = pending.object(pending.task.image);
  assert.deepEqual(image, completed.object(completed.task.image));
  const replies = new Map();
  for (const [kind,, reference] of completed.manifest[6]) {
    if (kind !== 0) continue;
    const occurrence = decodeValue(completed.schemas.get('occurrence'), completed.object(reference));
    assert.equal(occurrence[3].tag, 5); // admitted
    assert.equal(occurrence[3].value.tag, 0); // reply
    const request = Buffer.from(occurrence[2]).toString('hex');
    assert(!replies.has(request));
    replies.set(request, completed.objects.get(Buffer.from(occurrence[3].value.value[1]).toString('hex')));
  }
  // Boundary's public Result is a fixed digest followed by ordinary bytes.
  const resultSchema = {root: 0, types: [{product: [1, 3]}, {array: {element: 2, length: 32}}, 'u8', 'bytes']};
  let current = runtime.decodeOutcome(pending.object(pending.task.outcome));
  let state = pending.object(pending.task.checkpoint), wasmSteps = 0, nativeSteps = 0, requested = 0;
  let pairedWasmMilliseconds = 0, nativeProcessMilliseconds = 0;
  const nativeRuntimeSamples = [];
  const trace = [];
  while (['progressed', 'yielded', 'requested'].includes(current.kind)) {
    assert(wasmSteps < 128, 'bounded recorded continuation');
    let expected, control, bound, wasmMilliseconds;
    if (current.kind === 'requested') {
      const {request} = await runtime.inspectPending(current);
      bound = replies.get(Buffer.from(request.requestIdentity).toString('hex'));
      assert(bound, 'every replayed effect must match an actual native occurrence');
      assert.equal(bound.subarray(0, 8).toString(), 'ABL_ERS3');
      assert.equal(bound.readUInt16LE(8), 3);
      assert.equal(bound.readUInt16LE(10), 0);
      assert.equal(bound.readBigUInt64LE(12), BigInt(bound.length - 20));
      const [identity, value] = decodeValue(resultSchema, bound.subarray(20));
      assert.deepEqual(Buffer.from(identity), Buffer.from(request.requestIdentity));
      const started = performance.now();
      expected = await runtime.resume(image, state, current.request, value);
      wasmMilliseconds = performance.now() - started;
      control = 'reply';
      trace.push(request.semanticIdentity);
      requested++;
    } else {
      const started = performance.now();
      expected = await runtime.continueExecution(image, current);
      wasmMilliseconds = performance.now() - started;
      control = current.kind === 'yielded' ? 'resume_yield' : 'none';
    }
    wasmSteps++;
    if (wasmSteps === 1) current = expected;
    else {
      writeFileSync(inputPath, world.encodeInput({image, state, control, quantum, ...(bound ? {value: bound} : {})}));
      const started = performance.now();
      const result = spawnSync(probe, ['invoke', inputPath], {env: {PATH: '/nonexistent'}, timeout: 30000, maxBuffer: 4 * 1024 * 1024});
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stderr.toString());
      assert.equal(result.signal, null);
      current = runtime.decodeOutcome(result.stdout);
      nativeProcessMilliseconds += performance.now() - started;
      nativeRuntimeSamples.push(JSON.parse(result.stderr.toString()));
      pairedWasmMilliseconds += wasmMilliseconds;
      assert.deepEqual(Buffer.from(current.bytes), Buffer.from(expected.bytes));
      nativeSteps++;
    }
    if (current.state) state = current.state;
  }
  assert(nativeSteps > 0 && requested >= 3, 'exercise native/WASM/native question, inbox and provider continuation');
  assert.equal(current.kind, 'completed');
  assert.deepEqual(Buffer.from(current.bytes), completed.object(completed.task.outcome));
  return {wasm_steps: wasmSteps, native_steps: nativeSteps, recorded_effects: trace,
    program_bytes: image.length, frozen_resource_bytes: pending.task.resources.reduce((total, reference) => total + Number(reference[1]), 0), checkpoint_bytes: Number(pending.task.checkpoint[1]), native_runtime_samples: nativeRuntimeSamples,
    paired_runtime: {steps: nativeSteps, quantum, wasm_inprocess_ms: pairedWasmMilliseconds, native_process_ms: nativeProcessMilliseconds,
      scope: 'recorded-reply harness; native includes process launch, input read, prepare/restore and output decode; neither includes provider or durable host storage'}};
}

// Rebuild the independently decoded native reference closure after omission.
// Acquired replies are the one digest-only object edge in these record schemas.
function pruneObjects(archive) {
  const retained = new Set();
  const visit = value => {
    if (Array.isArray(value)) {
      if (value.length === 2 && Array.isArray(value[0]) && value[0].length === 32 && typeof value[1] === 'bigint') retained.add(key(value));
      else value.forEach(visit);
    } else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(archive.manifest.slice(3, 10));
  visit(archive.taskValue);
  const kinds = ['occurrence', 'question', 'message', 'artifact', 'capture', 'attempt', 'origin'];
  for (const [kind,, reference] of archive.manifest[6]) {
    const value = decodeValue(archive.schemas.get(kinds[kind]), archive.object(reference));
    visit(value);
    if (kind === 0) {
      const state = value[3];
      const reply = state.tag === 4 ? state.value : state.tag === 5 && state.value.tag === 0 ? state.value.value : null;
      if (reply) retained.add(Buffer.from(reply[1]).toString('hex'));
    }
  }
  for (const row of archive.manifest[7]) visit(decodeValue(archive.schemas.get('event'), archive.object(row[2])));
  for (const row of archive.manifest[8]) visit(decodeValue(archive.schemas.get('receipt'), archive.object(row[2])));
  for (const digest of archive.objects.keys()) if (!retained.has(digest)) archive.objects.delete(digest);
}

export function omittedAttempts(bytes) {
  const archive = readArchive(bytes);
  assert(archive.manifest[6].some(([kind]) => kind === 5));
  archive.manifest[6] = archive.manifest[6].filter(([kind]) => kind !== 4 && kind !== 5);
  archive.manifest[9] = [];
  for (const field of ['inference_attempts', 'inference_request_bytes']) archive.taskValue[taskFields.indexOf(field)] = field === 'inference_attempts' ? 0 : 0n;
  archive.manifest[3] = replace(archive, archive.manifest[3], Buffer.from(encodeValue(archive.schemas.get('task'), archive.taskValue)));
  pruneObjects(archive);
  return encode(archive);
}

export function omittedQuestion(bytes, removeOccurrence = false) {
  const archive = readArchive(bytes);
  const row = archive.manifest[6].find(([kind]) => kind === 1);
  assert(row);
  const question = decodeValue(archive.schemas.get('question'), archive.object(row[2]));
  assert.equal(question[12], true, 'historical question must be retired');
  const id = Buffer.from(question[2]);
  archive.manifest[6] = archive.manifest[6].filter(candidate => candidate !== row && !(removeOccurrence && candidate[0] === 0 && Buffer.from(candidate[1]).equals(id)));
  pruneObjects(archive);
  return encode(archive);
}

export function unboundQuestionReply(bytes) {
  const archive = readArchive(bytes);
  const row = archive.manifest[6].find(([kind, id]) => kind === 0 && Buffer.from(id).equals(Buffer.from(archive.task.current_occurrence.value)));
  assert(row);
  const value = decodeValue(archive.schemas.get('occurrence'), archive.object(row[2]));
  assert.equal(value[3].tag, 2);
  const payload = encodeValue({root: 0, types: [{product: [1]}, {bounded_text: 256}]}, ['forged answer']);
  const body = Buffer.from(encodeValue({root: 0, types: [{product: [1, 3]}, {array: {element: 2, length: 32}}, 'u8', 'bytes']}, [value[2], payload]));
  const header = Buffer.alloc(20);
  header.write('ABL_ERS3'); header.writeUInt16LE(3, 8); header.writeBigUInt64LE(BigInt(body.length), 12);
  const reference = replace(archive, null, Buffer.concat([header, body]));
  value[3] = {tag: 4, value: [value[3].value[0], reference[0], {tag: 0, value: null}]};
  row[2] = replace(archive, row[2], Buffer.from(encodeValue(archive.schemas.get('occurrence'), value)));
  return encode(archive);
}

// Reconstruct the acquired-answer cut from two actual exports of the same task:
// preserve the pre-answer World checkpoint and the acknowledged answer records.
// The valid sibling must import and finish before its omission tests get credit.
export function acquiredQuestionArchive(pendingBytes, completedBytes, omitBinding = false) {
  const pending = readArchive(pendingBytes), archive = readArchive(completedBytes);
  assert.deepEqual(pending.task.id, archive.task.id);
  const set = (name, value) => { archive.taskValue[taskFields.indexOf(name)] = value; };
  for (const field of ['checkpoint', 'outcome']) {
    set(field, pending.task[field]);
    archive.objects.set(key(pending.task[field]), pending.object(pending.task[field]));
  }
  set('outcome_kind', 2); // requested
  set('current_occurrence', pending.task.current_occurrence);
  set('execution_revision', pending.task.execution_revision);
  for (const field of ['result', 'client_result', 'result_artifact']) set(field, {tag: 0, value: null});
  const row = archive.manifest[6].find(([kind, id]) => kind === 0 && Buffer.from(id).equals(Buffer.from(pending.task.current_occurrence.value)));
  const occurrence = decodeValue(archive.schemas.get('occurrence'), archive.object(row[2]));
  assert.equal(occurrence[3].tag, 5);
  assert.equal(occurrence[3].value.tag, 0);
  const acquired = occurrence[3].value.value;
  assert.equal(acquired[2].tag, 1);
  if (omitBinding) {
    acquired[2] = {tag: 0, value: null};
    // Change the typed answer too, while preserving its request-bound envelope.
    const schema = {root: 0, types: [{product: [1, 3]}, {array: {element: 2, length: 32}}, 'u8', 'bytes']};
    const original = archive.objects.get(Buffer.from(acquired[1]).toString('hex'));
    const value = decodeValue(schema, original.subarray(20));
    value[1] = encodeValue({root: 0, types: [{product: [1]}, {bounded_text: 256}]}, ['different acquired answer']);
    const body = Buffer.from(encodeValue(schema, value));
    const header = Buffer.from(original.subarray(0, 20));
    header.writeBigUInt64LE(BigInt(body.length), 12);
    acquired[1] = replace(archive, null, Buffer.concat([header, body]))[0];
  }
  occurrence[3] = {tag: 4, value: acquired};
  row[2] = replace(archive, row[2], Buffer.from(encodeValue(archive.schemas.get('occurrence'), occurrence)));
  const questionRow = archive.manifest[6].find(([kind]) => kind === 1);
  const question = decodeValue(archive.schemas.get('question'), archive.object(questionRow[2]));
  question[12] = false;
  questionRow[2] = replace(archive, questionRow[2], Buffer.from(encodeValue(archive.schemas.get('question'), question)));
  // Reconstruct the acquisition cut, including its public history. The later
  // completed archive supplies the real answer/receipt, not permission to keep
  // completion or cleanup facts after rewinding World to its pending request.
  assert.equal(question[11].tag, 1);
  const acquiredRevision = question[11].value[5];
  set('revision', acquiredRevision);
  archive.manifest[7] = archive.manifest[7].filter(event => event[1] <= acquiredRevision);
  const lastEvent = archive.manifest[7].at(-1);
  assert.equal(lastEvent[1], acquiredRevision);
  assert.equal(decodeValue(archive.schemas.get('event'), archive.object(lastEvent[2]))[3], 2); // input_accepted
  set('event_high', lastEvent[0]);
  for (const operation of archive.manifest[8]) assert(decodeValue(archive.schemas.get('receipt'), archive.object(operation[2]))[5] <= acquiredRevision);
  const before = new Set(pending.manifest[6].map(([kind, id]) => `${kind}:${Buffer.from(id).toString('hex')}`));
  archive.manifest[6] = archive.manifest[6].filter(([kind, id]) => kind === 6 || before.has(`${kind}:${Buffer.from(id).toString('hex')}`));
  archive.manifest[3] = replace(archive, archive.manifest[3], Buffer.from(encodeValue(archive.schemas.get('task'), archive.taskValue)));
  pruneObjects(archive);
  return encode(archive);
}
