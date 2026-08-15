import { stat } from "node:fs/promises";

const [wasmPath] = process.argv.slice(2);
if (!wasmPath) {
  throw new Error("usage: node tools/check_actuality_wasm_v2.mjs <application.wasm>");
}

const maximumWasmBytes = 4_730_104;
const { size } = await stat(wasmPath);
if (size === 0 || size > maximumWasmBytes) {
  throw new Error(
    `repository-repair actuality WASM is ${size} bytes; expected 1..${maximumWasmBytes}`,
  );
}

console.log(`application_wasm_bytes=${size}`);
console.log(`application_wasm_size_gate=true`);
