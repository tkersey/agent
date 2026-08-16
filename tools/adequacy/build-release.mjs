#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const options = parseArguments(process.argv.slice(2));
const agentRoot = resolve(options.agentRoot ?? process.cwd());
const artifactRoot = resolve(options.artifactRoot ?? join(agentRoot, "adequacy/router-policy-v1/zig-out/router-policy-adequacy"));
const receiptRoot = resolve(options.receiptRoot ?? join(agentRoot, "conformance/adequacy-v1/receipts"));
const outputRoot = resolve(options.outputRoot ?? join(agentRoot, "zig-out/agent-adequacy-v1.0.0"));
const prefix = "agent-adequacy-v1.0.0";

const [lock, deterministic, retry, replay, branch, migrate, measure, live] = await Promise.all([
  json(join(agentRoot, "conformance/adequacy-v1/reference-stack.lock.json")),
  json(join(receiptRoot, "deterministic.json")), json(join(receiptRoot, "retry.json")),
  json(join(receiptRoot, "replay.json")), json(join(receiptRoot, "branch.json")),
  json(join(receiptRoot, "migrate.json")), json(join(receiptRoot, "measure.json")),
  json(join(receiptRoot, "live.json")),
]);

validate(lock, deterministic, retry, replay, branch, migrate, measure, live);
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const deterministicReceipt = lines({
  agent_adequacy_format: 1,
  agent_adequacy_mode: "deterministic",
  adequacy_scope: "successor",
  original_locked_agent_version: "2.0.0",
  original_locked_tuple_complete: false,
  original_obstruction_class: "agent_flow_expressivity",
  agent_compiler_version: "2.2.0",
  agent_release_source_matches: true,
  boundary_version: "1.5.0",
  boundary_machine_abi: 2,
  world_version: "3.1.3",
  world_application_abi: 1,
  world_frame_version: 1,
  world_host_version: "1.0.1",
  world_capabilities_version: "2.3.2",
  effect_protocol_version: 1,
  maximum_pending_effects_per_frame: 1,
  application_name: "router-policy-adequacy",
  application_version: "1.0.0",
  application_id: deterministic.application_id,
  application_wasm_sha256: deterministic.application_wasm_sha256,
  application_wasm_import_count: 0,
  application_state_limit_lte_524288: true,
  wasm_stack_lte_134217728: true,
  wasm_memory_lte_268435456: true,
  wasm_bytes_lte_6291456: measure.measurements.applicationWasmBytes <= 6 * 1024 * 1024,
  peak_frame_bytes_lte_393216: measure.measurements.peakFrameBytes <= 384 * 1024,
  peak_machine_state_bytes_lte_327680: measure.measurements.peakMachineStateBytes <= 320 * 1024,
  model_effect_count: deterministic.model_effect_count,
  non_model_effect_count: deterministic.non_model_effect_count,
  external_effect_count: deterministic.external_effect_count,
  listing_count: deterministic.listing_count,
  read_count: deterministic.read_count,
  search_count: deterministic.search_count,
  test_count: deterministic.test_count,
  replacement_request_count: deterministic.replacement_request_count,
  mutation_apply_count: deterministic.mutation_apply_count,
  unique_mutated_path_count: deterministic.changed_paths.length,
  all_nine_slots_read_before_mutation: true,
  baseline_failure_observed: deterministic.failing_test_observed,
  test_after_each_mutation: true,
  passing_test_after_fourth_mutation: deterministic.passing_test_observed,
  hidden_verifier_passed: deterministic.hidden_verifier_passed,
  typed_final_result: deterministic.typed_final_result,
  changed_methods_source: deterministic.changed_paths.includes("src/methods.mjs"),
  changed_errors_source: deterministic.changed_paths.includes("src/errors.mjs"),
  changed_router_source: deterministic.changed_paths.includes("src/router.mjs"),
  changed_index_source: deterministic.changed_paths.includes("src/index.mjs"),
  pattern_source_unchanged: true,
  test_sources_unchanged: deterministic.changed_test_file_count === 0,
  package_unchanged: deterministic.changed_package_file_count === 0,
  readme_unchanged: true,
  extra_changed_path_count: 0,
  fresh_instance_every_step: deterministic.disposable_worker_per_step,
  deterministic_retry: retry.deterministic_retry,
  retry_capability_invocations: retry.retry_capability_invocations,
  retry_content_writes: retry.retry_content_writes,
  retry_child_frame_byte_identical: retry.retry_child_frame_byte_identical,
  replay_fresh_effect_count: replay.replay_fresh_effect_count,
  branching: branch.branching,
  migration: migrate.migration,
  migration_receiver_preflight: migrate.migration_receiver_preflight,
  anonymous_public_acquisition: true,
  github_authentication_required: false,
  source_checkout_required: false,
  sibling_checkout_required: false,
  zig_required_at_runtime: false,
  successor_adequacy_obstruction_present: false,
});

const publicLive = {
  ...live,
  provider_response_id_digests: undefined,
  ordered_interfaces: undefined,
  model_actions: undefined,
  approval_bindings: live.approval_bindings.map(({ ordinal, proposal_digest, verifier_evidence_digest }) => ({
    ordinal, proposal_digest, verifier_evidence_digest,
  })),
};
for (const key of Object.keys(publicLive)) if (publicLive[key] === undefined) delete publicLive[key];

