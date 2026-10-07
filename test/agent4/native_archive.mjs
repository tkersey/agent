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
