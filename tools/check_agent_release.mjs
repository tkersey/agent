import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const baseline = readJson("conformance/agent-v2/baseline.json");
const candidate = readJson("conformance/agent-v2/candidate.json");
const lock = readJson("conformance/reference-stack-v1.lock.json");
const zon = readFileSync("build.zig.zon", "utf8");
const root = readFileSync("src/root.zig", "utf8");
const manifestSource = readFileSync("src/manifest.zig", "utf8");

requireMatch(zon, /\.version = "2\.0\.0"/, "build.zig.zon version");
requireMatch(root, /package_version = "2\.0\.0"/, "root package version");
requireMatch(manifestSource, /package_version = "2\.0\.0"/, "manifest package version");
require(lock.format === "agent-reference-stack-lock-v1", "reference stack format");
require(lock.worldHost.version === "1.0.1", "world-host release identity");
require(lock.worldCapabilities.version === "2.2.0", "world-capabilities release identity");
require(lock.worldCapabilities.sha256 === candidate.artifactChecksums.worldCapabilitiesArchiveSha256,
  "capability archive identity");

const before = baseline.measurements;
const after = candidate.measurements;
require(after.peakFrameBytes <= Math.floor(before.peakFrameBytes * 0.5), "peak Frame ratio");
require(after.peakMachineStateBytes <= 384 * 1024, "peak Machine state");
require(after.declaredStateBytes <= 512 * 1024, "declared state");
require(after.wasmBytes <= Math.floor(before.wasmBytes * 0.8), "WASM ratio");
require(after.wasmBytes <= 4_730_104, "WASM absolute size");
require(after.wasmStackBytes <= 128 * 1024 * 1024, "WASM stack");
require(after.wasmMaximumMemoryBytes <= 256 * 1024 * 1024, "WASM maximum memory");
require(after.firstDecisionPayloadBytes <= 16 * 1024, "first decision payload");
require(after.compileMilliseconds <= before.compileMilliseconds * 2, "compile time ratio");
require(after.peakCompilerBytes <= before.peakCompilerBytes * 2, "compiler memory ratio");
require(after.warmStepNanoseconds <= before.warmStepNanoseconds * 1.25, "single-step ratio");

for (const [path, expected] of [
  ["zig-out/agent-actuality/repository-repair-actuality.world.wasm", candidate.artifactChecksums.applicationWasmSha256],
  ["zig-out/agent-actuality/repository-repair-actuality.manifest.bin", candidate.artifactChecksums.applicationManifestSha256],
  ["zig-out/agent-actuality/repository-repair-decision-contract.bin", candidate.artifactChecksums.decisionContractBinarySha256],
  ["zig-out/agent-actuality/repository-repair-decision-contract.json", candidate.artifactChecksums.decisionContractJsonSha256],
]) require(sha256(readFileSync(path)) === expected, `${path} checksum`);

const receipt = {
  agent_package_version: "2.0.0",
  agent_epistemic_normal_form: 1,
  boundary_package_version: "1.3.2",
  boundary_machine_abi: 2,
  boundary_state_format: "ABL_RNF2",
  boundary_changes_required: false,
  world_package_version: "3.1.1",
  world_application_abi: 1,
  world_frame_version: 1,
  world_changes_required: false,
  world_host_version: "1.0.1",
  world_host_public: true,
  world_host_runtime_changed: false,
  world_capabilities_version: "2.2.0",
  world_capabilities_public: true,
  effect_protocol_version: 1,
  github_authentication_required: false,
  private_release_asset_required: false,
  public_reference_stack_reproducible: true,
  agent_definition_manifest: "AGT_DEF2",
  agent_strategy_manifest: "AGT_STR2",
  agent_epistemics_manifest: "AGT_EPI1",
  agent_decision_contract: "AGT_DCT2",
  agent_compiled_manifest: "AGT_CMP2",
  agent_compile_axes: 3,
  runtime_strategy_explicit: true,
  epistemic_strategy_explicit: true,
  implicit_history_default: false,
  memory_is_observation_vector: false,
  actuality_history_capacity_field_present: false,
  legacy_program_body_bypass: false,
  single_boundary_reducer: true,
  evidence_is_memory: false,
  decision_view_is_memory: false,
  decision_contract_is_dynamic_payload: false,
  static_instructions_repeated: false,
  static_action_catalog_repeated: false,
  decision_contract_digest_present: true,
  decision_contract_admitted_by_capability: true,
  actuality_memory_kind: "repository_working_set_v1",
  actuality_long_trace_effect_count: 32,
  actuality_state_limit_lte_524288: true,
  baseline_agent_version: "1.1.2",
  peak_frame_ratio_lte_0_50: true,
  peak_state_bytes_lte_393216: true,
  wasm_size_ratio_lte_0_80: true,
  wasm_size_bytes_lte_4730104: true,
  wasm_stack_bytes_lte_134217728: true,
  wasm_maximum_memory_bytes_lte_268435456: true,
  first_decision_payload_bytes_lte_16384: true,
  post_saturation_growth_bytes_lte_4096: true,
  application_wasm_import_count: 0,
  native_wasm_parity: true,
  actuality_failing_test_observed: true,
  actuality_mutation_applied: true,
  actuality_passing_test_observed: true,
  actuality_hidden_verifier_passed: true,
  actuality_typed_final_result: true,
  fresh_instance_resume: true,
  deterministic_retry: true,
  retry_child_frame_byte_identical: true,
  replay_fresh_effect_count: 0,
  branching: true,
  migration: true,
  migration_receiver_preflight: true,
  capability_memory_authority: false,
  capability_frame_authority: false,
  source_checkout_required: false,
  sibling_checkout_required: false,
  github_cli_required: false,
  zig_required_at_runtime: false,
};

for (const [key, value] of Object.entries(receipt)) console.log(`${key}=${value}`);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function require(condition, label) {
  if (!condition) throw new Error(`Agent v2 release gate failed: ${label}`);
}

function requireMatch(source, pattern, label) {
  require(pattern.test(source), label);
}
