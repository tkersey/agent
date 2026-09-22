// Trusted finite acceptance observations, independent of candidate code and state.
import { createHash } from 'node:crypto';
import { observePrefix } from '../fixtures/incremental-parser-v1/batch.mjs';

export const parserContract = 'agent.incremental-byte-parser/v1';
export function contractFor(eofPolicy = 'strict') {
  if (!['strict','emit'].includes(eofPolicy)) throw new TypeError('unknown EOF policy');
  return eofPolicy === 'strict' ? parserContract : 'agent.incremental-byte-parser-emit-eof/v1';
}
export function admitTrace(trace) {
  if (!Array.isArray(trace) || trace.length === 0 || trace.length > 4096)
    throw new TypeError('trace must contain 1 through 4096 calls');
  let total = 0;
  return trace.map(call => {
    if (!call || Object.keys(call).sort().join(',') !== 'chunk,endOfInput' ||
        !Array.isArray(call.chunk) || typeof call.endOfInput !== 'boolean' ||
        call.chunk.some(x => !Number.isInteger(x) || x < 0 || x > 255))
      throw new TypeError('invalid parser trace call');
    total += call.chunk.length;
    if (total > 262144) throw new TypeError('trace byte capacity exceeded');
    return { chunk: [...call.chunk], endOfInput: call.endOfInput };
  });
}

export function observations(trace, eofPolicy = 'strict') {
  contractFor(eofPolicy);
  trace = admitTrace(trace);
  const prefix = [], rows = [];
  let count = 0, terminal;
  for (const call of trace) {
    if (terminal) {
      rows.push({ newly_completed_records: [], ...terminal });
      continue;
    }
    for (const byte of call.chunk) prefix.push(byte);
    const observed = observePrefix(prefix, call.endOfInput, eofPolicy);
    rows.push({ newly_completed_records: observed.records.slice(count), status: observed.status,
      ...(observed.error ? { error: observed.error } : {}) });
    count = observed.records.length;
    if (observed.status !== 'open') terminal = { status: observed.status,
      ...(observed.error ? { error: observed.error } : {}) };
  }
  return rows;
}

export function traceIdentity(trace, eofPolicy = 'strict') {
  return createHash('sha256').update(contractFor(eofPolicy)).update('\0')
    .update(JSON.stringify(admitTrace(trace))).digest('hex');
}

export function partitions(bytes) {
  const traces = [];
  // Every two-way split, including empty chunks and splits inside escape pairs.
  for (let split = 0; split <= bytes.length; split++) traces.push([
    { chunk: bytes.slice(0, split), endOfInput: false },
    { chunk: [], endOfInput: false },
    { chunk: bytes.slice(split), endOfInput: true },
    { chunk: [10], endOfInput: true },
  ]);
  traces.push([...bytes.map(byte => ({ chunk: [byte], endOfInput: false })),
    { chunk: [], endOfInput: true }, { chunk: [], endOfInput: false }]);
  return traces;
}

export function mandatoryTraces(seed = 0x13579bdf) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new TypeError('invalid seed');
  const samples = [[], [10], [44, 10], [13, 255, 10], [92, 92, 10], [92, 44, 10],
    [92, 110, 10], [97, 10, 98, 92, 120, 10], [97, 92], [97], [97, 10, 44],
    [10, 10, 44, 44, 10], [92, 10], [92, 13], [92, 0]];
  let state = seed >>> 0;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
  const alphabet = [0, 10, 13, 44, 92, 110, 120, 255, 97, 98];
  for (let sample = 0; sample < 32; sample++) {
    const bytes = Array.from({ length: random() % 25 }, () => alphabet[random() % alphabet.length]);
    samples.push(bytes);
  }
  return samples.flatMap((bytes, sample) => partitions(bytes).map((trace, partition) =>
    ({ name: `sample-${sample}-partition-${partition}`, trace })));
}

/** Fixed input partitions. Shared mandatory edge cases are not called held out. */
export function evaluationPlan(split = 'development') {
  if (!['development','heldout'].includes(split)) throw new TypeError('unknown evaluation split');
  const seed = split === 'development' ? 0x13579bdf : 0x6d2b79f5;
  const development = mandatoryTraces(0x13579bdf);
  const anchors = development.filter(row => Number(row.name.split('-')[1]) < 15);
  let reserved = [];
  if (split === 'heldout') {
    const seen = new Set(development.map(row => JSON.stringify(row.trace)));
    reserved = mandatoryTraces(seed).filter(row => {
      const key = JSON.stringify(row.trace);
      if (seen.has(key)) return false;
      seen.add(key);return true;
    });
    if (reserved.length === 0) throw new Error('empty reserved input partition');
  }
  const traces = split === 'development' ? development : [...anchors,...reserved];
  for (const row of traces) {
    for (const call of row.trace) { Object.freeze(call.chunk);Object.freeze(call); }
    Object.freeze(row.trace);Object.freeze(row);
  }
  Object.freeze(traces);
  const metadata = Object.freeze({split,seed,required:traces.length,sharedMandatory:anchors.length,
    reservedInputs:reserved.length,traceDigest:createHash('sha256').update(JSON.stringify(traces)).digest('hex')});
  return Object.freeze({metadata,traces});
}
