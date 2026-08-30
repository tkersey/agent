#!/usr/bin/env bun

import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";

import {
  advanceFresh,
  compileProcessKernel,
  createProcessKernelHost,
  decodeOutcome,
  decodeRequest,
  decodeResult,
  encodeResult,
  readNatural,
  sha256Hex as clientSha256Hex,
} from "./process_kernel_client.mjs";
import { replayTranscript } from "./replay.mjs";
import { validateGenerationReceipt } from "./validate_generation_receipt.mjs";
import {
  TRANSCRIPT_ANCHORS,
  TRANSCRIPT_MANIFEST_ASSET_NAME,
  TRANSCRIPT_PAYLOAD_ASSET_NAME,
  encodeCanonicalManifest,
  sha256Hex,
  validateReleaseMetadata,
  validateTranscriptManifest,
  validateTranscriptPayload,
} from "./transcript_format.mjs";

const FORMAT_ERRORS = Object.freeze([
  "AGENT_TRANSCRIPT_MANIFEST_INVALID",
  "AGENT_TRANSCRIPT_MANIFEST_INCOMPLETE",
]);
const PAYLOAD_ERROR = "AGENT_TRANSCRIPT_PAYLOAD_INVALID";
const RELEASE_ERROR = "AGENT_TRANSCRIPT_RELEASE_INVALID";
const GENERATION_MODULE_URL = new URL("./generate.mjs", import.meta.url);
const CHECK_RELEASE_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const CANONICAL_AGENT_HTTPS_ORIGIN = "https://github.com/tkersey/agent.git";

export async function runNegativeTests(options = {}) {
  if (typeof options.gitExecutable !== "string" || options.gitExecutable.length === 0) {
    throw new Error("negative_tests_input_missing:git-executable");
  }
  const [
    kernelBytes,
    manifestBytes,
    payloadBytes,
    imageBytes,
    initialArgsBytes,
    generationReceiptBytes,
  ] = await Promise.all([
    loadBytes(options, "kernel"),
    loadBytes(options, "manifest"),
    loadBytes(options, "payload"),
    loadBytes(options, "image"),
    loadBytes(options, "initialArgs", "initial-args"),
    loadBytes(options, "generationReceipt", "generation-receipt"),
  ]);
  const generation = await import(GENERATION_MODULE_URL.href);

  const manifest = validateTranscriptManifest(manifestBytes);
  const artifacts = validateTranscriptPayload(manifest, payloadBytes);
  const kernel = await compileProcessKernel(kernelBytes);
  assertBytesEqual(artifacts.get("program-image"), imageBytes, "baseline_program_image_binding");
  assertBytesEqual(artifacts.get("initial-args"), initialArgsBytes, "baseline_initial_args_binding");

  if (typeof generation.validateProgramImage !== "function" ||
      typeof generation.programTransitionDigest !== "function" ||
      typeof generation.validateRunAnchors !== "function") {
    throw new Error("negative_tests_generation_exports_missing");
  }
  generation.validateProgramImage(imageBytes);
  if (typeof generation.validateInitialArgs === "function") {
    generation.validateInitialArgs(initialArgsBytes);
  }

  const gates = {};
  const gate = async (name, operation, expected) => {
    if (Object.hasOwn(gates, name)) throw new Error(`negative_gate_duplicate:${name}`);
    await expectRejected(name, operation, expected);
    gates[name] = true;
  };
  const proof = async (name, operation) => {
    if (Object.hasOwn(gates, name)) throw new Error(`negative_gate_duplicate:${name}`);
    await operation();
    gates[name] = true;
  };

  await immutableInputAndKernelGates({
    gate,
    generation,
    kernel,
    kernelBytes,
    imageBytes,
    initialArgsBytes,
  });
  await semanticAnchorGates({ gate, generation, manifest, artifacts });
  await producerTupleGates({
    gate,
    proof,
    generation,
    gitExecutable: options.gitExecutable,
  });
  await generationReceiptGates({
    gate,
    proof,
    receiptBytes: generationReceiptBytes,
    manifestBytes,
    payloadBytes,
    imageBytes,
    initialArgsBytes,
    kernelBytes,
  });
  await manifestAndPayloadGates({ gate, manifest, manifestBytes, payloadBytes });
  await wireCodecGates({ gate, manifest, artifacts });
  await determinismAndPublicationGates({
    gate,
    generation,
    manifest,
    manifestBytes,
    payloadBytes,
    kernelBytes,
  });

  if (Object.values(gates).some((value) => value !== true)) {
    throw new Error("negative_gate_incomplete");
  }
  return Object.freeze({
    format: "agent-repository-repair-process-transcript-negative-tests/v1",
    result: "passed",
    gateCount: Object.keys(gates).length,
    gates: Object.freeze({ ...gates }),
  });
}

