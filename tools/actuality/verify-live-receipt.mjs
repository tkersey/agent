#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const MAXIMUM_RECEIPT_BYTES = 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;
const REQUIRED_OPTIONS = Object.freeze([
  "receipt",
  "receipt-sha256",
  "agent-archive",
  "agent-archive-sha256",
  "agent-version",
  "boundary-archive",
  "boundary-archive-sha256",
  "boundary-version",
  "world-archive",
  "world-archive-sha256",
  "world-version",
  "world-host-archive",
  "world-host-archive-sha256",
  "world-host-version",
  "capabilities-archive",
  "capabilities-archive-sha256",
  "capabilities-version",
  "application-wasm",
  "application-wasm-sha256",
  "application-manifest",
  "initial-args",
  "decision-contract-digest-file"
]);
const EXPECTED_INTERFACES = Object.freeze([
  "model.decide.v1",
  "repo.list.v1",
  "model.decide.v1",
  "repo.read.v1",
  "model.decide.v1",
  "repo.read.v1",
  "model.decide.v1",
  "repo.test.v1",
  "model.decide.v1",
  "repo.replace.approved.v1",
  "model.decide.v1",
  "repo.test.v1",
  "model.decide.v1"
]);
const FORBIDDEN_PUBLIC_KEYS = new Set([
  "apiKey",
  "rawPrompt",
  "rawPrompts",
  "rawRepositoryBytes",
  "rawModelOutput",
  "rawModelOutputs",
  "repositoryContents",
  "replacementContents",
  "effectResultPayloads",
  "hostStore"
]);

export async function verifyReleasedLiveReceipt(options) {
  for (const name of REQUIRED_OPTIONS) requiredOption(options, name);
  for (const name of [
    "receipt-sha256",
    "agent-archive-sha256",
    "boundary-archive-sha256",
    "world-archive-sha256",
    "world-host-archive-sha256",
    "capabilities-archive-sha256",
    "application-wasm-sha256"
  ]) requireSha(options[name], `option_${name}`);

  const receiptBytes = await readFile(options.receipt);
  if (receiptBytes.length === 0 || receiptBytes.length > MAXIMUM_RECEIPT_BYTES) {
    throw new Error("receipt_size_invalid");
  }
  const observedReceiptSha = digestBytes(receiptBytes);
  requireEqual(observedReceiptSha, options["receipt-sha256"], "receipt_digest_mismatch");

  let receipt;
  try {
    receipt = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(receiptBytes));
  } catch {
    throw new Error("receipt_json_invalid");
  }

  const evidence = {
    agentArchiveSha256: await digestFile(options["agent-archive"]),
    boundaryArchiveSha256: await digestFile(options["boundary-archive"]),
    worldArchiveSha256: await digestFile(options["world-archive"]),
    worldHostArchiveSha256: await digestFile(options["world-host-archive"]),
    capabilitiesArchiveSha256: await digestFile(options["capabilities-archive"]),
    applicationWasmSha256: await digestFile(options["application-wasm"]),
    applicationManifestSha256: await digestFile(options["application-manifest"]),
    initialArgsSha256: await digestFile(options["initial-args"]),
    decisionContractDigest: await readCanonicalDigest(options["decision-contract-digest-file"]),
    expectedAgentArchiveSha256: options["agent-archive-sha256"],
    expectedBoundaryArchiveSha256: options["boundary-archive-sha256"],
    expectedWorldArchiveSha256: options["world-archive-sha256"],
    expectedWorldHostArchiveSha256: options["world-host-archive-sha256"],
    expectedCapabilitiesArchiveSha256: options["capabilities-archive-sha256"],
    expectedApplicationWasmSha256: options["application-wasm-sha256"],
    expectedAgentVersion: options["agent-version"],
    expectedBoundaryVersion: options["boundary-version"],
    expectedWorldVersion: options["world-version"],
    expectedWorldHostVersion: options["world-host-version"],
    expectedCapabilitiesVersion: options["capabilities-version"]
  };
  validateLiveReceipt(receipt, evidence);
  return Object.freeze({
    receiptSha256: observedReceiptSha,
    agentVersion: evidence.expectedAgentVersion,
    boundaryVersion: evidence.expectedBoundaryVersion,
    worldVersion: evidence.expectedWorldVersion,
    worldHostVersion: evidence.expectedWorldHostVersion,
    capabilitiesVersion: evidence.expectedCapabilitiesVersion,
    applicationWasmSha256: evidence.applicationWasmSha256,
    modelCalls: receipt.provider.calls,
    liveAttempts: receipt.attempts.length
  });
}

