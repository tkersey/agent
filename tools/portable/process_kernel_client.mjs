import { readFile } from "node:fs/promises";

export async function compileProcessKernel(path) {
  const bytes = await readFile(path);
  const module = await WebAssembly.compile(bytes);
  if (WebAssembly.Module.imports(module).length !== 0) {
    throw new Error("process_kernel_imports_present");
  }
  return Object.freeze({ bytes, module });
}

export async function advanceFresh(kernel, image, current, isState, result = null) {
  const instance = await WebAssembly.instantiate(kernel.module, {});
  const abi = instance.exports;
  if (abi.boundary_process_kernel_abi_version() !== 1) {
    throw new Error("process_kernel_abi_mismatch");
  }
  const inputLength = abi.boundary_process_kernel_prepare_input(
    isState ? 1 : 0,
    BigInt(image.length),
    BigInt(current.length),
    result === null ? 0 : 1,
    BigInt(result?.length ?? 0),
  );
  if (inputLength === 0) throw new Error("process_kernel_input_capacity");
  const memory = new Uint8Array(abi.memory.buffer);
  let cursor = abi.boundary_process_kernel_input_payload_ptr() >>> 0;
  for (const bytes of [image, current, result ?? Buffer.alloc(0)]) {
    memory.set(bytes, cursor);
    cursor += bytes.length;
  }
  if (abi.boundary_process_kernel_execute(inputLength) !== 0) {
    const start = abi.boundary_process_kernel_error_ptr() >>> 0;
    const length = Number(abi.boundary_process_kernel_error_len());
    throw new Error(Buffer.from(memory.subarray(start, start + length)).toString("utf8"));
  }
  const start = abi.boundary_process_kernel_output_ptr() >>> 0;
  const length = Number(abi.boundary_process_kernel_output_len());
  return decodeOutcome(Buffer.from(memory.subarray(start, start + length)));
}

export function decodeOutcome(bytes) {
  if (bytes.length < 32 || bytes.subarray(0, 8).toString("ascii") !== "ABL_PKO1" ||
      bytes.readUInt16LE(8) !== 1) throw new Error("process_outcome_invalid");
  const primaryLength = Number(bytes.readBigUInt64LE(12));
  const secondaryLength = Number(bytes.readBigUInt64LE(20));
  if (32 + primaryLength + secondaryLength !== bytes.length) {
    throw new Error("process_outcome_length");
  }
  return Object.freeze({
    kind: bytes[10],
    primary: Buffer.from(bytes.subarray(32, 32 + primaryLength)),
    secondary: Buffer.from(bytes.subarray(32 + primaryLength)),
    bytes: Buffer.from(bytes),
  });
}

export function decodeRequest(bytes) {
  if (bytes.length < 238 || bytes.subarray(0, 8).toString("ascii") !== "ABL_ERQ1" ||
      bytes.readUInt16LE(8) !== 1 || bytes.readUInt16LE(10) !== 0) {
    throw new Error("process_request_invalid");
  }
  let cursor = 12;
  const requestIdentity = bytes.subarray(cursor, cursor += 32);
  const programDigest = bytes.subarray(cursor, cursor += 32);
  cursor += 32; // pre-request State digest
  cursor += 32; // effect-site digest
  cursor += 32; // payload schema digest
  const resumeSchema = bytes.subarray(cursor, cursor += 32);
  cursor += 32; // continuation digest
  const identityLength = readNatural(bytes, cursor);
  cursor += identityLength.length;
  const identity = bytes.subarray(cursor, cursor += Number(identityLength.value)).toString("utf8");
  const payloadLength = readNatural(bytes, cursor);
  cursor += payloadLength.length;
  const payload = bytes.subarray(cursor, cursor += Number(payloadLength.value));
  if (cursor !== bytes.length || identity.length === 0) throw new Error("process_request_length");
  return Object.freeze({
    requestIdentity: Buffer.from(requestIdentity),
    programDigest: Buffer.from(programDigest),
    resumeSchema: Buffer.from(resumeSchema),
    identity,
    payload: Buffer.from(payload),
  });
}

export function encodeResult(request, response) {
  const length = encodeNatural(response.length);
  return Buffer.concat([
    Buffer.from("ABL_ERS1", "ascii"),
    Buffer.from([1, 0, 0, 0]),
    request.requestIdentity,
    request.resumeSchema,
    length,
    response,
  ]);
}

function readNatural(bytes, start) {
  let value = 0n;
  let shift = 0n;
  for (let index = 0; index < 10 && start + index < bytes.length; index += 1) {
    const byte = bytes[start + index];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, length: index + 1 };
    shift += 7n;
  }
  throw new Error("natural_invalid");
}

function encodeNatural(input) {
  let value = BigInt(input);
  const bytes = [];
  do {
    let byte = Number(value & 0x7fn);
    value >>= 7n;
    if (value !== 0n) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0n);
  return Buffer.from(bytes);
}
