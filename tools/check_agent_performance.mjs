#!/usr/bin/env node
import { readFileSync } from "node:fs";

const baseline = JSON.parse(readFileSync("conformance/agent-v2/baseline.json", "utf8"));
const candidate = JSON.parse(readFileSync("conformance/agent-v2/candidate.json", "utf8"));
const before = baseline.measurements;
const after = candidate.measurements;

requireGate(after.peakFrameBytes <= Math.floor(before.peakFrameBytes * 0.5), "peak Frame ratio");
requireGate(after.peakMachineStateBytes <= 384 * 1024, "peak Machine state");
requireGate(after.declaredStateBytes <= 512 * 1024, "declared state");
requireGate(after.wasmBytes <= Math.floor(before.wasmBytes * 0.8), "WASM ratio");
requireGate(after.wasmBytes <= 4_730_104, "WASM absolute size");
requireGate(after.wasmStackBytes <= 128 * 1024 * 1024, "WASM stack");
requireGate(after.wasmMaximumMemoryBytes <= 256 * 1024 * 1024, "WASM maximum memory");
requireGate(after.firstDecisionPayloadBytes <= 16 * 1024, "first decision payload");
requireGate(after.compileMilliseconds <= before.compileMilliseconds * 2, "recorded compile time ratio");
requireGate(after.peakCompilerBytes <= before.peakCompilerBytes * 2, "recorded compiler memory ratio");
requireGate(after.warmStepNanoseconds <= before.warmStepNanoseconds * 1.25, "recorded single-step ratio");

console.log("agent_epistemic_performance=pass");
console.log(`peak_frame_bytes=${after.peakFrameBytes}`);
console.log(`peak_state_bytes=${after.peakMachineStateBytes}`);
console.log(`application_wasm_bytes=${after.wasmBytes}`);
console.log(`first_decision_payload_bytes=${after.firstDecisionPayloadBytes}`);

function requireGate(condition, label) {
  if (!condition) throw new Error(`Agent v2 performance gate failed: ${label}`);
}