async function immutableInputAndKernelGates({
  gate,
  generation,
  kernel,
  kernelBytes,
  imageBytes,
  initialArgsBytes,
}) {
  await gate("wrong_bpi1_byte_length", () => {
    generation.validateProgramImage(imageBytes.subarray(0, imageBytes.length - 1));
  }, ["program_image_byte_length", "program_image_byte_length_mismatch"]);

  const imageDigestMutant = flipByte(imageBytes, imageBytes.length - 1);
  await gate("wrong_bpi1_digest", () => {
    generation.validateProgramImage(imageDigestMutant);
  }, ["program_image_sha256", "program_image_sha256_mismatch"]);

  const observedTransition = generation.programTransitionDigest(imageBytes);
  const wrongTransition = differentDigest(observedTransition);
  await gate("wrong_program_transition_digest", () => {
    generation.validateProgramImage(imageBytes, {
      byteLength: imageBytes.length,
      sha256: clientSha256Hex(imageBytes),
      transitionDigest: wrongTransition,
    });
  }, ["program_transition_digest", "program_transition_digest_mismatch"]);

  if (typeof generation.validateInitialArgs === "function") {
    await gate("wrong_initial_args_byte_length", () => {
      generation.validateInitialArgs(initialArgsBytes.subarray(0, initialArgsBytes.length - 1));
    }, ["initial_args_byte_length", "initial_args_byte_length_mismatch"]);
    await gate("wrong_initial_args_digest", () => {
      generation.validateInitialArgs(flipByte(initialArgsBytes, initialArgsBytes.length - 1));
    }, ["initial_args_sha256", "initial_args_sha256_mismatch"]);
  }

  await gate("wrong_kernel_byte_length", () => compileProcessKernel(
    kernelBytes.subarray(0, kernelBytes.length - 1),
  ), "process_kernel_byte_length_mismatch");
  await gate("wrong_kernel_digest", () => compileProcessKernel(
    flipByte(kernelBytes, kernelBytes.length - 1),
  ), "process_kernel_sha256_mismatch");

  const invalidWasm = Buffer.alloc(16, 0);
  await gate("invalid_kernel_wasm", () => compileProcessKernel(invalidWasm, {
    expectedByteLength: invalidWasm.length,
    expectedSha256: clientSha256Hex(invalidWasm),
    expectedExports: [],
  }), "process_kernel_validate_failed");

  const importedWasm = wasmWithSingleImport();
  await gate("kernel_imports", () => compileProcessKernel(importedWasm, {
    expectedByteLength: importedWasm.length,
    expectedSha256: clientSha256Hex(importedWasm),
    expectedExports: [],
  }), "process_kernel_imports_present");

  const abiTwoWasm = wasmWithAbiVersion(2);
  const abiTwoKernel = await compileProcessKernel(abiTwoWasm, {
    expectedByteLength: abiTwoWasm.length,
    expectedSha256: clientSha256Hex(abiTwoWasm),
    expectedExports: [["boundary_process_kernel_abi_version", "function"]],
  });
  await gate("wrong_process_kernel_abi", () => advanceFresh(
    createProcessKernelHost(abiTwoKernel),
    {
      image: Buffer.from([0]),
      current: Buffer.from([0]),
      isState: false,
      effectResult: null,
    },
  ), "process_kernel_abi_mismatch");

  const reusedInstance = await WebAssembly.instantiate(kernel.module, {});
  const reusedHost = createProcessKernelHost(kernel, {
    instantiate: async () => reusedInstance,
  });
  await advanceFresh(reusedHost, {
    image: imageBytes,
    current: initialArgsBytes,
    isState: false,
    effectResult: null,
  });
  await gate("reused_wasm_instance", () => advanceFresh(reusedHost, {
    image: imageBytes,
    current: initialArgsBytes,
    isState: false,
    effectResult: null,
  }), "process_kernel_instance_reused");
}

async function semanticAnchorGates({ gate, generation, manifest, artifacts }) {
  const run = generationRunFixture(generation, manifest, artifacts);

  for (const [suffix, delta] of [["fewer", -1], ["more", 1]]) {
    await gate(`${suffix}_than_96_reductions`, () => generation.validateRunAnchors({
      ...run,
      reductionCount: TRANSCRIPT_ANCHORS.reductionCount + delta,
    }), ["reduction_count", "reduction_count_mismatch"]);
  }

  const fewerRequestedKinds = [...run.outcomeKinds];
  fewerRequestedKinds[fewerRequestedKinds.indexOf("Requested")] = "Progressed";
  await gate("fewer_than_17_requested_outcomes", () => generation.validateRunAnchors({
    ...run,
    outcomeKinds: fewerRequestedKinds,
  }), ["requested_count", "requested_outcome_count_mismatch"]);
  const moreRequestedKinds = [...run.outcomeKinds];
  const progressedIndex = moreRequestedKinds.findIndex((kind, index) =>
    index !== TRANSCRIPT_ANCHORS.terminalReductionIndex && kind === "Progressed");
  moreRequestedKinds[progressedIndex] = "Requested";
  await gate("more_than_17_requested_outcomes", () => generation.validateRunAnchors({
    ...run,
    outcomeKinds: moreRequestedKinds,
  }), ["requested_count", "requested_outcome_count_mismatch"]);
  await gate("fewer_than_17_request_records", () => generation.validateRunAnchors({
    ...run,
    effectIdentities: run.effectIdentities.slice(0, -1),
    requestReductionIndices: run.requestReductionIndices.slice(0, -1),
  }), ["requested_count", "requested_outcome_count_mismatch"]);
  await gate("more_than_17_request_records", () => generation.validateRunAnchors({
    ...run,
    effectIdentities: [...run.effectIdentities, run.effectIdentities.at(-1)],
    requestReductionIndices: [...run.requestReductionIndices, run.requestReductionIndices.at(-1)],
  }), ["requested_count", "requested_outcome_count_mismatch"]);

  const driftedIdentities = [...run.effectIdentities];
  [driftedIdentities[0], driftedIdentities[1]] = [driftedIdentities[1], driftedIdentities[0]];
  await gate("effect_identity_order_drift", () => generation.validateRunAnchors({
    ...run,
    effectIdentities: driftedIdentities,
  }), ["effect_identity_order", "effect_trace_mismatch"]);

  await gate("completion_before_reduction_95", () => generation.validateRunAnchors({
    ...run,
    terminalReductionIndex: 94,
  }), ["terminal_reduction", "completion_before_terminal_reduction"]);
  await gate("completion_after_reduction_95", () => generation.validateRunAnchors({
    ...run,
    terminalReductionIndex: 96,
  }), ["terminal_reduction", "completion_after_terminal_reduction"]);
  await gate("authored_failure", () => generation.validateRunAnchors({
    ...run,
    outcomeKinds: replaceFirstProgressedKind(run.outcomeKinds, "AuthoredFailure"),
  }), ["terminal_kind", "unexpected_authored_failure", "forbidden_outcome"]);
  await gate("needs_capacity", () => generation.validateRunAnchors({
    ...run,
    outcomeKinds: replaceFirstProgressedKind(run.outcomeKinds, "NeedsCapacity"),
  }), ["terminal_kind", "unexpected_needs_capacity", "forbidden_outcome"]);
  await gate("terminal_result_digest_drift", () => generation.validateRunAnchors({
    ...run,
    terminalResultSha256: differentDigest(run.terminalResultSha256),
  }), ["terminal_result_sha256", "terminal_result_digest_mismatch"]);
  await gate("typed_io_digest_drift", () => generation.validateRunAnchors({
    ...run,
    typedIoDigest: differentDigest(run.typedIoDigest),
  }), ["typed_io_digest", "typed_io_digest_mismatch"]);
  await gate("final_git_tree_drift", () => generation.validateRunAnchors({
    ...run,
    finalGitTree: "0".repeat(40),
  }), ["final_git_tree", "final_git_tree_mismatch"]);
  await gate("failed_request_reconstruction", () => generation.validateRunAnchors({
    ...run,
    transferRecovered: false,
    requestReconstruction: false,
  }), ["request_reconstruction", "transferred_request_recovery_mismatch"]);
  for (const transferAfterBoundary of [7, 9]) {
    await gate(`transfer_at_boundary_${transferAfterBoundary}`, () => generation.validateRunAnchors({
      ...run,
      transferAfterBoundary,
    }), ["transfer_boundary", "transfer_boundary_index_mismatch"]);
  }
}