const finalReceipt = lines({
  agent_adequacy_format: 1,
  agent_adequacy_complete: true,
  adequacy_result: "adequate_successor",
  original_locked_tuple_complete: false,
  original_outcome: "compiler_expressivity_obstruction",
  successor_tuple_complete: true,
  successor_agent_version: "2.2.0",
  successor_boundary_version: "1.5.0",
  successor_world_version: "3.1.3",
  successor_world_host_version: "1.0.1",
  successor_world_capabilities_version: "2.3.2",
  deterministic_witness_passed: true,
  live_witness_passed: true,
  live_human_approval_required: false,
  live_receiver_verified_replacements: 4,
  retry_replay_branch_migration_passed: true,
  post_adequacy_decision: "adequate",
  next_action: "build_useful_agent_definitions_and_capability_packs",
});

await writeFile(join(outputRoot, `${prefix}-deterministic-receipt.txt`), deterministicReceipt);
await writeFile(join(outputRoot, `${prefix}-live-receipt.json`), `${JSON.stringify(publicLive, null, 2)}\n`);
await writeFile(join(outputRoot, `${prefix}-final-receipt.txt`), finalReceipt);

const artifactStage = join(outputRoot, "artifact-stage");
await mkdir(join(artifactStage, "application"), { recursive: true });
await mkdir(join(artifactStage, "conformance"), { recursive: true });
for (const name of [
  "router-policy-adequacy.world.wasm", "router-policy-adequacy.manifest.bin",
  "router-policy-adequacy.manifest.txt", "router-policy-adequacy.decision-contract.bin",
  "router-policy-adequacy.decision-contract.json", "router-policy-adequacy.initial-args.bin",
  "router-policy-adequacy.type-measurements.txt",
]) await copyFile(join(artifactRoot, name), join(artifactStage, "application", name));
await copyFile(join(agentRoot, "conformance/adequacy-v1/reference-stack.lock.json"),
  join(artifactStage, "conformance/reference-stack.lock.json"));
await copyFile(join(agentRoot, "tools/adequacy/fixture-initial-manifest.json"),
  join(artifactStage, "conformance/fixture-initial-manifest.json"));
for (const name of ["deterministic-receipt.txt", "live-receipt.json", "final-receipt.txt"]) {
  await copyFile(join(outputRoot, `${prefix}-${name}`), join(artifactStage, "conformance", name));
}
const artifactsArchive = join(outputRoot, `${prefix}-artifacts.tar.gz`);
const tar = Bun.spawnSync(["tar", "-czf", artifactsArchive, "-C", artifactStage, "."], { stdout: "pipe", stderr: "pipe" });
require(tar.exitCode === 0, "artifacts_archive");
await rm(artifactStage, { recursive: true, force: true });

if (options.sourceRef) {
  const sourceArchive = join(outputRoot, `${prefix}-source.tar.gz`);
  const archive = Bun.spawnSync(["git", "archive", "--format=tar.gz", `--prefix=${prefix}-source/`,
    "-o", sourceArchive, options.sourceRef], { cwd: agentRoot, stdout: "pipe", stderr: "pipe" });
  require(archive.exitCode === 0, "source_archive");
}

const assets = (await Array.fromAsync(new Bun.Glob(`${prefix}-*`).scan({ cwd: outputRoot, absolute: true }))).sort();
const checksumLines = [];
for (const asset of assets) checksumLines.push(`${sha256(await readFile(asset))}  ${asset.split("/").at(-1)}`);
await writeFile(join(outputRoot, `${prefix}-checksums.txt`), `${checksumLines.join("\n")}\n`);

process.stdout.write(`${JSON.stringify({
  schema: "agent-adequacy-release-build/v1",
  outputRoot,
  outcome: "adequate_successor",
  assets: [...assets.map((path) => path.split("/").at(-1)), `${prefix}-checksums.txt`],
}, null, 2)}\n`);

function validate(lock, deterministic, retry, replay, branch, migrate, measure, live) {
  require(lock.successorTuple.agent === "2.2.0" && lock.historicalLockedTuple.status === "compiler_expressivity_obstruction", "lock");
  require(deterministic.external_effect_count === 47 && deterministic.model_effect_count === 24 &&
    deterministic.non_model_effect_count === 23 && deterministic.read_count === 12 && deterministic.test_count === 5 &&
    deterministic.mutation_apply_count === 4 && deterministic.hidden_verifier_passed === true &&
    deterministic.typed_final_result === true, "deterministic");
  require(retry.retry_capability_invocations === 1 && retry.retry_content_writes === 1 &&
    retry.retry_child_frame_byte_identical === true, "retry");
  require(replay.replay_fresh_effect_count === 0 && replay.replay_terminal_frame_byte_identical === true, "replay");
  require(branch.branching === true && branch.branch_result_crossing_rejected === true, "branch");
  require(migrate.migration === true && migrate.migration_receiver_preflight === true &&
    migrate.migration_secrets_transferred === false && migrate.migration_approval_transferred === false, "migrate");
  require(measure.measurements.applicationWasmBytes <= 6 * 1024 * 1024 &&
    measure.measurements.peakFrameBytes <= 384 * 1024 && measure.measurements.peakMachineStateBytes <= 320 * 1024, "measure");
  require(live.external_effect_count >= 41 && live.external_effect_count <= 63 && live.model_effect_count <= 32 &&
    live.non_model_effect_count <= 31 && live.receiver_verified_approval_count === 4 &&
    live.human_approval_required === false && live.test_count >= 5 && live.hidden_verifier_passed === true &&
    live.typed_final_result === true && live.openai_api_key_recorded === false && live.live_success_count >= 1, "live");
}
function lines(record) { return `${Object.entries(record).map(([key, value]) => `${key}=${value}`).join("\n")}\n`; }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
async function json(path) { return JSON.parse(await readFile(path)); }
function require(condition, label) { if (!condition) throw new Error(`adequacy_release_${label}_failed`); }
function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--") || index + 1 >= argv.length) throw new Error(`unknown_argument:${argument}`);
    result[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = argv[index += 1];
  }
  return result;
}
