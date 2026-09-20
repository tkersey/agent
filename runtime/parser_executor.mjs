// The candidate supplies observations; this parent owns required checks and verdicts.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { readFile } from 'node:fs/promises';
import { createParserSandbox } from './inquiry_sandbox.mjs';
import { parserContract, admitTrace, observations, mandatoryTraces, traceIdentity } from './parser_oracle.mjs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function createParserExecutor(options = {}) {
  const sandbox = await createParserSandbox({ maximumOutputBytes: 1048576, timeoutMs: 10000, ...options });
  if (sandbox.kind !== 'qualified') return sandbox;
  const oracleBytes = await readFile(new URL('./parser_oracle.mjs', import.meta.url));
  const referenceBytes = await readFile(new URL('../fixtures/incremental-parser-v1/batch.mjs', import.meta.url));
  const evaluatorBytes = await readFile(new URL(import.meta.url));
  const runner = digest(JSON.stringify({ sandbox: sandbox.runner, oracle: digest(oracleBytes),
    reference: digest(referenceBytes), evaluator: digest(evaluatorBytes), parserContract }));
  let physicalExecutions = 0;
  async function probe(source, input, { signal } = {}) {
    if (typeof source !== 'string' || Buffer.byteLength(source) > 8192)
      throw new TypeError('candidate source capacity');
    const trace = admitTrace(input);
    const binding = { sourceDigest: digest(source), traceDigest: traceIdentity(trace),
      runner, acceptanceContract: parserContract };
    const actual = await sandbox.execute(source, trace, { signal });
    physicalExecutions += actual.physicalExecutions;
    if (actual.kind !== 'completed') return { ...binding, kind: actual.kind, passed: false };
    const expected = observations(trace), failures = [];
    if (actual.rows.length !== expected.length) failures.push({ call: null, reason: 'row_count' });
    for (let i = 0; i < expected.length; i++) {
      const row = actual.rows[i];
      if (!row || typeof row !== 'object') { failures.push({ call: i, reason: 'missing_row' }); continue; }
      const { stateBytes, stateUnchanged, ...observed } = row;
      if (!isDeepStrictEqual(observed, expected[i])) failures.push({ call: i, reason: 'observation' });
      if (!Number.isSafeInteger(stateBytes) || stateBytes < 0 || typeof stateUnchanged !== 'boolean')
        failures.push({ call: i, reason: 'state_measurement' });
      if (i > 0 && expected[i - 1].status !== 'open' && !stateUnchanged)
        failures.push({ call: i, reason: 'closed_state_mutation' });
    }
    return { ...binding, kind: 'completed', passed: failures.length === 0,
      failures, rows: actual.rows };
  }
  async function validate(source, { seed = 0x13579bdf, signal } = {}) {
    const checks = [];
    for (const { name, trace } of mandatoryTraces(seed)) {
      const result = await probe(source, trace, { signal });
      checks.push({ name, ...result });
      if (!result.passed) break; // Incomplete checks never become acceptance.
    }
    const required = mandatoryTraces(seed).length;
    const retention = [];
    if (checks.length === required && checks.every(check => check.passed)) {
      const completed = Array.from({ length: 500 }, (_, index) => ({
        chunk: [...Array.from({ length: 8 }, (_, field) => 65 + ((index * 17 + field * 11) % 26)), 10],
        endOfInput: false,
      }));
      completed.push({ chunk: [], endOfInput: true });
      const history = await probe(source, completed, { signal });
      const peak = Math.max(0, ...(history.rows ?? []).map(row => row.stateBytes));
      retention.push({ name: 'completed-history', ...history, peak, maximum: 2048,
        passed: history.passed && peak <= 2048 });
      const unfinished = Array.from({ length: 128 }, () => ({ chunk: Array(64).fill(97), endOfInput: false }));
      unfinished.push({ chunk: [10], endOfInput: true });
      const field = await probe(source, unfinished, { signal });
      retention.push({ name: 'unfinished-field', ...field,
        peak: Math.max(0, ...(field.rows ?? []).map(row => row.stateBytes)) });
    }
    return { sourceDigest: digest(source), runner, acceptanceContract: parserContract,
      seed, required, executed: checks.length,
      passed: checks.length === required && checks.every(check => check.passed) &&
        retention.length === 2 && retention.every(check => check.passed), checks, retention };
  }
  return Object.freeze({ kind: 'qualified', runner, contract: sandbox.contract,
    qualification: sandbox.qualification, probe, validate,
    metrics: () => ({ physicalExecutions, qualificationExecutions: sandbox.qualificationExecutions }) });
}
