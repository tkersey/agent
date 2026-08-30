#!/usr/bin/env bun

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  advanceFresh,
  compileProcessKernel,
  createProcessKernelHost,
  decodeOutcome,
  decodeRequest,
  decodeResult,
  forkProcessKernelHost,
} from "./process_kernel_client.mjs";
import {
  sha256Hex,
  MAX_MANIFEST_BYTES,
  MAX_PAYLOAD_BYTES,
  TRANSCRIPT_ANCHORS,
  validateTranscriptManifest,
  validateTranscriptPayload,
} from "./transcript_format.mjs";

export async function replayTranscript({ kernelBytes, manifestBytes, payloadBytes } = {}) {
  requireBytes(kernelBytes, "replay_kernel_bytes_required");
  requireBytes(manifestBytes, "replay_manifest_bytes_required");
  requireBytes(payloadBytes, "replay_payload_bytes_required");

  const manifest = validateTranscriptManifest(manifestBytes);
  const artifacts = validateTranscriptPayload(manifest, payloadBytes);
  const kernel = await compileProcessKernel(kernelBytes, {
    expectedByteLength: manifest.boundary.kernelByteLength,
    expectedSha256: manifest.boundary.kernelSha256,
    expectedAbiVersion: manifest.boundary.processKernelAbiVersion,
  });
  let host = createProcessKernelHost(kernel);
  if (host.usesDefaultInstantiation !== true) {
    throw new Error("replay_nonstandard_instantiation_rejected");
  }

  const image = artifact(artifacts, manifest.transcript.programImage);
  let current = artifact(artifacts, manifest.transcript.initialArgs);
  let isState = false;
  let effectResult = null;
  let boundaryIndex = 0;
  let semanticInstanceCount = 0;
  let transferRecovered = false;
  let terminal = null;

  for (const expectedEntry of manifest.transcript.expectedOutcomes) {
    const reductionIndex = expectedEntry.reductionIndex;
    const expectedBytes = artifact(artifacts, expectedEntry.artifact);
    const expectedOutcome = decodeOutcome(expectedBytes);
    if (expectedOutcome.kindName !== expectedEntry.kind) {
      throw new Error(
        `replay_expected_artifact_kind_mismatch:${reductionIndex}:${expectedOutcome.kindName}:${expectedEntry.kind}`,
      );
    }

    const actual = await advanceFresh(host, {
      image,
      current,
      isState,
      effectResult,
    });
    semanticInstanceCount += 1;
    effectResult = null;

    if (actual.kindName !== expectedEntry.kind) {
      throw new Error(`replay_kind_mismatch:${reductionIndex}:${actual.kindName}:${expectedEntry.kind}`);
    }
    if (!bytesEqual(actual.bytes, expectedBytes)) {
      throw new Error(`replay_outcome_mismatch:${reductionIndex}`);
    }

    switch (actual.kindName) {
      case "Progressed":
      case "ExplicitlyYielded":
        current = requireOutcomeState(actual, reductionIndex);
        isState = true;
        break;
      case "Requested": {
        current = requireOutcomeState(actual, reductionIndex);
        isState = true;
        const requestEntry = manifest.transcript.requests[boundaryIndex];
        const resultEntry = manifest.transcript.effectResults[boundaryIndex];
        if (requestEntry === undefined || requestEntry.boundaryIndex !== boundaryIndex ||
            requestEntry.reductionIndex !== reductionIndex) {
          throw new Error(`replay_request_index_mismatch:${boundaryIndex}:${reductionIndex}`);
        }
        if (resultEntry === undefined || resultEntry.boundaryIndex !== boundaryIndex) {
          throw new Error(`replay_effect_result_missing:${boundaryIndex}`);
        }

        const expectedRequestBytes = artifact(artifacts, requestEntry.artifact);
        const expectedRequest = decodeRequest(expectedRequestBytes, { expectedState: current });
        const actualRequestBytes = actual.request;
        if (!(actualRequestBytes instanceof Uint8Array) ||
            !bytesEqual(actualRequestBytes, expectedRequestBytes)) {
          throw new Error(`replay_request_mismatch:${boundaryIndex}`);
        }
        const actualRequest = decodeRequest(actualRequestBytes, { expectedState: current });
        if (!bytesEqual(actualRequest.bytes, expectedRequest.bytes)) {
          throw new Error(`replay_request_mismatch:${boundaryIndex}`);
        }

        if (boundaryIndex === manifest.transcript.transferAfterBoundary) {
          if (transferRecovered) throw new Error("replay_transfer_repeated");
          const reconstructionHost = forkProcessKernelHost(host);
          if (reconstructionHost.usesDefaultInstantiation !== true) {
            throw new Error("replay_nonstandard_reconstruction_instantiation_rejected");
          }
          const reconstructed = await advanceFresh(reconstructionHost, {
            image,
            current,
            isState: true,
            effectResult: null,
          });
          semanticInstanceCount += 1;
          const reconstructedRequest = reconstructed.request;
          if (reconstructed.kindName !== "Requested" ||
              !bytesEqual(reconstructed.bytes, actual.bytes) ||
              !bytesEqual(reconstructed.state, current) ||
              !(reconstructedRequest instanceof Uint8Array) ||
              !bytesEqual(reconstructedRequest, expectedRequestBytes)) {
            throw new Error(`replay_reconstruction_mismatch:${boundaryIndex}`);
          }
          decodeRequest(reconstructedRequest, { expectedState: reconstructed.state });
          current = Buffer.from(reconstructed.state);
          host = reconstructionHost;
          transferRecovered = true;
        }

        const recordedResult = artifact(artifacts, resultEntry.artifact);
        decodeResult(recordedResult, { expectedRequest: actualRequest });
        effectResult = recordedResult;
        boundaryIndex += 1;
        break;
      }
      case "Completed":
        if (reductionIndex !== manifest.transcript.terminal.reductionIndex || terminal !== null) {
          throw new Error(`replay_terminal_shape:${reductionIndex}`);
        }
        if (!(actual.result instanceof Uint8Array)) {
          throw new Error("replay_terminal_result_missing");
        }
        terminal = actual;
        break;
      case "AuthoredFailure":
      case "NeedsCapacity":
        throw new Error(`replay_forbidden_outcome:${reductionIndex}:${actual.kindName}`);
      default:
        throw new Error(`replay_unknown_outcome:${reductionIndex}:${actual.kindName}`);
    }
  }

  if (manifest.transcript.expectedOutcomes.length !== TRANSCRIPT_ANCHORS.reductionCount) {
    throw new Error(
      `replay_reduction_count_mismatch:${manifest.transcript.expectedOutcomes.length}`,
    );
  }
  if (boundaryIndex !== manifest.transcript.residualBoundaryCount ||
      boundaryIndex !== TRANSCRIPT_ANCHORS.residualBoundaryCount) {
    throw new Error(`replay_residual_boundary_count_mismatch:${boundaryIndex}`);
  }
  if (!transferRecovered) throw new Error("replay_transfer_not_recovered");
  if (terminal === null || terminal.kindName !== "Completed" ||
      manifest.transcript.terminal.reductionIndex !== TRANSCRIPT_ANCHORS.terminalReductionIndex) {
    throw new Error("replay_terminal_shape");
  }
  const terminalResultSha256 = sha256Hex(terminal.result);
  if (terminalResultSha256 !== manifest.transcript.terminal.resultSha256) {
    throw new Error(
      `replay_terminal_result_digest_mismatch:${terminalResultSha256}`,
    );
  }
  if (semanticInstanceCount !== manifest.receipt.freshWasmInstanceCount ||
      semanticInstanceCount !== TRANSCRIPT_ANCHORS.freshWasmInstanceCount) {
    throw new Error(`replay_fresh_instance_count_mismatch:${semanticInstanceCount}`);
  }

  return Object.freeze({
    format: "agent-repository-repair-process-transcript-replay/v1",
    result: "passed",
    kernelSha256: kernel.sha256,
    kernelByteLength: kernel.byteLength,
    kernelImportCount: kernel.importCount,
    processKernelAbiVersion: manifest.boundary.processKernelAbiVersion,
    payloadSha256: manifest.payload.sha256,
    payloadByteLength: manifest.payload.byteLength,
    artifactCount: artifacts.size,
    reductionCount: manifest.transcript.reductionCount,
    residualBoundaryCount: boundaryIndex,
    freshWasmInstanceCount: semanticInstanceCount,
    transferAfterBoundary: manifest.transcript.transferAfterBoundary,
    transferRecovered,
    terminalReductionIndex: manifest.transcript.terminal.reductionIndex,
    terminalResultSha256,
  });
}

