import { createHash } from "node:crypto";

export const KERNEL_SHA256 = "12973fb655f126c2acd5693a84be47496649d1ab10bf22d565c9b675172e4f27";
export const KERNEL_EXPORTS = Object.freeze([
  ["memory", "memory"],
  ["boundary_machine_v2_kernel_reset", "function"],
  ["boundary_machine_v2_kernel_execute", "function"],
  ["boundary_machine_v2_kernel_error_len", "function"],
  ["boundary_machine_v2_kernel_error_ptr", "function"],
  ["boundary_machine_v2_kernel_output_len", "function"],
  ["boundary_machine_v2_kernel_output_ptr", "function"],
  ["boundary_machine_v2_kernel_input_capacity", "function"],
  ["boundary_machine_v2_kernel_input_ptr", "function"],
  ["boundary_machine_v2_kernel_abi_version", "function"]
]);

export async function compileKernel(kernelBytes, { expectedSha256 = KERNEL_SHA256 } = {}) {
  const bytes = ownedBytes(kernelBytes, "kernel WASM");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== expectedSha256) throw new Error(`kernel_sha256_mismatch:${sha256}`);
  const module = await WebAssembly.compile(bytes);
  const imports = WebAssembly.Module.imports(module);
  if (imports.length !== 0) throw new Error(`kernel_imports_present:${imports.length}`);
  const exports = WebAssembly.Module.exports(module);
  if (JSON.stringify(exports.map(({ name, kind }) => [name, kind])) !== JSON.stringify(KERNEL_EXPORTS)) {
    throw new Error("kernel_export_surface_mismatch");
  }
  const probe = await WebAssembly.instantiate(module, {});
  if (probe.exports.boundary_machine_v2_kernel_abi_version() !== 1) {
    throw new Error("kernel_abi_mismatch");
  }
  return Object.freeze({ module, sha256, importCount: imports.length, exports });
}

export async function executeKernelCommand({
  kernel,
  bpi1,
  mv2p1,
  command,
  state = new Uint8Array(0),
  auxiliary = new Uint8Array(0),
  callerFuel = 0n
}) {
  if (!kernel?.module) throw new Error("kernel_not_compiled");
  const image = byteView(bpi1, "BPI1");
  const profile = byteView(mv2p1, "MV2P1");
  const canonicalState = byteView(state, "State");
  const aux = byteView(auxiliary, "auxiliary");
  if (!Number.isInteger(command) || command < 0 || command > 5) throw new Error("kernel_command_invalid");
  if (typeof callerFuel !== "bigint" || callerFuel < 0n || callerFuel > 0xffffffffffffffffn) {
    throw new Error("kernel_fuel_invalid");
  }
  for (const [name, value] of [["BPI1", image], ["MV2P1", profile], ["State", canonicalState], ["auxiliary", aux]]) {
    if (value.length > 0xffffffff) throw new Error(`kernel_${name}_length_invalid`);
  }
  const instance = await WebAssembly.instantiate(kernel.module, {});
  const abi = instance.exports;
  const inputLength = 48 + image.length + profile.length + canonicalState.length + aux.length;
  if (!Number.isSafeInteger(inputLength) ||
      inputLength > abi.boundary_machine_v2_kernel_input_capacity()) {
    throw new Error("kernel_input_capacity");
  }
  const input = Buffer.alloc(inputLength);
  input.write("ABL_KIN1", 0, "ascii");
  input.writeUInt16LE(1, 8);
  input.writeUInt16LE(command, 10);
  input.writeBigUInt64LE(callerFuel, 16);
  input.writeUInt32LE(image.length, 24);
  input.writeUInt32LE(profile.length, 28);
  input.writeUInt32LE(canonicalState.length, 32);
  input.writeUInt32LE(aux.length, 36);
  let cursor = 48;
  for (const value of [image, profile, canonicalState, aux]) {
    Buffer.from(value.buffer, value.byteOffset, value.byteLength).copy(input, cursor);
    cursor += value.length;
  }
  const memory = new Uint8Array(abi.memory.buffer);
  memory.set(input, abi.boundary_machine_v2_kernel_input_ptr());
  const resultCode = abi.boundary_machine_v2_kernel_execute(input.length);
  if (resultCode !== 0) {
    const errorPtr = abi.boundary_machine_v2_kernel_error_ptr();
    const errorLength = abi.boundary_machine_v2_kernel_error_len();
    const message = Buffer.from(memory.slice(errorPtr, errorPtr + errorLength)).toString("utf8");
    throw new Error(`kernel_operational_failure:${resultCode}:${message}`);
  }
  const outputPtr = abi.boundary_machine_v2_kernel_output_ptr();
  const outputLength = abi.boundary_machine_v2_kernel_output_len();
  return decodeKernelOutput(Buffer.from(memory.slice(outputPtr, outputPtr + outputLength)), command);
}

