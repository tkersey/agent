import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const PROCESS_KERNEL_ABI_VERSION = 1;
export const PROCESS_KERNEL_BYTE_LENGTH = 647_473;
export const PROCESS_KERNEL_SHA256 =
  "178f9c2fb79402a85ab5a7905586879347ad5c99f988127eec001c9ecfd813f0";

export const PROCESS_KERNEL_EXPORTS = Object.freeze([
  Object.freeze(["memory", "memory"]),
  Object.freeze(["boundary_process_kernel_execute", "function"]),
  Object.freeze(["boundary_process_kernel_error_len", "function"]),
  Object.freeze(["boundary_process_kernel_error_ptr", "function"]),
  Object.freeze(["boundary_process_kernel_output_len", "function"]),
  Object.freeze(["boundary_process_kernel_output_ptr", "function"]),
  Object.freeze(["boundary_process_kernel_prepare_input", "function"]),
  Object.freeze([
    "boundary_process_kernel_occupied_memory_bytes",
    "function",
  ]),
  Object.freeze(["boundary_process_kernel_input_payload_ptr", "function"]),
  Object.freeze(["boundary_process_kernel_input_capacity", "function"]),
  Object.freeze(["boundary_process_kernel_input_ptr", "function"]),
  Object.freeze(["boundary_process_kernel_reserve", "function"]),
  Object.freeze(["boundary_process_kernel_abi_version", "function"]),
]);

export const OUTCOME_KIND_NAMES = Object.freeze([
  "Progressed",
  "Requested",
  "ExplicitlyYielded",
  "Completed",
  "AuthoredFailure",
  "NeedsCapacity",
]);

const MAX_U64 = 0xffff_ffff_ffff_ffffn;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const PROCESS_STATE_FIXED_LENGTH = 44;
const PROCESS_REQUEST_FIXED_LENGTH = 236;
const PROCESS_RESULT_FIXED_LENGTH = 76;
const PROCESS_OUTCOME_HEADER_LENGTH = 32;
const PROCESS_INPUT_HEADER_LENGTH = 40;

const compiledKernelState = new WeakMap();
const processKernelHostState = new WeakMap();
const utf8Decoder = new TextDecoder("utf-8", {
  fatal: true,
  // Preserve a leading U+FEFF as semantic content instead of silently
  // normalizing the exact identity/error bytes being validated.
  ignoreBOM: true,
});

/**
 * Authenticate and compile the exact released Boundary Process kernel.
 *
 * Compilation deliberately performs no instantiation. ABI observation belongs
 * to each semantic advance so a 96-reduction run plus one reconstruction has
 * exactly 97 fresh instances, not 98 hidden behind authentication.
 */
export async function compileProcessKernel(
  pathOrBytes,
  {
    expectedByteLength = PROCESS_KERNEL_BYTE_LENGTH,
    expectedSha256 = PROCESS_KERNEL_SHA256,
    expectedAbiVersion = PROCESS_KERNEL_ABI_VERSION,
    expectedExports = PROCESS_KERNEL_EXPORTS,
  } = {},
) {
  const bytes = typeof pathOrBytes === "string" || pathOrBytes instanceof URL
    ? Buffer.from(await readFile(pathOrBytes))
    : ownedBytes(pathOrBytes, "process kernel");
  const byteLength = bytes.length;
  if (!Number.isSafeInteger(expectedByteLength) || expectedByteLength < 0) {
    fail("process_kernel_expected_byte_length_invalid");
  }
  if (byteLength !== expectedByteLength) {
    fail("process_kernel_byte_length_mismatch", byteLength);
  }
  if (typeof expectedSha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(expectedSha256)) {
    fail("process_kernel_expected_sha256_invalid");
  }
  const sha256 = sha256Hex(bytes);
  if (sha256 !== expectedSha256) {
    fail("process_kernel_sha256_mismatch", sha256);
  }
  if (!Number.isInteger(expectedAbiVersion) ||
      expectedAbiVersion < 0 || expectedAbiVersion > 0xffff_ffff) {
    fail("process_kernel_expected_abi_invalid");
  }
  let valid;
  try {
    valid = WebAssembly.validate(bytes);
  } catch {
    fail("process_kernel_validate_failed");
  }
  if (!valid) fail("process_kernel_validate_failed");

  let module;
  try {
    module = await WebAssembly.compile(bytes);
  } catch {
    fail("process_kernel_compile_failed");
  }
  const imports = WebAssembly.Module.imports(module);
  if (imports.length !== 0) {
    fail("process_kernel_imports_present", imports.length);
  }
  const exports = WebAssembly.Module.exports(module);
  const actualExportSurface = exports.map(({ name, kind }) => [name, kind]);
  if (!sameExportSurface(actualExportSurface, expectedExports)) {
    fail("process_kernel_export_surface_mismatch");
  }

  const kernel = {
    bytes,
    module,
    sha256,
    byteLength,
    imports: Object.freeze(imports.map((entry) => Object.freeze({ ...entry }))),
    importCount: imports.length,
    exports: Object.freeze(exports.map((entry) => Object.freeze({ ...entry }))),
    expectedAbiVersion,
  };
  compiledKernelState.set(kernel, {
    usedInstances: new WeakSet(),
  });
  return Object.freeze(kernel);
}

