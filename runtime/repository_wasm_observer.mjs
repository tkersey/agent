// Trusted observation bridge. Expectations stay in the parent; candidate Wasm
// gets no imports, process API, output channel, or reference to this JS realm.
import { readFileSync } from 'node:fs';
const [path, countText] = process.argv.slice(2), count = Number(countText);
if (!Number.isInteger(count) || count < 1 || count > 64) throw Error('ObservationCount');
const bytes = readFileSync(path);
if (bytes.length > 16 << 20) throw Error('ObservationModuleCapacity');
const module = new WebAssembly.Module(bytes);
if (WebAssembly.Module.imports(module).length !== 0) throw Error('ObservationImportsDenied');
const instance = new WebAssembly.Instance(module), observe = instance.exports.agent_observe;
if (typeof observe !== 'function' || observe.length !== 1) throw Error('ObservationInterface');
const values = [];
for (let i = 0; i < count; i++) {
  const value = observe(i);
  if (typeof value !== 'bigint') throw Error('ObservationType');
  values.push(BigInt.asUintN(64, value).toString());
}
process.stdout.write(JSON.stringify(values) + '\n');