export function encodeResumeAuxiliary(requestIdentity, responseBytes) {
  const identity = byteView(requestIdentity, "RequestIdentity");
  const response = byteView(responseBytes, "response");
  if (identity.length !== 176 || response.length > 0xffffffff) throw new Error("kernel_resume_invalid");
  const resultLength = 184 + response.length;
  if (!Number.isSafeInteger(resultLength)) throw new Error("kernel_resume_invalid");
  const result = Buffer.alloc(resultLength);
  Buffer.from(identity.buffer, identity.byteOffset, identity.byteLength).copy(result, 0);
  result.writeUInt32LE(response.length, 176);
  Buffer.from(response.buffer, response.byteOffset, response.byteLength).copy(result, 184);
  return result;
}

export function decodeRequestIdentity(encoded) {
  const bytes = ownedBytes(encoded, "RequestIdentity");
  if (bytes.length !== 176) throw new Error("request_identity_length");
  return Object.freeze({
    bytes,
    machineContractDigest: bytes.subarray(0, 32),
    sequence: bytes.readBigUInt64LE(32),
    constructorId: bytes.readUInt32LE(40),
    siteOrdinal: bytes.readUInt32LE(44),
    effectSiteDigest: bytes.subarray(48, 80),
    payloadDigest: bytes.subarray(80, 112),
    continuationDigest: bytes.subarray(112, 144),
    digest: bytes.subarray(144, 176)
  });
}

function decodeKernelOutput(bytes, command) {
  if (bytes.length < 40 || bytes.subarray(0, 8).toString("ascii") !== "ABL_KOU1" ||
      bytes.readUInt16LE(8) !== 1 || bytes.readUInt16LE(10) !== command ||
      bytes.readUInt16LE(14) !== 0 || bytes.readUInt32LE(36) !== 0) {
    throw new Error("kernel_output_header_invalid");
  }
  const stateLength = bytes.readUInt32LE(24);
  const valueLength = bytes.readUInt32LE(28);
  const metadataLength = bytes.readUInt32LE(32);
  if (bytes.length !== 40 + stateLength + valueLength + metadataLength) {
    throw new Error("kernel_output_length_invalid");
  }
  const stateStart = 40;
  const valueStart = stateStart + stateLength;
  const metadataStart = valueStart + valueLength;
  return Object.freeze({
    command,
    outcome: bytes.readUInt16LE(12),
    remainingFuel: bytes.readBigUInt64LE(16),
    state: Buffer.from(bytes.subarray(stateStart, valueStart)),
    value: Buffer.from(bytes.subarray(valueStart, metadataStart)),
    metadata: Buffer.from(bytes.subarray(metadataStart)),
    bytes: Buffer.from(bytes)
  });
}

function ownedBytes(value, label) {
  if (!(value instanceof Uint8Array)) throw new TypeError(`${label} must be bytes`);
  return Buffer.from(value);
}

function byteView(value, label) {
  if (!(value instanceof Uint8Array)) throw new TypeError(`${label} must be bytes`);
  return value;
}