/**
 * Create an execution context over one already-compiled immutable module.
 * Multiple contexts may share a module (the transfer proof does exactly that),
 * while reuse detection remains global to the compiled kernel.
 */
export function createProcessKernelHost(
  kernel,
  { instantiate = defaultInstantiate } = {},
) {
  requireCompiledKernel(kernel);
  if (typeof instantiate !== "function") {
    throw new TypeError("process kernel instantiate must be a function");
  }
  const state = {
    kernel,
    instantiate,
    freshInstanceCount: 0,
    usesDefaultInstantiation: instantiate === defaultInstantiate,
  };
  const host = {
    kernel,
    get freshInstanceCount() {
      return state.freshInstanceCount;
    },
    get usesDefaultInstantiation() {
      return state.usesDefaultInstantiation;
    },
  };
  processKernelHostState.set(host, state);
  return Object.freeze(host);
}

export function forkProcessKernelHost(kernelOrHost) {
  const state = processKernelHostState.get(kernelOrHost);
  return createProcessKernelHost(state?.kernel ?? kernelOrHost);
}

/**
 * Perform exactly one Process semantic advance with a newly instantiated WASM
 * instance.
 */
export async function advanceFresh(host, input) {
  if (!processKernelHostState.has(host)) fail("process_kernel_host_invalid");
  const hostState = processKernelHostState.get(host);
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    fail("process_advance_input_invalid");
  }
  const expectedKeys = ["image", "current", "isState", "effectResult"];
  const actualKeys = Object.keys(input);
  if (actualKeys.length !== expectedKeys.length ||
      expectedKeys.some((key) => !Object.hasOwn(input, key)) ||
      actualKeys.some((key) => !expectedKeys.includes(key))) {
    fail("process_advance_input_shape");
  }
  if (typeof input.isState !== "boolean") fail("process_instance_kind_invalid");
  const image = byteView(input.image, "program image");
  const current = byteView(input.current, "Process instance");
  const effectResult = input.effectResult === null
    ? null
    : byteView(input.effectResult, "EffectResult");
  if (input.isState) {
    decodeProcessState(current);
  }
  if (effectResult !== null) {
    if (!input.isState) fail("process_effect_result_requires_state");
    decodeResult(effectResult);
  }

  const instance = await instantiateUnique(hostState);
  const abi = validateInstance(instance, hostState.kernel.expectedAbiVersion);
  const imageLength = BigInt(image.length);
  const currentLength = BigInt(current.length);
  const resultLength = BigInt(effectResult?.length ?? 0);
  const inputLengthValue = abi.boundary_process_kernel_prepare_input(
    input.isState ? 1 : 0,
    imageLength,
    currentLength,
    effectResult === null ? 0 : 1,
    resultLength,
  );
  const inputLength = wasmU32(inputLengthValue, "process kernel input length");

  let outcomeBytes;
  if (inputLength === 0) {
    outcomeBytes = readWasmExportedBytes(
      abi,
      "boundary_process_kernel_output_ptr",
      "boundary_process_kernel_output_len",
      "process kernel output",
    );
    if (outcomeBytes.length === 0) {
      const message = readKernelError(abi);
      fail(
        "process_kernel_prepare_input_failed",
        message.length === 0 ? undefined : decodeUtf8(message, "process kernel error"),
      );
    }
  } else {
    const expectedInputLength = PROCESS_INPUT_HEADER_LENGTH + image.length +
      current.length + (effectResult?.length ?? 0);
    if (inputLength !== expectedInputLength) {
      fail("process_kernel_input_length_mismatch", inputLength);
    }
    const payloadStart = wasmOffset(
      abi.boundary_process_kernel_input_payload_ptr(),
      "process kernel input payload",
    );
    const memory = memoryBytes(abi);
    requireWasmRange(
      memory,
      payloadStart,
      expectedInputLength - PROCESS_INPUT_HEADER_LENGTH,
      "process kernel input payload",
    );
    let cursor = payloadStart;
    for (const bytes of [image, current, effectResult ?? Buffer.alloc(0)]) {
      memory.set(bytes, cursor);
      cursor += bytes.length;
    }
    const status = abi.boundary_process_kernel_execute(inputLength);
    if (!Number.isInteger(status)) fail("process_kernel_status_invalid");
    if (status !== 0) {
      const message = readKernelError(abi);
      const decoded = message.length === 0
        ? ""
        : decodeUtf8(message, "process kernel error");
      fail("process_kernel_operational_failure", `${status}:${decoded}`);
    }
    // Copy the canonical PKO1 out of mutable WASM memory before inspecting it.
    outcomeBytes = readWasmExportedBytes(
      abi,
      "boundary_process_kernel_output_ptr",
      "boundary_process_kernel_output_len",
      "process kernel output",
    );
  }
  return decodeOutcome(outcomeBytes);
}

