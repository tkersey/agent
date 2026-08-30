#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  BOUNDARY_IDENTITY,
  TRANSCRIPT_ANCHORS,
  sha256Hex,
  validateTranscriptManifest,
  validateTranscriptPayload,
} from "./transcript_format.mjs";

const GENERATION_RECEIPT_FORMAT =
  "agent-repository-repair-process-generation-receipt/v1";
const PROGRAM_TRANSITION_DIGEST =
  "48eb6ec9a74b9a4c958d78c526f3eacded2ba5baad2402a05465e3f1dbe34816";
const TYPED_IO_DIGEST =
  "bc3a65ec23bd18f166436a508da26d1e474d66a571ad7f8bb47d4cbac920e1b3";
const FINAL_GIT_TREE = "0d9ac8802aac6597cb0a443245efb6f92a0249fe";
const PROGRAM_MAGIC = Buffer.from("ABL_BPI1", "ascii");
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const RELEASE_TAG_PATTERN = /^v2\.7\.(?:0|1)$/;
const RECEIPT_KEYS = Object.freeze([
  "format",
  "result",
  "producerCommit",
  "producerReleaseTag",
  "boundaryCommit",
  "kernelSha256",
  "kernelByteLength",
  "kernelImportCount",
  "processKernelAbiVersion",
  "programImageSha256",
  "programImageByteLength",
  "initialArgsSha256",
  "initialArgsByteLength",
  "programTransitionDigest",
  "reductionCount",
  "residualBoundaryCount",
  "freshWasmInstanceCount",
  "transferAfterBoundary",
  "terminalReductionIndex",
  "typedIoDigest",
  "terminalResultSha256",
  "finalGitTree",
  "manifestSha256",
  "manifestByteLength",
  "payloadSha256",
  "payloadByteLength",
  "artifactCount",
  "deterministicRebuild",
]);
const textDecoder = new TextDecoder("utf-8", { fatal: true });

export class GenerationReceiptValidationError extends Error {
  constructor(code, details = "") {
    super(details === "" ? code : `${code}:${details}`);
    this.name = "GenerationReceiptValidationError";
    this.code = code;
  }
}

function fail(code, details = "") {
  throw new GenerationReceiptValidationError(code, details);
}

function exactKeys(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    fail("generation_receipt_not_object");
  }
  const actual = Object.keys(value);
  const expected = new Set(RECEIPT_KEYS);
  for (const key of RECEIPT_KEYS) {
    if (!Object.hasOwn(value, key)) fail("generation_receipt_field_missing", key);
  }
  for (const key of actual) {
    if (!expected.has(key)) fail("generation_receipt_field_unexpected", key);
  }
}

function exact(value, expected, label) {
  if (value !== expected) fail(`generation_receipt_${label}_mismatch`, `${value}`);
}

function parseReceipt(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    fail("generation_receipt_bytes_required");
  }
  let text;
  try {
    text = textDecoder.decode(bytes);
  } catch {
    fail("generation_receipt_utf8_invalid");
  }
  let receipt;
  try {
    receipt = JSON.parse(text);
  } catch {
    fail("generation_receipt_json_invalid");
  }
  exactKeys(receipt);
  const canonical = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  if (!Buffer.from(bytes).equals(canonical)) fail("generation_receipt_encoding_noncanonical");
  return receipt;
}

function equalBytes(actual, expected, label) {
  if (!(actual instanceof Uint8Array) || !(expected instanceof Uint8Array) ||
      !Buffer.from(actual).equals(Buffer.from(expected))) {
    fail(`generation_receipt_${label}_mismatch`);
  }
}

function validateProgramImage(imageBytes) {
  exact(imageBytes.byteLength, TRANSCRIPT_ANCHORS.programImageByteLength, "program_image_byte_length");
  exact(sha256Hex(imageBytes), TRANSCRIPT_ANCHORS.programImageSha256, "program_image_sha256");
  if (!Buffer.from(imageBytes.subarray(0, PROGRAM_MAGIC.length)).equals(PROGRAM_MAGIC)) {
    fail("generation_receipt_program_image_magic_mismatch");
  }
  if (imageBytes.byteLength < 64) fail("generation_receipt_program_image_too_short");
  const transitionDigest = Buffer.from(imageBytes.subarray(32, 64)).toString("hex");
  exact(transitionDigest, PROGRAM_TRANSITION_DIGEST, "program_transition_digest");
  return transitionDigest;
}

