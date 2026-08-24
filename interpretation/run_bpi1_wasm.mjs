import { readFileSync } from "node:fs";

if (process.argv.length !== 3) {
  throw new Error("usage: node run_bpi1_wasm.mjs <emitter.wasm>");
}
const bytes = readFileSync(process.argv[2]);
const module = await WebAssembly.compile(bytes);
if (WebAssembly.Module.imports(module).length !== 0) {
  throw new Error("repository-repair BPI1 emitter must import nothing");
}
const instance = await WebAssembly.instantiate(module, {});
const { exports } = instance;
if (exports.repository_repair_bpi1_emit() !== 0) {
  throw new Error("repository-repair BPI1 emission failed");
}
const pointer = exports.repository_repair_bpi1_output_ptr();
const length = exports.repository_repair_bpi1_output_len();
if (!Number.isInteger(pointer) || !Number.isInteger(length) || length === 0) {
  throw new Error("repository-repair BPI1 emitter returned invalid bounds");
}
const output = Buffer.from(exports.memory.buffer, pointer, length);
process.stdout.write(output);