async function producerTupleGates({ gate, proof, generation, gitExecutable }) {
  if (typeof generation.validateProducerTuple !== "function") {
    throw new Error("negative_tests_producer_tuple_export_missing");
  }

  await withTemporaryRoot("agent-transcript-package-2.7.1-", async (agentRoot) => {
    await writePackageSurfaces(agentRoot, "2.7.1", { decoys: true });
    await proof("check_mode_derives_2_7_1_release_tag", async () => {
      const producer = await generation.validateProducerTuple({
        agentRoot,
        mode: "check",
        releaseTag: "-",
        releaseCommit: CHECK_RELEASE_COMMIT,
        gitExecutable,
      });
      assertExact(producer.releaseTag, "v2.7.1", "check_mode_release_tag_not_package_derived");
      assertExact(
        producer.releaseUrl,
        "https://github.com/tkersey/agent/releases/tag/v2.7.1",
        "check_mode_release_url_not_package_derived",
      );
    });
    await gate("check_mode_rejects_non_package_release_tag", () =>
      generation.validateProducerTuple({
        agentRoot,
        mode: "check",
        releaseTag: "v2.7.0",
        releaseCommit: CHECK_RELEASE_COMMIT,
        gitExecutable,
      }), "package_version_tag_relation");
    await gate("release_mode_rejects_fixed_check_tuple", () =>
      generation.validateProducerTuple({
        agentRoot,
        mode: "release",
        releaseTag: "v2.7.1",
        releaseCommit: CHECK_RELEASE_COMMIT,
        gitExecutable,
      }), "release_test_tuple_forbidden");
  });

  await withTemporaryRoot("agent-transcript-version-decoy-", async (agentRoot) => {
    await writeDecoyOnlyPackageSurfaces(agentRoot);
    await gate("unanchored_comment_version_decoys_rejected", () =>
      generation.validateProducerTuple({
        agentRoot,
        mode: "check",
        releaseTag: "-",
        releaseCommit: CHECK_RELEASE_COMMIT,
        gitExecutable,
      }), "package_version_missing");
  });

  await withReleaseRepository("2.7.0", async ({ agentRoot, originRoot, releaseCommit }) => {
    await proof("release_mode_admits_free_remote_v2_7_0", async () => {
      const producer = await generation.validateProducerTuple({
        agentRoot,
        mode: "release",
        releaseTag: "v2.7.0",
        releaseCommit,
        gitExecutable,
      });
      assertExact(producer.releaseTag, "v2.7.0", "free_remote_v2_7_0_not_admitted");
    });
    setBareTag(originRoot, "v2.7.0", releaseCommit);
    await gate("release_mode_rejects_occupied_remote_selected_tag", () =>
      generation.validateProducerTuple({
        agentRoot,
        mode: "release",
        releaseTag: "v2.7.0",
        releaseCommit,
        gitExecutable,
      }), "release_remote_tag_already_exists");
  });

  await withReleaseRepository("2.7.1", async ({ agentRoot, originRoot, releaseCommit }) => {
    await gate("release_mode_rejects_v2_7_1_while_v2_7_0_is_free", () =>
      generation.validateProducerTuple({
        agentRoot,
        mode: "release",
        releaseTag: "v2.7.1",
        releaseCommit,
        gitExecutable,
      }), "release_fallback_predecessor_missing");
    setBareTag(originRoot, "v2.7.0", releaseCommit);
    await proof("release_mode_admits_v2_7_1_after_v2_7_0_is_occupied", async () => {
      const producer = await generation.validateProducerTuple({
        agentRoot,
        mode: "release",
        releaseTag: "v2.7.1",
        releaseCommit,
        gitExecutable,
      });
      assertExact(producer.releaseTag, "v2.7.1", "occupied_v2_7_0_did_not_admit_v2_7_1");
    });
    await withTemporaryRoot("agent-transcript-ambient-git-", async (redirectRoot) => {
      await writeFile(join(redirectRoot, "README.md"), "ambient redirect repository\n");
      const redirectCommit = initializeReleaseRepository(redirectRoot);
      await proof("release_mode_ignores_ambient_git_redirection", async () => {
        const producer = await withAmbientGitRedirect(redirectRoot, () =>
          generation.validateProducerTuple({
            agentRoot,
            mode: "release",
            releaseTag: "v2.7.1",
            releaseCommit,
            gitExecutable,
          }));
        assertExact(producer.commit, releaseCommit, "ambient_git_redirect_changed_release_commit");
        assertExact(producer.releaseTag, "v2.7.1", "ambient_git_redirect_changed_release_tag");
      });
      await withAmbientGitRedirect(redirectRoot, () => gate(
        "release_mode_rejects_ambient_redirect_commit",
        () => generation.validateProducerTuple({
          agentRoot,
          mode: "release",
          releaseTag: "v2.7.1",
          releaseCommit: redirectCommit,
          gitExecutable,
        }),
        "release_commit_head",
      ));
    });
  });

  await withReleaseRepository("2.7.0", async ({ agentRoot, releaseCommit }) => {
    runGit(agentRoot, ["config", "remote.origin.url", "file:///tmp/not-tkersey-agent.git"]);
    await gate("release_mode_rejects_noncanonical_origin", () =>
      generation.validateProducerTuple({
        agentRoot,
        mode: "release",
        releaseTag: "v2.7.0",
        releaseCommit,
        gitExecutable,
      }), "release_origin_url");
  });
}