export function validateLiveReceipt(receipt, evidence) {
  requireRecord(receipt, "receipt");
  requireOnlyKeys(receipt, [
    "format", "mode", "supersedes", "components", "application", "provider",
    "workspace", "approval", "run", "attempts", "lifecycle", "redaction"
  ], "receipt_field_unknown");
  rejectSensitiveProjection(receipt);
  requireEqual(receipt.format, "agent-actuality-receipt-v1", "receipt_format_invalid");
  requireEqual(receipt.mode, "live", "receipt_mode_invalid");
  if (receipt.supersedes !== undefined) {
    const supersedes = requireRecord(receipt.supersedes, "supersedes");
    requireOnlyKeys(supersedes, ["sha256", "reason"], "supersedes_field_unknown");
    requireSha(supersedes.sha256, "superseded_receipt_digest_invalid");
    requireText(supersedes.reason, "supersession_reason_missing");
  }

  const components = requireRecord(receipt.components, "components");
  const agent = requireRecord(components.agent, "components.agent");
  const boundary = requireRecord(components.boundary, "components.boundary");
  const world = requireRecord(components.world, "components.world");
  const worldHost = requireRecord(components.worldHost, "components.worldHost");
  const capabilities = requireRecord(components.worldCapabilities, "components.worldCapabilities");
  requireOnlyKeys(components, ["agent", "boundary", "world", "worldHost", "worldCapabilities"],
    "components_field_unknown");
  requireOnlyKeys(agent, ["version", "commit", "archiveSha256", "packageHash"],
    "agent_component_field_unknown");
  requireOnlyKeys(boundary, ["version", "archiveSha256", "packageHash", "machineAbi"],
    "boundary_component_field_unknown");
  requireOnlyKeys(world, ["version", "archiveSha256", "packageHash", "applicationAbi", "frameVersion"],
    "world_component_field_unknown");
  requireOnlyKeys(worldHost, ["version", "archiveSha256", "runtimeChanged"],
    "world_host_component_field_unknown");
  requireOnlyKeys(capabilities, ["version", "commit", "archiveSha256", "openaiPackFingerprint"],
    "capabilities_component_field_unknown");
  requireEqual(agent.version, evidence.expectedAgentVersion, "agent_version_mismatch");
  requireEqual(boundary.version, evidence.expectedBoundaryVersion, "boundary_version_mismatch");
  requireEqual(world.version, evidence.expectedWorldVersion, "world_version_mismatch");
  requireEqual(worldHost.version, evidence.expectedWorldHostVersion, "world_host_version_mismatch");
  requireEqual(capabilities.version, evidence.expectedCapabilitiesVersion, "capabilities_version_mismatch");
  requireDigestBinding(agent.archiveSha256, evidence.agentArchiveSha256,
    evidence.expectedAgentArchiveSha256, "agent_archive_digest_mismatch");
  requireDigestBinding(boundary.archiveSha256, evidence.boundaryArchiveSha256,
    evidence.expectedBoundaryArchiveSha256, "boundary_archive_digest_mismatch");
  requireDigestBinding(world.archiveSha256, evidence.worldArchiveSha256,
    evidence.expectedWorldArchiveSha256, "world_archive_digest_mismatch");
  requireDigestBinding(worldHost.archiveSha256, evidence.worldHostArchiveSha256,
    evidence.expectedWorldHostArchiveSha256, "world_host_archive_digest_mismatch");
  requireDigestBinding(capabilities.archiveSha256, evidence.capabilitiesArchiveSha256,
    evidence.expectedCapabilitiesArchiveSha256, "capabilities_archive_digest_mismatch");
  requireEqual(boundary.machineAbi, 2, "boundary_machine_abi_mismatch");
  requireEqual(world.applicationAbi, 1, "world_application_abi_mismatch");
  requireEqual(world.frameVersion, 1, "world_frame_version_mismatch");
  requireEqual(worldHost.runtimeChanged, false, "world_host_runtime_changed");

  const application = requireRecord(receipt.application, "application");
  requireOnlyKeys(application, [
    "applicationId", "wasmSha256", "wasmBytes", "wasmImportCount", "manifestSha256",
    "initialArgsSha256", "decisionContractDigest"
  ], "application_field_unknown");
  requireSha(application.applicationId, "application_id_invalid");
  requireDigestBinding(application.wasmSha256, evidence.applicationWasmSha256,
    evidence.expectedApplicationWasmSha256, "application_wasm_digest_mismatch");
  requireEqual(application.wasmImportCount, 0, "application_wasm_imports_present");
  requirePositiveInteger(application.wasmBytes, "application_wasm_size_invalid");
  requireEqual(application.manifestSha256, evidence.applicationManifestSha256,
    "application_manifest_digest_mismatch");
  requireEqual(application.initialArgsSha256, evidence.initialArgsSha256,
    "initial_args_digest_mismatch");
  requireEqual(application.decisionContractDigest, evidence.decisionContractDigest,
    "decision_contract_digest_mismatch");

  const provider = requireRecord(receipt.provider, "provider");
  requireOnlyKeys(provider, [
    "provider", "endpoint", "requestedModel", "returnedModels", "store", "toolsCount",
    "calls", "inputTokens", "outputTokens", "totalTokens", "failures", "responseIdDigests"
  ], "provider_field_unknown");
  requireEqual(provider.provider, "openai", "provider_invalid");
  requireEqual(provider.endpoint, "responses", "provider_endpoint_invalid");
  requireText(provider.requestedModel, "provider_requested_model_missing");
  if (!Array.isArray(provider.returnedModels) || provider.returnedModels.length === 0) {
    throw new Error("provider_returned_model_missing");
  }
  for (const model of provider.returnedModels) requireText(model, "provider_returned_model_invalid");
  requireEqual(provider.store, false, "provider_store_enabled");
  requireEqual(provider.toolsCount, 0, "provider_tools_present");
  requireBoundedPositiveInteger(provider.calls, 16, "provider_call_count_invalid");
  requireNonnegativeInteger(provider.inputTokens, "provider_input_tokens_invalid");
  requireNonnegativeInteger(provider.outputTokens, "provider_output_tokens_invalid");
  requireEqual(provider.totalTokens, provider.inputTokens + provider.outputTokens,
    "provider_token_total_invalid");
  requireEqual(provider.failures, 0, "provider_failures_present");
  if (!Array.isArray(provider.responseIdDigests) || provider.responseIdDigests.length !== provider.calls) {
    throw new Error("provider_response_identity_count_invalid");
  }
  for (const digest of provider.responseIdDigests) requireSha(digest, "provider_response_identity_invalid");

  const workspace = requireRecord(receipt.workspace, "workspace");
  requireOnlyKeys(workspace, [
    "fixture", "controlledFixtureOnly", "initialGitCommit", "initialGitTree", "changedPaths",
    "oldSourceSha256", "newSourceSha256", "testsChanged", "packageChanged",
    "failingTestObserved", "passingTestObserved", "hiddenVerifierPassed"
  ], "workspace_field_unknown");
  requireEqual(workspace.controlledFixtureOnly, true, "workspace_not_controlled_fixture");
  requireEqual(JSON.stringify(workspace.changedPaths), JSON.stringify(["src/range.mjs"]),
    "workspace_changed_paths_invalid");
  requireEqual(workspace.testsChanged, false, "workspace_tests_changed");
  requireEqual(workspace.packageChanged, false, "workspace_package_changed");
  requireEqual(workspace.failingTestObserved, true, "failing_test_not_observed");
  requireEqual(workspace.passingTestObserved, true, "passing_test_not_observed");
  requireEqual(workspace.hiddenVerifierPassed, true, "hidden_verifier_failed");
  requireSha(workspace.oldSourceSha256, "old_source_digest_invalid");
  requireSha(workspace.newSourceSha256, "new_source_digest_invalid");
  if (workspace.oldSourceSha256 === workspace.newSourceSha256) throw new Error("source_unchanged");

  const approval = requireRecord(receipt.approval, "approval");
  requireOnlyKeys(approval, [
    "mode", "effectRequestId", "proposalDigest", "approved", "approvalBeforeMutation", "mutationCount"
  ], "approval_field_unknown");
  requireEqual(approval.mode, "interactive", "approval_mode_invalid");
  requireSha(approval.effectRequestId, "approval_request_identity_invalid");
  requireSha(approval.proposalDigest, "approval_proposal_digest_invalid");
  requireEqual(approval.approved, true, "approval_missing");
  requireEqual(approval.approvalBeforeMutation, true, "approval_after_mutation");
  requireEqual(approval.mutationCount, 1, "mutation_count_invalid");

  const run = requireRecord(receipt.run, "run");
  requireOnlyKeys(run, ["genesisFrameId", "terminalFrameId", "typedFinalResult", "interfaces"],
    "run_field_unknown");
  requireSha(run.genesisFrameId, "genesis_frame_identity_invalid");
  requireSha(run.terminalFrameId, "terminal_frame_identity_invalid");
  if (run.genesisFrameId === run.terminalFrameId) throw new Error("terminal_frame_not_advanced");
  requireEqual(run.typedFinalResult, true, "typed_final_result_missing");
  requireEqual(JSON.stringify(run.interfaces), JSON.stringify(EXPECTED_INTERFACES),
    "effect_sequence_invalid");

  if (!Array.isArray(receipt.attempts) || receipt.attempts.length === 0 || receipt.attempts.length > 3) {
    throw new Error("live_attempt_count_invalid");
  }
  let successCount = 0;
  receipt.attempts.forEach((attempt, index) => {
    requireRecord(attempt, `attempts.${index}`);
    requireOnlyKeys(attempt, [
      "ordinal", "outcome", "failureCode", "publicReceiptEmitted", "note", "terminalFrameId",
      "providerUsageComplete", "modelCalls", "mutationCount", "typedFinalResult"
    ], "live_attempt_field_unknown");
    requireEqual(attempt.ordinal, index + 1, "live_attempt_ordinal_invalid");
    if (attempt.outcome === "succeeded") successCount += 1;
    else if (attempt.outcome !== "failed") throw new Error("live_attempt_outcome_invalid");
  });
  if (successCount < 1) throw new Error("live_success_missing");
  requireEqual(receipt.attempts.at(-1).outcome, "succeeded", "terminal_live_attempt_failed");

  const lifecycle = requireRecord(receipt.lifecycle, "lifecycle");
  requireOnlyKeys(lifecycle, [
    "freshInstanceResume", "retryChildFrameByteIdentical", "retryFreshMutationCount",
    "replayFreshEffects", "branching", "migration", "migrationReceiverPreflight"
  ], "lifecycle_field_unknown");
  for (const name of [
    "freshInstanceResume",
    "retryChildFrameByteIdentical",
    "branching",
    "migration",
    "migrationReceiverPreflight"
  ]) requireEqual(lifecycle[name], true, `lifecycle_${name}_failed`);
  requireEqual(lifecycle.retryFreshMutationCount, 0, "retry_repeated_mutation");
  requireEqual(lifecycle.replayFreshEffects, 0, "replay_fresh_effects_present");

  const redaction = requireRecord(receipt.redaction, "redaction");
  requireOnlyKeys(redaction, [
    "apiKeyRecorded", "rawPromptsPublished", "rawRepositoryBytesPublished",
    "rawModelOutputsPublished", "privateEvidenceSha256"
  ], "redaction_field_unknown");
  for (const name of [
    "apiKeyRecorded",
    "rawPromptsPublished",
    "rawRepositoryBytesPublished",
    "rawModelOutputsPublished"
  ]) requireEqual(redaction[name], false, `redaction_${name}_failed`);
  requireSha(redaction.privateEvidenceSha256, "private_evidence_digest_invalid");
  return true;
}

