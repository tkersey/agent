import { readFile } from "node:fs/promises";

const wasmPath = process.argv[2];
if (!wasmPath) throw new Error("usage: node run_machine_wasm.mjs <machine.wasm>");

const bytes = await readFile(wasmPath);
const module = await WebAssembly.compile(bytes);
if (WebAssembly.Module.imports(module).length !== 0) {
  throw new Error("Agent Machine parity WASM must be import-free");
}

const forbidden = [
  "load_agent",
  "load_strategy",
  "register_tool",
  "switch_strategy",
  "interpret_definition",
  "AgentInterpreter",
  "AgentSession",
];
const binaryText = bytes.toString("latin1");
for (const symbol of forbidden) {
  if (binaryText.includes(symbol)) {
    throw new Error(`Agent Machine WASM contains forbidden runtime symbol: ${symbol}`);
  }
}

const instance = await WebAssembly.instantiate(module, {});
const length = instance.exports.agentMachineParityRun();
const pointer = instance.exports.agentMachineParityOutputPointer();
if (typeof length !== "number" || typeof pointer !== "number" || length === 0) {
  throw new Error("Agent Machine WASM parity witness failed");
}
const output = Buffer.from(
  new Uint8Array(instance.exports.memory.buffer, pointer, length),
);
process.stdout.write(output);