async function generationReceiptGates({
  gate,
  proof,
  receiptBytes,
  manifestBytes,
  payloadBytes,
  imageBytes,
  initialArgsBytes,
  kernelBytes,
}) {
  const inputs = Object.freeze({
    manifestBytes,
    payloadBytes,
    imageBytes,
    initialArgsBytes,
    kernelBytes,
  });
  await proof("generation_receipt_baseline_valid", () => validateGenerationReceipt({
    receiptBytes,
    ...inputs,
  }));
  const receipt = JSON.parse(Buffer.from(receiptBytes).toString("utf8"));

  await gate("generation_receipt_unexpected_field", () => validateGenerationReceipt({
    receiptBytes: encodedReceipt({ ...receipt, timestamp: "forbidden" }),
    ...inputs,
  }), "generation_receipt_field_unexpected");
  await gate("generation_receipt_missing_field", () => {
    const mutant = { ...receipt };
    delete mutant.typedIoDigest;
    return validateGenerationReceipt({ receiptBytes: encodedReceipt(mutant), ...inputs });
  }, "generation_receipt_field_missing");

  const tampering = Object.freeze({
    producerCommit: differentCommit(receipt.producerCommit),
    producerReleaseTag: receipt.producerReleaseTag === "v2.7.0" ? "v2.7.1" : "v2.7.0",
    kernelSha256: differentDigest(receipt.kernelSha256),
    programTransitionDigest: differentDigest(receipt.programTransitionDigest),
    reductionCount: receipt.reductionCount + 1,
    typedIoDigest: differentDigest(receipt.typedIoDigest),
    finalGitTree: differentCommit(receipt.finalGitTree),
    manifestSha256: differentDigest(receipt.manifestSha256),
    payloadSha256: differentDigest(receipt.payloadSha256),
    deterministicRebuild: false,
  });
  for (const [key, value] of Object.entries(tampering)) {
    await gate(`generation_receipt_tampered_${key}`, () => validateGenerationReceipt({
      receiptBytes: encodedReceipt({ ...receipt, [key]: value }),
      ...inputs,
    }), `generation_receipt_${key}_mismatch`);
  }
}

async function manifestAndPayloadGates({ gate, manifest, manifestBytes, payloadBytes }) {
  for (const [name, mutate] of [
    ["fewer_manifest_reductions", (value) => { value.transcript.reductionCount = 95; }],
    ["more_manifest_reductions", (value) => { value.transcript.reductionCount = 97; }],
    ["fewer_manifest_requested_outcomes", (value) => {
      value.transcript.expectedOutcomes.find((entry) => entry.kind === "Requested").kind = "Progressed";
    }],
    ["more_manifest_requested_outcomes", (value) => {
      value.transcript.expectedOutcomes.find((entry, index) =>
        index !== TRANSCRIPT_ANCHORS.terminalReductionIndex && entry.kind === "Progressed").kind = "Requested";
    }],
    ["completion_before_manifest_terminal", (value) => {
      value.transcript.expectedOutcomes[94].kind = "Completed";
      value.transcript.expectedOutcomes[95].kind = "Progressed";
    }],
    ["completion_after_manifest_terminal", (value) => {
      value.transcript.terminal.reductionIndex = 96;
    }],
    ["manifest_authored_failure", (value) => {
      firstProgressed(value).kind = "AuthoredFailure";
    }],
    ["manifest_needs_capacity", (value) => {
      firstProgressed(value).kind = "NeedsCapacity";
    }],
    ["wrong_transfer_boundary", (value) => {
      value.transcript.transferAfterBoundary = 7;
    }],
    ["terminal_manifest_digest_drift", (value) => {
      const wrong = differentDigest(value.transcript.terminal.resultSha256);
      value.transcript.terminal.resultSha256 = wrong;
      value.receipt.terminalResultSha256 = wrong;
    }],
  ]) {
    await gate(name, () => validateTranscriptManifest(mutatedManifest(manifest, mutate)), FORMAT_ERRORS);
  }

  for (const [name, mutate] of [
    ["missing_outcome_artifact", (value) => {
      value.transcript.expectedOutcomes[0].artifact = "outcome-999";
    }],
    ["missing_request_artifact", (value) => {
      value.transcript.requests[0].artifact = "request-999";
    }],
    ["missing_effect_result_artifact", (value) => {
      value.transcript.effectResults[0].artifact = "effect-result-999";
    }],
    ["duplicate_artifact_id", (value) => {
      value.artifacts[2].id = value.artifacts[1].id;
    }],
    ["noncanonical_artifact_id", (value) => {
      value.artifacts[2].id = "outcome-0";
    }],
    ["artifact_gap", (value) => {
      value.artifacts[2].offset += 1;
    }],
    ["artifact_overlap", (value) => {
      value.artifacts[2].offset -= 1;
    }],
    ["artifact_outside_payload", (value) => {
      value.artifacts.at(-1).byteLength = value.payload.byteLength;
    }],
    ["unreferenced_artifact", (value) => {
      value.transcript.expectedOutcomes[0].artifact = value.transcript.expectedOutcomes[1].artifact;
    }],
    ["artifact_order_drift", (value) => {
      [value.artifacts[2], value.artifacts[3]] = [value.artifacts[3], value.artifacts[2]];
    }],
  ]) {
    await gate(name, () => validateTranscriptManifest(mutatedManifest(manifest, mutate)), FORMAT_ERRORS);
  }

  await gate("payload_digest_mismatch", () => validateTranscriptPayload(
    manifest,
    flipByte(payloadBytes, payloadBytes.length - 1),
  ), PAYLOAD_ERROR);
  await gate("artifact_digest_mismatch", () => {
    const mutant = mutatedManifest(manifest, (value) => {
      value.artifacts[2].sha256 = differentDigest(value.artifacts[2].sha256);
    });
    validateTranscriptPayload(mutant, payloadBytes);
  }, PAYLOAD_ERROR);

  for (const subject of schemaSubjects()) {
    await gate(`unexpected_field_${subject.name}`, () => {
      const mutant = cloneManifest(manifest);
      subject.select(mutant).unexpectedField = true;
      validateTranscriptManifest(mutant);
    }, FORMAT_ERRORS);
    await gate(`missing_field_${subject.name}`, () => {
      const mutant = cloneManifest(manifest);
      delete subject.select(mutant)[subject.requiredKey];
      validateTranscriptManifest(mutant);
    }, FORMAT_ERRORS);
  }

  await gate("noncanonical_manifest_json", () => validateTranscriptManifest(
    Buffer.from(JSON.stringify(manifest), "utf8"),
  ), FORMAT_ERRORS);
  await gate("wrong_payload_asset_name", () => validateTranscriptManifest(mutatedManifest(manifest, (value) => {
    value.payload.assetName = "repository-repair-transcript.bin";
  })), FORMAT_ERRORS);
  await gate("wrong_producer_repository", () => validateTranscriptManifest(mutatedManifest(manifest, (value) => {
    value.producer.repository = "tkersey/world";
  })), FORMAT_ERRORS);
  await gate("wrong_release_url", () => validateTranscriptManifest(mutatedManifest(manifest, (value) => {
    value.producer.releaseUrl = "https://github.com/tkersey/world/releases/tag/v2.7.0";
  })), FORMAT_ERRORS);
  await gate("invalid_release_tag", () => validateTranscriptManifest(mutatedManifest(manifest, (value) => {
    value.producer.releaseTag = "v2.7.0/invalid";
  })), FORMAT_ERRORS);
  await gate("abbreviated_producer_commit", () => validateTranscriptManifest(mutatedManifest(manifest, (value) => {
    value.producer.commit = "abc1234";
  })), FORMAT_ERRORS);

  const wrongBoundaryValues = Object.freeze({
    version: "1.7.1",
    commit: "0".repeat(40),
    processKernelAbiVersion: 2,
    kernelSha256: "0".repeat(64),
    kernelByteLength: manifest.boundary.kernelByteLength + 1,
  });
  for (const [key, value] of Object.entries(wrongBoundaryValues)) {
    await gate(`wrong_boundary_${key}`, () => validateTranscriptManifest(mutatedManifest(manifest, (mutant) => {
      mutant.boundary[key] = value;
    })), FORMAT_ERRORS);
  }
  for (const [key, value] of [
    ["reductionCount", 95],
    ["residualBoundaryCount", 16],
    ["freshWasmInstanceCount", 96],
  ]) {
    await gate(`wrong_receipt_${key}`, () => validateTranscriptManifest(mutatedManifest(manifest, (mutant) => {
      mutant.receipt[key] = value;
    })), FORMAT_ERRORS);
  }

  // Confirm the baseline passed the byte-level canonical parser, not only the
  // object projection used by the table-driven mutations above.
  validateTranscriptManifest(manifestBytes);
}