export function decodeOutcome(
  encoded,
  { expectedProgramTransitionDigest = null } = {},
) {
  const bytes = ownedBytes(encoded, "Process outcome");
  if (bytes.length < PROCESS_OUTCOME_HEADER_LENGTH ||
      !bytes.subarray(0, 8).equals(Buffer.from("ABL_PKO1", "ascii"))) {
    fail("process_outcome_invalid");
  }
  if (bytes.readUInt16LE(8) !== 1) {
    fail("process_outcome_unsupported_version", bytes.readUInt16LE(8));
  }
  const kind = bytes[10];
  if (kind >= OUTCOME_KIND_NAMES.length) {
    fail("process_outcome_kind_invalid", kind);
  }
  if (bytes[11] !== 0 || !allZero(bytes.subarray(28, 32))) {
    fail("process_outcome_unknown_flags");
  }
  const primaryLength = safeU64Length(
    bytes.readBigUInt64LE(12),
    "process_outcome_primary_length",
  );
  const secondaryLength = safeU64Length(
    bytes.readBigUInt64LE(20),
    "process_outcome_secondary_length",
  );
  const payloadLength = safeAdd(
    primaryLength,
    secondaryLength,
    "process_outcome_length",
  );
  const expectedLength = safeAdd(
    PROCESS_OUTCOME_HEADER_LENGTH,
    payloadLength,
    "process_outcome_length",
  );
  if (expectedLength !== bytes.length) fail("process_outcome_length");

  const primary = Buffer.from(bytes.subarray(
    PROCESS_OUTCOME_HEADER_LENGTH,
    PROCESS_OUTCOME_HEADER_LENGTH + primaryLength,
  ));
  const secondary = Buffer.from(bytes.subarray(
    PROCESS_OUTCOME_HEADER_LENGTH + primaryLength,
  ));
  const expectedDigest = normalizeOptionalDigest(
    expectedProgramTransitionDigest,
    "program transition digest",
  );
  let state = null;
  let stateView = null;
  let request = null;
  let requestView = null;
  let result = null;
  let failure = null;
  let capacity = null;

  switch (kind) {
    case 0:
    case 2:
      if (secondary.length !== 0) fail("process_outcome_secondary_invalid");
      state = Buffer.from(primary);
      stateView = decodeProcessState(state, {
        expectedProgramTransitionDigest: expectedDigest,
      });
      break;
    case 1:
      if (secondary.length === 0) fail("process_outcome_request_missing");
      state = Buffer.from(primary);
      request = Buffer.from(secondary);
      stateView = decodeProcessState(state, {
        expectedProgramTransitionDigest: expectedDigest,
      });
      requestView = decodeRequest(request, {
        expectedProgramTransitionDigest:
          stateView.programTransitionDigest,
        expectedState: state,
      });
      break;
    case 3:
      if (secondary.length !== 0) fail("process_outcome_secondary_invalid");
      result = Buffer.from(primary);
      break;
    case 4:
      if (secondary.length !== 0) fail("process_outcome_secondary_invalid");
      failure = Buffer.from(primary);
      break;
    case 5:
      if (primary.length !== 32 || secondary.length !== 0) {
        fail("process_outcome_capacity_invalid");
      }
      capacity = Object.freeze({
        minimumInputBytes: primary.readBigUInt64LE(0),
        minimumOutputBytes: primary.readBigUInt64LE(8),
        minimumScratchBytes: primary.readBigUInt64LE(16),
        minimumMemoryPages: primary.readBigUInt64LE(24),
      });
      break;
    default:
      fail("process_outcome_kind_invalid", kind);
  }

  return Object.freeze({
    bytes,
    kind,
    kindName: OUTCOME_KIND_NAMES[kind],
    primary,
    secondary,
    state,
    stateView,
    request,
    requestView,
    result,
    failure,
    capacity,
  });
}

