// Independent archive peer using the existing ordinary value codec. It never
// imports native implementation code or treats an archive as execution authority.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {decodeSchema, decodeValue, encodeValue} from '../../runtime/values.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest();
const key = reference => Buffer.from(reference[0]).toString('hex');
const taskFields = ['id', 'application_id', 'input_schema_id', 'output_schema_id', 'failure_schema_id', 'message_schema_id', 'principal', 'tenant', 'profile_id', 'profile', 'image', 'runtime_identity', 'input', 'checkpoint', 'outcome', 'outcome_kind', 'current_occurrence', 'revision', 'execution_revision', 'schedule', 'cancellation', 'cancellation_applied', 'blocker', 'result', 'client_result', 'result_artifact', 'event_floor', 'event_high', 'next_message', 'messages', 'inference_attempts', 'inference_request_bytes', 'inference_output_tokens', 'evidence_bytes'];

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