async function wireCodecGates({ gate, manifest, artifacts }) {
  const firstOutcome = Buffer.from(artifacts.get("outcome-000"));
  const firstRequestEntry = manifest.transcript.requests[0];
  const firstRequest = Buffer.from(artifacts.get(firstRequestEntry.artifact));
  const firstResult = Buffer.from(artifacts.get(manifest.transcript.effectResults[0].artifact));
  const requestView = decodeRequest(firstRequest);
  decodeResult(firstResult, { expectedRequest: requestView });

  for (const [name, mutate, expected] of [
    ["wrong_magic", (bytes) => { bytes[0] ^= 1; }, "process_outcome_invalid"],
    ["wrong_version", (bytes) => { bytes.writeUInt16LE(2, 8); }, "process_outcome_unsupported_version"],
    ["invalid_kind", (bytes) => { bytes[10] = 6; }, "process_outcome_kind_invalid"],
    ["unknown_flags", (bytes) => { bytes[11] = 1; }, "process_outcome_unknown_flags"],
    ["declared_length", (bytes) => {
      bytes.writeBigUInt64LE(bytes.readBigUInt64LE(12) + 1n, 12);
    }, "process_outcome_length"],
    ["kind_shape", (bytes) => { bytes[10] = 5; }, "process_outcome_capacity_invalid"],
  ]) {
    await gate(`malformed_pko1_${name}`, () => decodeOutcome(mutatedBytes(firstOutcome, mutate)), expected);
  }
  await gate("malformed_pko1_truncated", () => decodeOutcome(firstOutcome.subarray(0, 20)), "process_outcome_invalid");
  await gate("malformed_pko1_trailing", () => decodeOutcome(Buffer.concat([firstOutcome, Buffer.from([0])])), "process_outcome_length");

  for (const [name, mutate, expected] of [
    ["wrong_magic", (bytes) => { bytes[0] ^= 1; }, "process_request_invalid"],
    ["wrong_version", (bytes) => { bytes.writeUInt16LE(2, 8); }, "process_request_unsupported_version"],
    ["unknown_flags", (bytes) => { bytes.writeUInt16LE(1, 10); }, "process_request_unknown_flags"],
    ["noncanonical_natural", (bytes) => {
      bytes[236] = 0x80;
      bytes[237] = 0x00;
    }, "natural_noncanonical"],
    ["invalid_utf8_identity", (bytes) => {
      const identityLength = readNatural(bytes, 236);
      bytes[236 + identityLength.length] = 0xff;
    }, "process_utf8_invalid"],
    ["site_digest", (bytes) => { bytes[108] ^= 1; }, "process_request_site_digest_mismatch"],
    ["request_identity_digest", (bytes) => { bytes[12] ^= 1; }, "process_request_identity_digest_mismatch"],
  ]) {
    await gate(`malformed_erq1_${name}`, () => decodeRequest(mutatedBytes(firstRequest, mutate)), expected);
  }
  await gate("malformed_erq1_truncated", () => decodeRequest(firstRequest.subarray(0, 100)), "process_request_invalid");
  await gate("malformed_erq1_trailing", () => decodeRequest(Buffer.concat([firstRequest, Buffer.from([0])])), "process_request_length");
  await gate("malformed_erq1_program_digest", () => decodeRequest(firstRequest, {
    expectedProgramTransitionDigest: "0".repeat(64),
  }), "process_request_program_digest_mismatch");

  const smallResult = encodeResult(requestView, Buffer.from([0]));
  for (const [name, source, mutate, expected] of [
    ["wrong_magic", firstResult, (bytes) => { bytes[0] ^= 1; }, "process_result_invalid"],
    ["wrong_version", firstResult, (bytes) => { bytes.writeUInt16LE(2, 8); }, "process_result_unsupported_version"],
    ["unknown_flags", firstResult, (bytes) => { bytes.writeUInt16LE(1, 10); }, "process_result_unknown_flags"],
    ["noncanonical_natural", smallResult, (bytes) => {
      bytes[76] = 0x81;
      bytes[77] = 0x00;
    }, "natural_noncanonical"],
    ["request_binding", firstResult, (bytes) => { bytes[12] ^= 1; }, "process_result_request_mismatch"],
    ["resume_schema", firstResult, (bytes) => { bytes[44] ^= 1; }, "process_result_schema_mismatch"],
  ]) {
    await gate(`malformed_ers1_${name}`, () => decodeResult(mutatedBytes(source, mutate), {
      expectedRequest: requestView,
    }), expected);
  }
  await gate("malformed_ers1_truncated", () => decodeResult(firstResult.subarray(0, 50)), "process_result_invalid");
  await gate("malformed_ers1_trailing", () => decodeResult(Buffer.concat([firstResult, Buffer.from([0])])), "process_result_length");
}