function artifact(artifacts, id) {
  const bytes = artifacts.get(id);
  if (!(bytes instanceof Uint8Array)) throw new Error(`replay_artifact_missing:${id}`);
  return bytes;
}

function requireOutcomeState(outcome, reductionIndex) {
  const state = outcome.state ?? outcome.primary;
  if (!(state instanceof Uint8Array)) {
    throw new Error(`replay_state_missing:${reductionIndex}`);
  }
  return Buffer.from(state);
}

function bytesEqual(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) ||
      left.byteLength !== right.byteLength) return false;
  return Buffer.from(left.buffer, left.byteOffset, left.byteLength).equals(
    Buffer.from(right.buffer, right.byteOffset, right.byteLength),
  );
}

function requireBytes(value, code) {
  if (!(value instanceof Uint8Array)) throw new TypeError(code);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error("usage: replay.mjs --kernel FILE --manifest FILE --payload FILE");
    }
    const key = {
      "--kernel": "kernel",
      "--manifest": "manifest",
      "--payload": "payload",
    }[name];
    if (key === undefined || options[key] !== undefined) {
      throw new Error(`replay_argument_invalid:${name}`);
    }
    options[key] = value;
  }
  for (const key of ["kernel", "manifest", "payload"]) {
    if (options[key] === undefined) throw new Error(`replay_argument_missing:${key}`);
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const [manifestStat, payloadStat] = await Promise.all([
    stat(options.manifest),
    stat(options.payload),
  ]);
  requireAdmittedFileSize(manifestStat, 1, MAX_MANIFEST_BYTES, "manifest");
  requireAdmittedFileSize(payloadStat, 1, MAX_PAYLOAD_BYTES, "payload");
  const [kernelBytes, manifestBytes, payloadBytes] = await Promise.all([
    readFile(options.kernel),
    readFile(options.manifest),
    readFile(options.payload),
  ]);
  const receipt = await replayTranscript({ kernelBytes, manifestBytes, payloadBytes });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

function requireAdmittedFileSize(metadata, minimum, maximum, label) {
  if (!metadata.isFile() || metadata.size < minimum || metadata.size > maximum) {
    throw new Error(`replay_${label}_file_size_invalid:${metadata.size}`);
  }
}

const isMain = process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