export function decodeProcessState(
  encoded,
  { expectedProgramTransitionDigest = null } = {},
) {
  const bytes = ownedBytes(encoded, "Process State");
  if (bytes.length < PROCESS_STATE_FIXED_LENGTH + 1 ||
      !bytes.subarray(0, 8).equals(Buffer.from("ABL_PST1", "ascii"))) {
    fail("process_state_invalid");
  }
  if (bytes.readUInt16LE(8) !== 1) {
    fail("process_state_unsupported_version", bytes.readUInt16LE(8));
  }
  if (bytes.readUInt16LE(10) !== 0) fail("process_state_unknown_flags");
  const programTransitionDigest = Buffer.from(bytes.subarray(12, 44));
  const expectedDigest = normalizeOptionalDigest(
    expectedProgramTransitionDigest,
    "program transition digest",
  );
  if (expectedDigest !== null &&
      !programTransitionDigest.equals(expectedDigest)) {
    fail("process_state_program_digest_mismatch");
  }
  let cursor = PROCESS_STATE_FIXED_LENGTH;
  const frameCountNatural = readNatural(bytes, cursor);
  cursor += frameCountNatural.length;
  if (frameCountNatural.value === 0n) fail("process_state_frame_count_invalid");
  if (frameCountNatural.value > BigInt(bytes.length - cursor)) {
    fail("process_state_frame_count_invalid");
  }
  const frameCount = Number(frameCountNatural.value);
  const frames = [];
  for (let index = 0; index < frameCount; index += 1) {
    const constructor = readNatural(bytes, cursor);
    cursor += constructor.length;
    if (constructor.value > 0xffff_ffffn) {
      fail("process_state_constructor_invalid");
    }
    const environmentLength = readNatural(bytes, cursor);
    cursor += environmentLength.length;
    const length = boundedRemainingLength(
      environmentLength.value,
      bytes.length - cursor,
      "process_state_environment_length",
    );
    const end = cursor + length;
    frames.push(Object.freeze({
      constructorId: Number(constructor.value),
      environment: Buffer.from(bytes.subarray(cursor, end)),
    }));
    cursor = end;
  }
  if (cursor !== bytes.length) fail("process_state_trailing_bytes");
  return Object.freeze({
    bytes,
    programTransitionDigest,
    frameCount,
    frames: Object.freeze(frames),
  });
}