async function determinismAndPublicationGates({
  gate,
  generation,
  manifest,
  manifestBytes,
  payloadBytes,
  kernelBytes,
}) {
  const assertDeterministic = generation.assertDeterministicAssets ?? generation.validateDeterministicRebuild;
  if (typeof assertDeterministic !== "function") {
    throw new Error("negative_tests_determinism_export_missing");
  }
  await gate("nondeterministic_manifest_rebuild", () => assertDeterministic(
    { manifestBytes, payloadBytes },
    { manifestBytes: flipByte(manifestBytes, manifestBytes.length - 1), payloadBytes },
  ), ["deterministic_rebuild", "deterministic_rebuild_mismatch"]);
  await gate("nondeterministic_payload_rebuild", () => assertDeterministic(
    { manifestBytes, payloadBytes },
    { manifestBytes, payloadBytes: flipByte(payloadBytes, payloadBytes.length - 1) },
  ), ["deterministic_rebuild", "deterministic_rebuild_mismatch"]);

  const canonicalManifestBytes = encodeCanonicalManifest(manifest);
  const correctAssets = [
    {
      name: TRANSCRIPT_MANIFEST_ASSET_NAME,
      size: canonicalManifestBytes.length,
      digest: `sha256:${sha256Hex(canonicalManifestBytes)}`,
    },
    {
      name: TRANSCRIPT_PAYLOAD_ASSET_NAME,
      size: payloadBytes.length,
      digest: `sha256:${sha256Hex(payloadBytes)}`,
    },
  ];
  validateReleaseMetadata(manifest, {
    releaseTag: manifest.producer.releaseTag,
    releaseUrl: manifest.producer.releaseUrl,
    tagCommit: manifest.producer.commit,
    assets: correctAssets,
  });
  await gate("public_release_tag_commit_mismatch", () => validateReleaseMetadata(manifest, {
    releaseTag: manifest.producer.releaseTag,
    releaseUrl: manifest.producer.releaseUrl,
    tagCommit: differentCommit(manifest.producer.commit),
    assets: correctAssets,
  }), RELEASE_ERROR);
  await gate("public_release_asset_digest_mismatch", () => validateReleaseMetadata(manifest, {
    releaseTag: manifest.producer.releaseTag,
    releaseUrl: manifest.producer.releaseUrl,
    tagCommit: manifest.producer.commit,
    assets: correctAssets.map((asset, index) => index === 1
      ? { ...asset, digest: `sha256:${differentDigest(manifest.payload.sha256)}` }
      : asset),
  }), RELEASE_ERROR);
  await gate("public_release_asset_size_mismatch", () => validateReleaseMetadata(manifest, {
    releaseTag: manifest.producer.releaseTag,
    releaseUrl: manifest.producer.releaseUrl,
    tagCommit: manifest.producer.commit,
    assets: correctAssets.map((asset, index) => index === 1
      ? { ...asset, size: asset.size + 1 }
      : asset),
  }), RELEASE_ERROR);

  const replayMutant = mutateArtifactPayload(manifest, payloadBytes, "outcome-000", (bytes) => {
    bytes[bytes.length - 1] ^= 1;
  });
  await gate("replay_rejects_changed_outcome_bytes", () => replayTranscript({
    kernelBytes,
    manifestBytes: replayMutant.manifestBytes,
    payloadBytes: replayMutant.payloadBytes,
  }), ["replay_outcome_mismatch", "process_state_"]);
}

function generationRunFixture(generation, manifest, artifacts) {
  if (typeof generation.runAnchorsFromTranscript === "function") {
    return generation.runAnchorsFromTranscript(manifest, artifacts);
  }
  const effectIdentities = manifest.transcript.requests.map((entry) =>
    decodeRequest(artifacts.get(entry.artifact)).identity);
  return {
    reductionCount: TRANSCRIPT_ANCHORS.reductionCount,
    residualBoundaryCount: TRANSCRIPT_ANCHORS.residualBoundaryCount,
    requestedCount: TRANSCRIPT_ANCHORS.residualBoundaryCount,
    requestedOutcomeCount: TRANSCRIPT_ANCHORS.residualBoundaryCount,
    freshWasmInstanceCount: TRANSCRIPT_ANCHORS.freshWasmInstanceCount,
    transferAfterBoundary: TRANSCRIPT_ANCHORS.transferAfterBoundary,
    transferRecovered: true,
    requestReconstruction: true,
    terminalReductionIndex: TRANSCRIPT_ANCHORS.terminalReductionIndex,
    terminalKind: "Completed",
    terminalResultSha256: TRANSCRIPT_ANCHORS.terminalResultSha256,
    typedIoDigest: generation.TYPED_IO_DIGEST ??
      "bc3a65ec23bd18f166436a508da26d1e474d66a571ad7f8bb47d4cbac920e1b3",
    finalGitTree: generation.FINAL_GIT_TREE ?? "0d9ac8802aac6597cb0a443245efb6f92a0249fe",
    effectIdentities,
    requestReductionIndices: manifest.transcript.requests.map((entry) => entry.reductionIndex),
    outcomeKinds: manifest.transcript.expectedOutcomes.map((entry) => entry.kind),
    deterministicRebuild: true,
  };
}