function rejectSensitiveProjection(value, depth = 0) {
  if (depth > 32) throw new Error("receipt_nesting_excessive");
  if (typeof value === "string") {
    if (/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/.test(value)) throw new Error("receipt_secret_present");
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PUBLIC_KEYS.has(key)) throw new Error("receipt_private_field_present");
    rejectSensitiveProjection(child, depth + 1);
  }
}

async function digestFile(path) {
  const hasher = createHash("sha256");
  for await (const chunk of createReadStream(path)) hasher.update(chunk);
  return hasher.digest("hex");
}

async function readCanonicalDigest(path) {
  const bytes = await readFile(path);
  const value = bytes.toString("utf8");
  if (!/^[0-9a-f]{64}\n?$/.test(value)) throw new Error("decision_contract_digest_file_invalid");
  return value.trimEnd();
}

function digestBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireDigestBinding(declared, observed, expected, code) {
  requireSha(declared, code);
  requireEqual(observed, expected, code);
  requireEqual(declared, expected, code);
}

function requireRecord(value, code) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${code}_invalid`);
  return value;
}

function requireOnlyKeys(value, allowed, code) {
  const admitted = new Set(allowed);
  for (const key of Object.keys(value)) if (!admitted.has(key)) throw new Error(code);
}

function requireText(value, code) {
  if (typeof value !== "string" || value.length === 0) throw new Error(code);
}

function requireSha(value, code) {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(code);
}

function requireNonnegativeInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
}

function requirePositiveInteger(value, code) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(code);
}

function requireBoundedPositiveInteger(value, maximum, code) {
  requirePositiveInteger(value, code);
  if (value > maximum) throw new Error(code);
}

function requireEqual(actual, expected, code) {
  if (actual !== expected) throw new Error(code);
}

function requiredOption(options, name) {
  if (typeof options[name] !== "string" || options[name].length === 0) {
    throw new Error(`missing_option_${name}`);
  }
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (typeof flag !== "string" || !flag.startsWith("--") || value === undefined) {
      throw new Error("invalid_arguments");
    }
    const name = flag.slice(2);
    if (!REQUIRED_OPTIONS.includes(name) || Object.hasOwn(options, name)) {
      throw new Error(`invalid_option_${name}`);
    }
    options[name] = value;
  }
  return options;
}

async function main() {
  const result = await verifyReleasedLiveReceipt(parseArguments(process.argv.slice(2)));
  for (const [name, value] of Object.entries({
    agent_actuality_format: 1,
    agent_actuality_mode: "live",
    agent_package_version: result.agentVersion,
    boundary_package_version: result.boundaryVersion,
    world_package_version: result.worldVersion,
    world_host_version: result.worldHostVersion,
    world_capabilities_version: result.capabilitiesVersion,
    application_wasm_sha256: result.applicationWasmSha256,
    application_wasm_import_count: 0,
    live_model_call_count: result.modelCalls,
    live_attempt_count: result.liveAttempts,
    live_success_count_gte_1: true,
    live_receipt_sha256: result.receiptSha256,
    live_receipt_verified: true
  })) console.log(`${name}=${value}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