export function decodeRequest(
  encoded,
  {
    expectedProgramTransitionDigest = null,
    expectedState = null,
  } = {},
) {
  const bytes = ownedBytes(encoded, "EffectRequest");
  if (bytes.length < PROCESS_REQUEST_FIXED_LENGTH + 2 ||
      !bytes.subarray(0, 8).equals(Buffer.from("ABL_ERQ1", "ascii"))) {
    fail("process_request_invalid");
  }
  if (bytes.readUInt16LE(8) !== 1) {
    fail("process_request_unsupported_version", bytes.readUInt16LE(8));
  }
  if (bytes.readUInt16LE(10) !== 0) fail("process_request_unknown_flags");
  let cursor = 12;
  const requestIdentity = takeDigest(bytes, cursor);
  cursor += 32;
  const programTransitionDigest = takeDigest(bytes, cursor);
  cursor += 32;
  const preRequestStateDigest = takeDigest(bytes, cursor);
  cursor += 32;
  const effectSiteSemanticDigest = takeDigest(bytes, cursor);
  cursor += 32;
  const payloadSchemaDigest = takeDigest(bytes, cursor);
  cursor += 32;
  const resumeSchemaDigest = takeDigest(bytes, cursor);
  cursor += 32;
  const continuationDigest = takeDigest(bytes, cursor);
  cursor += 32;

  const identityLength = readNatural(bytes, cursor);
  cursor += identityLength.length;
  const semanticLength = boundedRemainingLength(
    identityLength.value,
    bytes.length - cursor,
    "process_request_identity_length",
  );
  if (semanticLength === 0) fail("process_request_identity_empty");
  const identityBytes = Buffer.from(bytes.subarray(cursor, cursor + semanticLength));
  cursor += semanticLength;
  const identity = decodeUtf8(identityBytes, "process request identity");

  const payloadLength = readNatural(bytes, cursor);
  cursor += payloadLength.length;
  const valueLength = boundedRemainingLength(
    payloadLength.value,
    bytes.length - cursor,
    "process_request_payload_length",
  );
  if (cursor + valueLength !== bytes.length) {
    fail("process_request_length");
  }
  const payload = Buffer.from(bytes.subarray(cursor));

  const expectedProgram = normalizeOptionalDigest(
    expectedProgramTransitionDigest,
    "program transition digest",
  );
  if (expectedProgram !== null &&
      !programTransitionDigest.equals(expectedProgram)) {
    fail("process_request_program_digest_mismatch");
  }
  const expectedSiteDigest = effectSemanticDigest(
    identityBytes,
    payloadSchemaDigest,
    resumeSchemaDigest,
  );
  if (!effectSiteSemanticDigest.equals(expectedSiteDigest)) {
    fail("process_request_site_digest_mismatch");
  }
  const expectedIdentity = processRequestIdentity({
    programTransitionDigest,
    preRequestStateDigest,
    effectSiteSemanticDigest,
    payloadSchemaDigest,
    resumeSchemaDigest,
    continuationDigest,
    identityBytes,
    payload,
  });
  if (!requestIdentity.equals(expectedIdentity)) {
    fail("process_request_identity_digest_mismatch");
  }

  if (expectedState !== null) {
    const state = byteView(expectedState, "pending Process State");
    const stateView = decodeProcessState(state, {
      expectedProgramTransitionDigest: programTransitionDigest,
    });
    void stateView;
    if (!preRequestStateDigest.equals(sha256Bytes(state))) {
      fail("process_request_state_digest_mismatch");
    }
    const expectedContinuation = createHash("sha256")
      .update(Buffer.from("boundary-process-continuation-v1\0", "ascii"))
      .update(state)
      .digest();
    if (!continuationDigest.equals(expectedContinuation)) {
      fail("process_request_continuation_digest_mismatch");
    }
  }

  return Object.freeze({
    bytes,
    requestIdentity,
    programTransitionDigest,
    preRequestStateDigest,
    effectSiteSemanticDigest,
    payloadSchemaDigest,
    resumeSchemaDigest,
    continuationDigest,
    identity,
    identityBytes,
    payload,
  });
}