function replaceFirstProgressedKind(outcomeKinds, replacement) {
  const copy = [...outcomeKinds];
  const index = copy.findIndex((kind, reductionIndex) =>
    reductionIndex !== TRANSCRIPT_ANCHORS.terminalReductionIndex && kind === "Progressed");
  if (index < 0) throw new Error("negative_fixture_progressed_outcome_missing");
  copy[index] = replacement;
  return copy;
}

function mutateArtifactPayload(manifest, payloadBytes, artifactId, mutate) {
  const nextManifest = cloneManifest(manifest);
  const nextPayload = Buffer.from(payloadBytes);
  const record = nextManifest.artifacts.find((entry) => entry.id === artifactId);
  if (!record) throw new Error(`negative_fixture_artifact_missing:${artifactId}`);
  const bytes = Buffer.from(nextPayload.subarray(record.offset, record.offset + record.byteLength));
  mutate(bytes);
  if (bytes.length !== record.byteLength) throw new Error("negative_fixture_artifact_length_changed");
  bytes.copy(nextPayload, record.offset);
  record.sha256 = sha256Hex(bytes);
  nextManifest.payload.sha256 = sha256Hex(nextPayload);
  return Object.freeze({
    manifest: nextManifest,
    manifestBytes: encodeCanonicalManifest(nextManifest),
    payloadBytes: nextPayload,
  });
}

function schemaSubjects() {
  return [
    { name: "top_level", select: (value) => value, requiredKey: "format" },
    { name: "producer", select: (value) => value.producer, requiredKey: "repository" },
    { name: "boundary", select: (value) => value.boundary, requiredKey: "version" },
    { name: "payload", select: (value) => value.payload, requiredKey: "assetName" },
    { name: "artifact", select: (value) => value.artifacts[0], requiredKey: "id" },
    { name: "transcript", select: (value) => value.transcript, requiredKey: "programImage" },
    {
      name: "expected_outcome",
      select: (value) => value.transcript.expectedOutcomes[0],
      requiredKey: "reductionIndex",
    },
    { name: "request", select: (value) => value.transcript.requests[0], requiredKey: "boundaryIndex" },
    {
      name: "effect_result",
      select: (value) => value.transcript.effectResults[0],
      requiredKey: "boundaryIndex",
    },
    { name: "terminal", select: (value) => value.transcript.terminal, requiredKey: "reductionIndex" },
    { name: "receipt", select: (value) => value.receipt, requiredKey: "format" },
  ];
}

function firstProgressed(manifest) {
  const entry = manifest.transcript.expectedOutcomes.find((candidate, index) =>
    index !== TRANSCRIPT_ANCHORS.terminalReductionIndex && candidate.kind === "Progressed");
  if (!entry) throw new Error("negative_fixture_progressed_outcome_missing");
  return entry;
}

function mutatedManifest(manifest, mutate) {
  const copy = cloneManifest(manifest);
  mutate(copy);
  return copy;
}

function cloneManifest(manifest) {
  return JSON.parse(JSON.stringify(manifest));
}

function encodedReceipt(receipt) {
  return Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

function mutatedBytes(source, mutate) {
  const copy = Buffer.from(source);
  mutate(copy);
  return copy;
}

function flipByte(source, index) {
  const copy = Buffer.from(source);
  if (!Number.isInteger(index) || index < 0 || index >= copy.length) {
    throw new Error("negative_fixture_flip_index_invalid");
  }
  copy[index] ^= 1;
  return copy;
}

function differentDigest(value) {
  if (value instanceof Uint8Array) {
    return differentDigest(Buffer.from(value).toString("hex"));
  }
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("negative_fixture_digest_invalid");
  }
  return `${value[0] === "0" ? "1" : "0"}${value.slice(1)}`;
}

function differentCommit(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error("negative_fixture_commit_invalid");
  }
  return `${value[0] === "0" ? "1" : "0"}${value.slice(1)}`;
}

function assertBytesEqual(actual, expected, code) {
  if (!(actual instanceof Uint8Array) || !(expected instanceof Uint8Array) ||
      !Buffer.from(actual).equals(Buffer.from(expected))) {
    throw new Error(code);
  }
}

function assertExact(actual, expected, code) {
  if (actual !== expected) throw new Error(`${code}:${actual}`);
}

