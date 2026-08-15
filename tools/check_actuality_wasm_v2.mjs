import { readFile, stat } from "node:fs/promises";

const [wasmPath] = process.argv.slice(2);
if (!wasmPath) {
  throw new Error("usage: node tools/check_actuality_wasm_v2.mjs <application.wasm>");
}

const maximumWasmBytes = 4_730_104;
const maximumStackBytes = 128 * 1024 * 1024;
const maximumMemoryBytes = 256 * 1024 * 1024;
const { size } = await stat(wasmPath);
if (size === 0 || size > maximumWasmBytes) {
  throw new Error(
    `repository-repair actuality WASM is ${size} bytes; expected 1..${maximumWasmBytes}`,
  );
}

const bytes = await readFile(wasmPath);
const module = await WebAssembly.compile(bytes);
if (WebAssembly.Module.imports(module).length !== 0) {
  throw new Error("repository-repair actuality WASM must be import-free");
}
const instance = await WebAssembly.instantiate(module, {});
const stackBytes = instance.exports.agent_actuality_wasm_stack_size_bytes?.();
if (!Number.isInteger(stackBytes) || stackBytes <= 0 || stackBytes > maximumStackBytes) {
  throw new Error(`repository-repair actuality WASM stack is ${stackBytes}; expected 1..${maximumStackBytes}`);
}
const memoryBytes = instance.exports.memory?.buffer.byteLength;
if (!Number.isInteger(memoryBytes) || memoryBytes <= 0 || memoryBytes > maximumMemoryBytes) {
  throw new Error(`repository-repair actuality WASM memory is ${memoryBytes}; expected 1..${maximumMemoryBytes}`);
}
let memoryCanGrow = true;
try {
  instance.exports.memory.grow(1);
} catch (error) {
  if (error instanceof RangeError) memoryCanGrow = false;
  else throw error;
}
if (memoryCanGrow) {
  throw new Error("repository-repair actuality WASM maximum memory exceeds its admitted 256 MiB image");
}

console.log(`application_wasm_bytes=${size}`);
console.log(`application_wasm_size_gate=true`);
console.log("application_wasm_import_count=0");
console.log(`wasm_stack_bytes=${stackBytes}`);
console.log(`wasm_maximum_memory_bytes=${memoryBytes}`);