export function decodeResult(
  encoded,
  { expectedRequest = null } = {},
) {
  const bytes = ownedBytes(encoded, "EffectResult");
  if (bytes.length < PROCESS_RESULT_FIXED_LENGTH + 1 ||
      !bytes.subarray(0, 8).equals(Buffer.from("ABL_ERS1", "ascii"))) {
    fail("process_result_invalid");
  }
  if (bytes.readUInt16LE(8) !== 1) {
    fail("process_result_unsupported_version", bytes.readUInt16LE(8));
  }
  if (bytes.readUInt16LE(10) !== 0) fail("process_result_unknown_flags");
  const requestIdentity = Buffer.from(bytes.subarray(12, 44));
  const resumeSchemaDigest = Buffer.from(bytes.subarray(44, 76));
  let cursor = PROCESS_RESULT_FIXED_LENGTH;
  const resumeLength = readNatural(bytes, cursor);
  cursor += resumeLength.length;
  const length = boundedRemainingLength(
    resumeLength.value,
    bytes.length - cursor,
    "process_result_resume_length",
  );
  if (cursor + length !== bytes.length) fail("process_result_length");
  const resume = Buffer.from(bytes.subarray(cursor));

  if (expectedRequest !== null) {
    const expected = requestBinding(expectedRequest);
    if (!requestIdentity.equals(expected.requestIdentity)) {
      fail("process_result_request_mismatch");
    }
    if (!resumeSchemaDigest.equals(expected.resumeSchemaDigest)) {
      fail("process_result_schema_mismatch");
    }
  }
  return Object.freeze({
    bytes,
    requestIdentity,
    resumeSchemaDigest,
    resume,
  });
}

export function encodeResult(request, responseBytes) {
  const binding = requestBinding(request);
  const response = byteView(responseBytes, "EffectResult response");
  const encodedLength = encodeNatural(response.length);
  const bytes = Buffer.concat([
    Buffer.from("ABL_ERS1", "ascii"),
    Buffer.from([1, 0, 0, 0]),
    binding.requestIdentity,
    binding.resumeSchemaDigest,
    encodedLength,
    response,
  ]);
  const decoded = decodeResult(bytes, { expectedRequest: binding });
  if (!decoded.resume.equals(response)) fail("process_result_self_check_failed");
  return bytes;
}

export function readNatural(encoded, start = 0) {
  const bytes = byteView(encoded, "natural encoding");
  if (!Number.isSafeInteger(start) || start < 0 || start > bytes.length) {
    fail("natural_offset_invalid");
  }
  let value = 0n;
  for (let index = 0; index < 10; index += 1) {
    const offset = start + index;
    if (offset >= bytes.length) fail("natural_invalid");
    const byte = bytes[offset];
    const payload = byte & 0x7f;
    if (index === 9 && (payload > 1 || (byte & 0x80) !== 0)) {
      fail("natural_overflow");
    }
    value |= BigInt(payload) << BigInt(index * 7);
    if ((byte & 0x80) === 0) {
      const length = index + 1;
      if (naturalEncodedLength(value) !== length) {
        fail("natural_noncanonical");
      }
      return Object.freeze({ value, length });
    }
  }
  fail("natural_overflow");
}

export function encodeNatural(input) {
  if (typeof input !== "bigint" &&
      (!Number.isSafeInteger(input) || input < 0)) {
    fail("natural_value_invalid");
  }
  const value = typeof input === "bigint" ? input : BigInt(input);
  if (value < 0n || value > MAX_U64) fail("natural_value_invalid");
  let remaining = value;
  const bytes = [];
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining !== 0n) byte |= 0x80;
    bytes.push(byte);
  } while (remaining !== 0n);
  return Buffer.from(bytes);
}

