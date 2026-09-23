// Fixed trusted observation driver inside the existing qualified OS sandbox.
// Every call evaluates the candidate in a new realm; no candidate object escapes.
import { readFile } from 'node:fs/promises';
import { createContext, Script, SourceTextModule } from 'node:vm';
import { isDeepStrictEqual } from 'node:util';
const source = await readFile(new URL('./session.mjs', import.meta.url), 'utf8');
const { nonce, trace } = JSON.parse(await readFile(new URL('./trace.json', import.meta.url), 'utf8'));

async function invoke(operation, encoded) {
  const context = createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  const call = new Script(`(() => {
    const parse = JSON.parse, stringify = JSON.stringify, apply = Reflect.apply;
    return (api, operation, encoded) => {
      const input = parse(encoded);
      const result = operation === 'initial' ? apply(api.initial, undefined, []) :
        apply(api.step, undefined, [input.state, input.chunk, input.endOfInput]);
      return stringify(result);
    };
  })()`).runInContext(context);
  const module = new SourceTextModule(source, { context, identifier: 'parser:candidate.mjs',
    importModuleDynamically() { throw null; } });
  await module.link(() => { throw null; });
  await module.evaluate({ timeout: 1000 });
  const result = call(module.namespace, operation, encoded);
  if (typeof result !== 'string' || Buffer.byteLength(result) > 262144)
    throw new Error('candidate result capacity');
  return JSON.parse(result);
}

function stateBytes(state) {
  const bytes = Buffer.byteLength(JSON.stringify(state));
  if (bytes > 131072) throw new Error('candidate state capacity');
  return bytes;
}

let state = await invoke('initial', '{}');
stateBytes(state);
const rows = [];
for (const call of trace) {
  const prior = state;
  const result = await invoke('step', JSON.stringify({ state, ...call }));
  if (!result || typeof result !== 'object' || Array.isArray(result) ||
      !Object.hasOwn(result, 'next_state') || !Object.hasOwn(result, 'status') ||
      !Object.hasOwn(result, 'newly_completed_records') ||
      Object.keys(result).some(key => !['next_state', 'status', 'newly_completed_records', 'error'].includes(key)))
    throw new Error('candidate step protocol');
  state = result.next_state;
  const measuredStateBytes = stateBytes(state);
  rows.push({ newly_completed_records: result.newly_completed_records, status: result.status,
    ...(result.error === undefined ? {} : { error: result.error }),
    stateBytes: measuredStateBytes, stateUnchanged: isDeepStrictEqual(prior, state) });
}
process.stdout.write(JSON.stringify({ nonce, kind: 'observations', rows }));