async function validateKernel(kernelBytes) {
  exact(kernelBytes.byteLength, BOUNDARY_IDENTITY.kernelByteLength, "kernel_byte_length");
  const kernelSha256 = sha256Hex(kernelBytes);
  exact(kernelSha256, BOUNDARY_IDENTITY.kernelSha256, "kernel_sha256");
  if (!WebAssembly.validate(kernelBytes)) fail("generation_receipt_kernel_wasm_invalid");
  const module = await WebAssembly.compile(kernelBytes);
  const imports = WebAssembly.Module.imports(module);
  exact(imports.length, 0, "kernel_import_count");
  const instance = await WebAssembly.instantiate(module, {});
  const abiVersion = instance.exports.boundary_process_kernel_abi_version;
  if (typeof abiVersion !== "function") fail("generation_receipt_kernel_abi_export_missing");
  const observedAbiVersion = abiVersion();
  exact(observedAbiVersion, BOUNDARY_IDENTITY.processKernelAbiVersion, "process_kernel_abi_version");
  return Object.freeze({
    sha256: kernelSha256,
    byteLength: kernelBytes.byteLength,
    importCount: imports.length,
    processKernelAbiVersion: observedAbiVersion,
  });
}

export async function validateGenerationReceipt({
  receiptBytes,
  manifestBytes,
  payloadBytes,
  imageBytes,
  initialArgsBytes,
  kernelBytes,
} = {}) {
  for (const [label, bytes] of Object.entries({
    receipt: receiptBytes,
    manifest: manifestBytes,
    payload: payloadBytes,
    image: imageBytes,
    initial_args: initialArgsBytes,
    kernel: kernelBytes,
  })) {
    if (!(bytes instanceof Uint8Array)) fail(`generation_receipt_${label}_bytes_required`);
  }

  const receipt = parseReceipt(receiptBytes);
  const manifest = validateTranscriptManifest(manifestBytes);
  const artifacts = validateTranscriptPayload(manifest, payloadBytes);
  const kernel = await validateKernel(kernelBytes);
  const transitionDigest = validateProgramImage(imageBytes);

  exact(initialArgsBytes.byteLength, TRANSCRIPT_ANCHORS.initialArgsByteLength, "initial_args_byte_length");
  exact(sha256Hex(initialArgsBytes), TRANSCRIPT_ANCHORS.initialArgsSha256, "initial_args_sha256");
  equalBytes(artifacts.get(manifest.transcript.programImage), imageBytes, "payload_program_image");
  equalBytes(artifacts.get(manifest.transcript.initialArgs), initialArgsBytes, "payload_initial_args");

  const manifestSha256 = sha256Hex(manifestBytes);
  const payloadSha256 = sha256Hex(payloadBytes);
  const producer = manifest.producer;
  if (!RELEASE_TAG_PATTERN.test(producer.releaseTag)) {
    fail("generation_receipt_producer_release_tag_invalid", producer.releaseTag);
  }
  if (!COMMIT_PATTERN.test(producer.commit)) {
    fail("generation_receipt_producer_commit_invalid", producer.commit);
  }

  const expected = {
    format: GENERATION_RECEIPT_FORMAT,
    result: "passed",
    producerCommit: producer.commit,
    producerReleaseTag: producer.releaseTag,
    boundaryCommit: BOUNDARY_IDENTITY.commit,
    kernelSha256: kernel.sha256,
    kernelByteLength: kernel.byteLength,
    kernelImportCount: kernel.importCount,
    processKernelAbiVersion: kernel.processKernelAbiVersion,
    programImageSha256: sha256Hex(imageBytes),
    programImageByteLength: imageBytes.byteLength,
    initialArgsSha256: sha256Hex(initialArgsBytes),
    initialArgsByteLength: initialArgsBytes.byteLength,
    programTransitionDigest: transitionDigest,
    reductionCount: manifest.transcript.expectedOutcomes.length,
    residualBoundaryCount: manifest.transcript.requests.length,
    freshWasmInstanceCount: TRANSCRIPT_ANCHORS.freshWasmInstanceCount,
    transferAfterBoundary: manifest.transcript.transferAfterBoundary,
    terminalReductionIndex: manifest.transcript.terminal.reductionIndex,
    typedIoDigest: TYPED_IO_DIGEST,
    terminalResultSha256: manifest.transcript.terminal.resultSha256,
    finalGitTree: FINAL_GIT_TREE,
    manifestSha256,
    manifestByteLength: manifestBytes.byteLength,
    payloadSha256,
    payloadByteLength: payloadBytes.byteLength,
    artifactCount: artifacts.size,
    deterministicRebuild: true,
  };
  for (const key of RECEIPT_KEYS) exact(receipt[key], expected[key], key);

  exact(manifest.boundary.commit, BOUNDARY_IDENTITY.commit, "manifest_boundary_commit");
  exact(manifest.boundary.kernelSha256, kernel.sha256, "manifest_kernel_sha256");
  exact(manifest.boundary.kernelByteLength, kernel.byteLength, "manifest_kernel_byte_length");
  exact(
    manifest.boundary.processKernelAbiVersion,
    kernel.processKernelAbiVersion,
    "manifest_process_kernel_abi_version",
  );
  exact(manifest.payload.sha256, payloadSha256, "manifest_payload_sha256");
  exact(manifest.payload.byteLength, payloadBytes.byteLength, "manifest_payload_byte_length");
  exact(artifacts.size, TRANSCRIPT_ANCHORS.artifactCount, "artifact_count");
  exact(receipt.reductionCount, TRANSCRIPT_ANCHORS.reductionCount, "reduction_count_anchor");
  exact(
    receipt.residualBoundaryCount,
    TRANSCRIPT_ANCHORS.residualBoundaryCount,
    "residual_boundary_count_anchor",
  );
  exact(
    receipt.freshWasmInstanceCount,
    TRANSCRIPT_ANCHORS.freshWasmInstanceCount,
    "fresh_wasm_instance_count_anchor",
  );
  exact(receipt.transferAfterBoundary, TRANSCRIPT_ANCHORS.transferAfterBoundary, "transfer_boundary_anchor");
  exact(
    receipt.terminalReductionIndex,
    TRANSCRIPT_ANCHORS.terminalReductionIndex,
    "terminal_reduction_index_anchor",
  );
  exact(
    receipt.terminalResultSha256,
    TRANSCRIPT_ANCHORS.terminalResultSha256,
    "terminal_result_sha256_anchor",
  );

  return Object.freeze({
    format: "agent-repository-repair-process-generation-receipt-validation/v1",
    result: "passed",
    producerReleaseTag: producer.releaseTag,
    producerCommit: producer.commit,
    manifestSha256,
    payloadSha256,
    artifactCount: artifacts.size,
  });
}

function parseArgs(argv) {
  const aliases = Object.freeze({
    "--receipt": "receipt",
    "--manifest": "manifest",
    "--payload": "payload",
    "--image": "image",
    "--initial-args": "initialArgs",
    "--kernel": "kernel",
  });
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    const key = aliases[name];
    if (key === undefined || value === undefined || Object.hasOwn(options, key)) {
      throw new Error(`generation_receipt_argument_invalid:${name ?? "missing"}`);
    }
    options[key] = value;
  }
  for (const key of Object.values(aliases)) {
    if (options[key] === undefined) throw new Error(`generation_receipt_argument_missing:${key}`);
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const [receiptBytes, manifestBytes, payloadBytes, imageBytes, initialArgsBytes, kernelBytes] =
    await Promise.all([
      readFile(options.receipt),
      readFile(options.manifest),
      readFile(options.payload),
      readFile(options.image),
      readFile(options.initialArgs),
      readFile(options.kernel),
    ]);
  const result = await validateGenerationReceipt({
    receiptBytes,
    manifestBytes,
    payloadBytes,
    imageBytes,
    initialArgsBytes,
    kernelBytes,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const isMain = process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