export function sha256Hex(value) {
  return createHash("sha256")
    .update(byteView(value, "SHA-256 input"))
    .digest("hex");
}

export function sha256Bytes(value) {
  return createHash("sha256")
    .update(byteView(value, "SHA-256 input"))
    .digest();
}

async function instantiateUnique(hostState) {
  let instance;
  try {
    instance = await hostState.instantiate(hostState.kernel.module, {});
  } catch {
    fail("process_kernel_instantiate_failed");
  }
  if (instance?.instance instanceof WebAssembly.Instance) {
    instance = instance.instance;
  }
  if (!(instance instanceof WebAssembly.Instance)) {
    fail("process_kernel_instance_invalid");
  }
  const kernelState = compiledKernelState.get(hostState.kernel);
  if (kernelState.usedInstances.has(instance)) {
    fail("process_kernel_instance_reused");
  }
  kernelState.usedInstances.add(instance);
  hostState.freshInstanceCount += 1;
  return instance;
}

function validateInstance(instance, expectedAbiVersion) {
  const abi = instance.exports;
  if (typeof abi.boundary_process_kernel_abi_version !== "function") {
    fail("process_kernel_abi_export_missing");
  }
  const abiVersion = abi.boundary_process_kernel_abi_version();
  if (abiVersion !== expectedAbiVersion) {
    fail("process_kernel_abi_mismatch", abiVersion);
  }
  for (const [name, kind] of PROCESS_KERNEL_EXPORTS) {
    const value = abi[name];
    if (kind === "memory") {
      if (!(value instanceof WebAssembly.Memory)) {
        fail("process_kernel_instance_export_invalid", name);
      }
    } else if (typeof value !== kind) {
      fail("process_kernel_instance_export_invalid", name);
    }
  }
  return abi;
}

function defaultInstantiate(module, imports) {
  return WebAssembly.instantiate(module, imports);
}

function readKernelError(abi) {
  return readWasmExportedBytes(
    abi,
    "boundary_process_kernel_error_ptr",
    "boundary_process_kernel_error_len",
    "process kernel error",
  );
}

function readWasmExportedBytes(abi, pointerName, lengthName, label) {
  const start = wasmOffset(abi[pointerName](), label);
  const length = wasmLength(abi[lengthName](), label);
  const memory = memoryBytes(abi);
  requireWasmRange(memory, start, length, label);
  return Buffer.from(memory.subarray(start, start + length));
}

function memoryBytes(abi) {
  if (!(abi.memory instanceof WebAssembly.Memory)) {
    fail("process_kernel_memory_invalid");
  }
  return new Uint8Array(abi.memory.buffer);
}

function requireWasmRange(memory, start, length, label) {
  if (start > memory.length || length > memory.length - start) {
    fail("process_kernel_memory_range_invalid", label);
  }
}

function wasmOffset(value, label) {
  if (!Number.isInteger(value)) fail("process_kernel_pointer_invalid", label);
  const unsigned = value >>> 0;
  if (value !== unsigned && value !== (unsigned | 0)) {
    fail("process_kernel_pointer_invalid", label);
  }
  return unsigned;
}

function wasmU32(value, label) {
  if (!Number.isInteger(value)) fail("process_kernel_u32_invalid", label);
  const unsigned = value >>> 0;
  if (value !== unsigned && value !== (unsigned | 0)) {
    fail("process_kernel_u32_invalid", label);
  }
  return unsigned;
}

function wasmLength(value, label) {
  if (typeof value === "bigint") {
    if (value < 0n || value > MAX_SAFE_BIGINT) {
      fail("process_kernel_length_invalid", label);
    }
    return Number(value);
  }
  return wasmU32(value, label);
}