async function withTemporaryRoot(prefix, operation) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await operation(await realpath(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writePackageSurfaces(root, version, { decoys = false } = {}) {
  await mkdir(join(root, "src"), { recursive: true });
  const zonDecoys = decoys
    ? "    // .version = \"9.9.9\",\n    unanchored .version = \"8.8.8\",\n"
    : "";
  const zigDecoys = decoys
    ? "// pub const package_version = \"9.9.9\";\nunanchored pub const package_version = \"8.8.8\";\n"
    : "";
  await Promise.all([
    writeFile(
      join(root, "build.zig.zon"),
      `.{\n${zonDecoys}    .version = "${version}",\n}\n`,
    ),
    writeFile(
      join(root, "src/root.zig"),
      `${zigDecoys}pub const package_version = "${version}";\n`,
    ),
    writeFile(
      join(root, "src/manifest.zig"),
      `${zigDecoys}pub const package_version = "${version}";\n`,
    ),
  ]);
}

async function writeDecoyOnlyPackageSurfaces(root) {
  await mkdir(join(root, "src"), { recursive: true });
  await Promise.all([
    writeFile(
      join(root, "build.zig.zon"),
      ".{\n    // .version = \"2.7.1\",\n    unanchored .version = \"2.7.1\",\n}\n",
    ),
    writeFile(
      join(root, "src/root.zig"),
      "// pub const package_version = \"2.7.1\";\nunanchored pub const package_version = \"2.7.1\";\n",
    ),
    writeFile(
      join(root, "src/manifest.zig"),
      "// pub const package_version = \"2.7.1\";\nunanchored pub const package_version = \"2.7.1\";\n",
    ),
  ]);
}

async function withReleaseRepository(version, operation) {
  return withTemporaryRoot("agent-transcript-release-git-", async (agentRoot) =>
    withTemporaryRoot("agent-transcript-release-origin-", async (originRoot) => {
      await writePackageSurfaces(agentRoot, version, { decoys: true });
      initializeBareRepository(originRoot);
      const releaseCommit = initializeReleaseRepository(agentRoot, originRoot);
      return operation({ agentRoot, originRoot, releaseCommit });
    }));
}

function initializeBareRepository(root) {
  runGit(root, ["init", "--bare", "-q"]);
}

function initializeReleaseRepository(root, originRoot = undefined) {
  runGit(root, ["init", "-q"]);
  runGit(root, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  runGit(root, ["config", "user.name", "Transcript Negative Tests"]);
  runGit(root, ["config", "user.email", "transcript-negative-tests@example.invalid"]);
  runGit(root, ["config", "commit.gpgSign", "false"]);
  runGit(root, ["add", "-A"]);
  runGit(root, ["commit", "-qm", "fixture"]);
  const head = runGit(root, ["rev-parse", "HEAD"]);
  if (originRoot === undefined) {
    runGit(root, ["update-ref", "refs/remotes/origin/main", head]);
    return head;
  }
  runGit(root, ["remote", "add", "origin", CANONICAL_AGENT_HTTPS_ORIGIN]);
  runGit(root, ["config", `url.${originRoot}.insteadOf`, CANONICAL_AGENT_HTTPS_ORIGIN]);
  runGit(root, ["push", "-q", "origin", "refs/heads/main:refs/heads/main"]);
  runGit(root, ["fetch", "-q", "origin", "+refs/heads/main:refs/remotes/origin/main"]);
  return head;
}

function setBareTag(originRoot, tag, commit) {
  runGit(originRoot, ["update-ref", `refs/tags/${tag}`, commit]);
}

function runGit(root, args) {
  const environment = { ...process.env };
  delete environment.GIT_DIR;
  delete environment.GIT_WORK_TREE;
  const result = spawnSync("git", args, {
    cwd: root,
    env: environment,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`negative_fixture_git_failed:${args.join(" ")}:${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

async function withAmbientGitRedirect(root, operation) {
  const previousGitDir = process.env.GIT_DIR;
  const previousGitWorkTree = process.env.GIT_WORK_TREE;
  process.env.GIT_DIR = join(root, ".git");
  process.env.GIT_WORK_TREE = root;
  try {
    return await operation();
  } finally {
    restoreEnvironment("GIT_DIR", previousGitDir);
    restoreEnvironment("GIT_WORK_TREE", previousGitWorkTree);
  }
}

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function expectRejected(label, operation, expected) {
  let rejected = false;
  try {
    await operation();
  } catch (error) {
    rejected = true;
    const admitted = Array.isArray(expected) ? expected : [expected];
    const code = error?.code;
    const message = error?.message ?? String(error);
    if (!admitted.some((entry) => code === entry || message === entry || message.startsWith(`${entry}:`))) {
      throw new Error(
        `negative_gate_wrong_rejection:${label}:expected=${admitted.join("|")}:observed=${code ?? message}`,
        { cause: error },
      );
    }
  }
  if (!rejected) throw new Error(`negative_gate_failed_to_reject:${label}`);
}

async function loadBytes(options, key, cliKey = key) {
  const direct = options[`${key}Bytes`] ?? options[key];
  if (direct instanceof Uint8Array) return Buffer.from(direct);
  if (typeof direct === "string") return Buffer.from(await readFile(direct));
  throw new Error(`negative_tests_input_missing:${cliKey}`);
}

function parseArgs(argv) {
  const aliases = Object.freeze({
    "--kernel": "kernel",
    "--manifest": "manifest",
    "--payload": "payload",
    "--image": "image",
    "--initial-args": "initialArgs",
    "--generation-receipt": "generationReceipt",
    "--git-executable": "gitExecutable",
  });
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    const key = aliases[name];
    if (key === undefined || value === undefined || Object.hasOwn(options, key)) {
      throw new Error(`negative_tests_argument_invalid:${name ?? "missing"}`);
    }
    options[key] = value;
  }
  for (const key of [
    "kernel",
    "manifest",
    "payload",
    "image",
    "initialArgs",
    "generationReceipt",
    "gitExecutable",
  ]) {
    if (options[key] === undefined) throw new Error(`negative_tests_argument_missing:${key}`);
  }
  return options;
}

function wasmWithSingleImport() {
  const typeSection = wasmSection(1, [1, 0x60, 0, 0]);
  const importSection = wasmSection(2, [
    1,
    ...wasmString("env"),
    ...wasmString("effect"),
    0,
    0,
  ]);
  return Buffer.from([...wasmHeader(), ...typeSection, ...importSection]);
}

function wasmWithAbiVersion(version) {
  if (!Number.isInteger(version) || version < 0 || version > 0x3f) {
    throw new Error("negative_fixture_abi_version_invalid");
  }
  const name = "boundary_process_kernel_abi_version";
  const typeSection = wasmSection(1, [1, 0x60, 0, 1, 0x7f]);
  const functionSection = wasmSection(3, [1, 0]);
  const exportSection = wasmSection(7, [1, ...wasmString(name), 0, 0]);
  const body = [0, 0x41, version, 0x0b];
  const codeSection = wasmSection(10, [1, ...uleb(body.length), ...body]);
  return Buffer.from([
    ...wasmHeader(),
    ...typeSection,
    ...functionSection,
    ...exportSection,
    ...codeSection,
  ]);
}

function wasmHeader() {
  return [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
}

function wasmSection(id, content) {
  return [id, ...uleb(content.length), ...content];
}

function wasmString(value) {
  const bytes = Buffer.from(value, "utf8");
  return [...uleb(bytes.length), ...bytes];
}

function uleb(input) {
  let value = BigInt(input);
  if (value < 0n) throw new Error("negative_fixture_uleb_invalid");
  const bytes = [];
  do {
    let byte = Number(value & 0x7fn);
    value >>= 7n;
    if (value !== 0n) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0n);
  return bytes;
}

export async function main(argv = process.argv.slice(2)) {
  const result = await runNegativeTests(parseArgs(argv));
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