function effectSemanticDigest(
  identityBytes,
  payloadSchemaDigest,
  resumeSchemaDigest,
) {
  const hash = createHash("sha256");
  semanticHashBytes(hash, Buffer.from(
    "boundary-effect-site-semantic-contract-v1",
    "ascii",
  ));
  semanticHashBytes(hash, identityBytes);
  hash.update(payloadSchemaDigest);
  hash.update(resumeSchemaDigest);
  semanticHashBytes(hash, Buffer.from("single-resume", "ascii"));
  return hash.digest();
}

function processRequestIdentity({
  programTransitionDigest,
  preRequestStateDigest,
  effectSiteSemanticDigest,
  payloadSchemaDigest,
  resumeSchemaDigest,
  continuationDigest,
  identityBytes,
  payload,
}) {
  const identityLength = Buffer.alloc(8);
  identityLength.writeBigUInt64LE(BigInt(identityBytes.length));
  return createHash("sha256")
    .update(Buffer.from("boundary-process-request-identity-v1\0", "ascii"))
    .update(programTransitionDigest)
    .update(preRequestStateDigest)
    .update(effectSiteSemanticDigest)
    .update(identityLength)
    .update(identityBytes)
    .update(payloadSchemaDigest)
    .update(sha256Bytes(payload))
    .update(continuationDigest)
    .update(resumeSchemaDigest)
    .digest();
}

function semanticHashBytes(hash, bytes) {
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(bytes.length));
  hash.update(length);
  hash.update(bytes);
}

function requestBinding(request) {
  if (request === null || typeof request !== "object") {
    fail("process_result_request_invalid");
  }
  const identity = ownedDigest(request.requestIdentity, "request identity digest");
  const schema = ownedDigest(request.resumeSchemaDigest, "resume schema digest");
  return Object.freeze({
    requestIdentity: identity,
    resumeSchemaDigest: schema,
  });
}

function takeDigest(bytes, offset) {
  if (offset > bytes.length - 32) fail("process_digest_truncated");
  return Buffer.from(bytes.subarray(offset, offset + 32));
}

function normalizeOptionalDigest(value, label) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    if (!/^[0-9a-f]{64}$/.test(value)) fail("process_digest_invalid", label);
    return Buffer.from(value, "hex");
  }
  return ownedDigest(value, label);
}

function ownedDigest(value, label) {
  const bytes = ownedBytes(value, label);
  if (bytes.length !== 32) fail("process_digest_length_invalid", label);
  return bytes;
}

function decodeUtf8(bytes, label) {
  try {
    return utf8Decoder.decode(bytes);
  } catch {
    fail("process_utf8_invalid", label);
  }
}

function naturalEncodedLength(value) {
  let remaining = value;
  let length = 1;
  while (remaining >= 0x80n) {
    remaining >>= 7n;
    length += 1;
  }
  return length;
}

function boundedRemainingLength(value, remaining, code) {
  if (value > BigInt(remaining) || value > MAX_SAFE_BIGINT) fail(code);
  return Number(value);
}

function safeU64Length(value, code) {
  if (value > MAX_SAFE_BIGINT) fail(code);
  return Number(value);
}

function safeAdd(left, right, code) {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) fail(code);
  return sum;
}

function sameExportSurface(actual, expected) {
  if (!Array.isArray(expected) || actual.length !== expected.length) return false;
  return actual.every((entry, index) =>
    Array.isArray(expected[index]) &&
    expected[index].length === 2 &&
    entry[0] === expected[index][0] &&
    entry[1] === expected[index][1]
  );
}

function allZero(bytes) {
  return bytes.every((byte) => byte === 0);
}

function requireCompiledKernel(kernel) {
  if (!compiledKernelState.has(kernel)) fail("process_kernel_not_compiled");
}

function byteView(value, label) {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError(`${label} must be bytes`);
  }
  return value;
}

function ownedBytes(value, label) {
  return Buffer.from(byteView(value, label));
}

function fail(code, detail = undefined) {
  throw new Error(detail === undefined ? code : `${code}:${detail}`);
}
