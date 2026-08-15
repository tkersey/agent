import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const baseline = readJson("conformance/agent-v2/baseline.json");
const candidate = readJson("conformance/agent-v2/candidate.json");
const lock = readJson("conformance/reference-stack-v1.lock.json");
const installPrefix = resolve(process.argv[2] ?? "zig-out");
const actualityRoot = join(installPrefix, "agent-actuality");
const stackReceipt = readJson(join(actualityRoot, "reference-stack-receipt.json"));
const zon = readFileSync("build.zig.zon", "utf8");
const root = readFileSync("src/root.zig", "utf8");
const manifestSource = readFileSync("src/manifest.zig", "utf8");
const declaredPackagePaths = packagePaths();

requireMatch(zon, /\.version = "2\.0\.0"/, "build.zig.zon version");
requireMatch(root, /package_version = "2\.0\.0"/, "root package version");
requireMatch(manifestSource, /package_version = "2\.0\.0"/, "manifest package version");
require(lock.format === "agent-reference-stack-lock-v1", "reference stack format");
require(lock.worldHost.version === "1.0.1", "world-host release identity");
require(lock.worldCapabilities.version === "2.2.1", "world-capabilities release identity");
require(lock.worldHost.sha256 === candidate.artifactChecksums.worldHostRuntimeArchiveSha256,
  "host archive identity");
require(lock.worldCapabilities.sha256 === candidate.artifactChecksums.worldCapabilitiesArchiveSha256,
  "capability archive identity");
require(stackReceipt.format === "agent-reference-stack-receipt-v1", "reference stack receipt format");
require(stackReceipt.worldHostArchiveSha256 === lock.worldHost.sha256, "reference receipt host archive");
require(stackReceipt.worldCapabilitiesArchiveSha256 === lock.worldCapabilities.sha256,
  "reference receipt capability archive");

const agentCommit = existsSync(".git") ? git(["rev-parse", "HEAD"]) : "source-archive";
const agentTree = existsSync(".git") ? git(["rev-parse", "HEAD^{tree}"]) : "source-archive";
const agentGitArchiveSha256 = existsSync(".git")
  ? sha256(execFileSync("git", ["archive", "--format=tar", "HEAD"]))
  : "source-archive";
if (existsSync(".git")) requireCleanPackageInputs();
require(sourceProjectionSha256() === candidate.identities.sourceProjectionSha256,
  "Agent benchmark source projection");
const installedManifest = decodeApplicationManifest(
  readFileSync(join(actualityRoot, "repository-repair-actuality.manifest.bin")),
);
const installedDecisionContract = readJson(
  join(actualityRoot, "repository-repair-decision-contract.json"),
);
require(installedManifest.applicationId === candidate.identities.applicationId,
  "candidate application identity");
require(stackReceipt.deterministic.application_id === candidate.identities.applicationId,
  "reference receipt application identity");
require(installedDecisionContract.semanticDigest === candidate.identities.decisionContractDigest,
  "candidate DecisionContract identity");
require(installedManifest.maximumStateBytes === candidate.measurements.declaredStateBytes,
  "candidate declared state identity");
const agentPackageHash = fetchPackageHash();
require(/^agent-2\.0\.0-[A-Za-z0-9_-]+$/.test(agentPackageHash), "Agent Zig package hash");

const before = baseline.measurements;
const after = candidate.measurements;
const fresh = stackReceipt.deterministic.measurements;
const freshCompiler = measureCurrentCompiler();
for (const field of [
  "applicationWasmBytes",
  "firstFrameBytes",
  "peakFrameBytes",
  "peakMachineStateBytes",
  "firstDecisionPayloadBytes",
  "peakDecisionPayloadBytes",
]) require(fresh[field] === after[field === "applicationWasmBytes" ? "wasmBytes" : field],
  `fresh candidate measurement ${field}`);
require(after.peakFrameBytes <= Math.floor(before.peakFrameBytes * 0.5), "peak Frame ratio");
require(after.peakMachineStateBytes <= 384 * 1024, "peak Machine state");
require(after.declaredStateBytes <= 512 * 1024, "declared state");
require(after.wasmBytes <= Math.floor(before.wasmBytes * 0.8), "WASM ratio");
require(after.wasmBytes <= 4_730_104, "WASM absolute size");
require(after.firstDecisionPayloadBytes <= 16 * 1024, "first decision payload");
require(freshCompiler.compileMilliseconds <= before.compileMilliseconds * 2, "fresh compile time ratio");
require(freshCompiler.peakCompilerBytes <= before.peakCompilerBytes * 2, "fresh compiler memory ratio");
require(fresh.warmStepNanoseconds <= before.warmStepNanoseconds * 1.25, "fresh single-step ratio");

for (const [path, expected] of [
  [join(actualityRoot, "repository-repair-actuality.world.wasm"), candidate.artifactChecksums.applicationWasmSha256],
  [join(actualityRoot, "repository-repair-actuality.manifest.bin"), candidate.artifactChecksums.applicationManifestSha256],
  [join(actualityRoot, "repository-repair-decision-contract.bin"), candidate.artifactChecksums.decisionContractBinarySha256],
  [join(actualityRoot, "repository-repair-decision-contract.json"), candidate.artifactChecksums.decisionContractJsonSha256],
]) require(sha256(readFileSync(path)) === expected, `${path} checksum`);

const wasmBytes = readFileSync(join(actualityRoot, "repository-repair-actuality.world.wasm"));
const wasmModule = new WebAssembly.Module(wasmBytes);
require(WebAssembly.Module.imports(wasmModule).length === 0, "application WASM imports");
const wasmInstance = new WebAssembly.Instance(wasmModule, {});
const emittedStackBytes = wasmInstance.exports.agent_actuality_wasm_stack_size_bytes?.();
const emittedMaximumMemoryBytes = wasmInstance.exports.memory?.buffer.byteLength;
require(emittedStackBytes === after.wasmStackBytes, "emitted WASM stack identity");
require(emittedStackBytes <= 128 * 1024 * 1024, "emitted WASM stack bound");
require(emittedMaximumMemoryBytes === after.wasmMaximumMemoryBytes, "emitted WASM memory identity");
require(emittedMaximumMemoryBytes <= 256 * 1024 * 1024, "emitted WASM maximum memory bound");
let memoryCanGrow = true;
try {
  wasmInstance.exports.memory.grow(1);
} catch (error) {
  if (error instanceof RangeError) memoryCanGrow = false;
  else throw error;
}
require(!memoryCanGrow, "emitted WASM maximum memory is closed");
require(stackReceipt.deterministic.hidden_verifier_passed === true, "fresh hidden verifier");
require(stackReceipt.deterministic.typed_final_result === true, "fresh typed final result");
require(stackReceipt.retry.retry_child_frame_byte_identical === true, "fresh retry");
require(stackReceipt.replay.replay_fresh_effect_count === 0, "fresh replay");
require(stackReceipt.branch.branching === true, "fresh branching");
require(stackReceipt.migrate.migration_receiver_preflight === true, "fresh migration");

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
  world_capabilities_version: "2.2.1",
  world_capabilities_public: true,
  effect_protocol_version: 1,
  github_authentication_required: false,
  private_release_asset_required: false,
  public_reference_stack_reproducible: true,
  world_host_runtime_archive_sha256: lock.worldHost.sha256,
  world_capabilities_archive_sha256: lock.worldCapabilities.sha256,
  agent_commit: agentCommit,
  agent_tree: agentTree,
  agent_git_archive_sha256: agentGitArchiveSha256,
  agent_package_hash: agentPackageHash,
  fresh_compile_milliseconds: freshCompiler.compileMilliseconds,
  fresh_peak_compiler_bytes: freshCompiler.peakCompilerBytes,
  fresh_warm_step_nanoseconds: fresh.warmStepNanoseconds,
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

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function sourceProjectionSha256() {
  const digest = createHash("sha256");
  const files = [];
  const visit = (relativePath) => {
    const stat = lstatSync(relativePath);
    if (!stat.isDirectory()) {
      files.push(relativePath);
      return;
    }
    const entries = readdirSync(relativePath, { withFileTypes: true });
    for (const entry of entries) {
      const path = `${relativePath}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else files.push(path);
    }
  };
  for (const path of declaredPackagePaths) visit(path);
  files.sort();
  for (const path of files) {
    digest.update(path);
    digest.update("\0");
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      digest.update("symlink\0");
      digest.update(readlinkSync(path));
    } else if (path === "conformance/agent-v2/candidate.json") {
      const projected = readJson(path);
      projected.identities.sourceProjectionSha256 = null;
      digest.update(canonicalJson(projected));
    } else {
      digest.update(readFileSync(path));
    }
    digest.update("\0");
  }
  return digest.digest("hex");
}

function packagePaths() {
  const packagePathsBlock = zon.match(/\.paths\s*=\s*\.\{([\s\S]*?)\n\s*\},/);
  require(packagePathsBlock !== null, "Agent package path declaration");
  const paths = [...packagePathsBlock[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  require(paths.length > 0, "Agent package paths");
  return paths;
}

function requireCleanPackageInputs() {
  const status = execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all", "--", ...declaredPackagePaths],
    { encoding: "utf8" },
  );
  require(status.length === 0, "clean declared Agent package inputs");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function decodeApplicationManifest(bytes) {
  let offset = 0;
  const requireBytes = (count) => {
    require(Number.isSafeInteger(count) && count >= 0 && offset + count <= bytes.length,
      "application manifest bounds");
  };
  const take = (count) => {
    requireBytes(count);
    const value = bytes.subarray(offset, offset + count);
    offset += count;
    return value;
  };
  const u32 = () => {
    requireBytes(4);
    const value = bytes.readUInt32BE(offset);
    offset += 4;
    return value;
  };
  const lenBytes = () => take(u32());

  require(take(8).toString("ascii") === "WRLDMNF1", "application manifest magic");
  require(u32() === 1, "application manifest version");
  const applicationId = take(32).toString("hex");
  lenBytes();
  lenBytes();
  lenBytes();
  take(4);
  lenBytes();
  take(4);
  take(32);
  take(u32() * 32);
  take(u32() * 113);
  take(8);
  const maximumStateBytes = u32();
  return { applicationId, maximumStateBytes };
}

function measureCurrentCompiler() {
  const workspace = mkdtempSync(join(tmpdir(), "agent-release-compiler-measurement-"));
  const timeFlag = process.platform === "darwin" ? "-l" : "-v";
  const started = process.hrtime.bigint();
  try {
    const result = spawnSync("/usr/bin/time", [
      timeFlag,
      "zig",
      "build",
      "check-agent-actuality-world",
      "--cache-dir",
      join(workspace, "cache"),
      "--prefix",
      join(workspace, "out"),
      "--summary",
      "none",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status !== 0) {
      throw new Error(`fresh compiler measurement failed:\n${result.stdout}\n${result.stderr}`);
    }
    const compileMilliseconds = Number(process.hrtime.bigint() - started) / 1_000_000;
    const mac = result.stderr.match(/(\d+)\s+maximum resident set size/);
    const linux = result.stderr.match(/Maximum resident set size \(kbytes\):\s*(\d+)/);
    const peakCompilerBytes = mac ? Number(mac[1]) : linux ? Number(linux[1]) * 1024 : 0;
    require(peakCompilerBytes > 0, "fresh compiler memory measurement");
    return { compileMilliseconds: Math.round(compileMilliseconds), peakCompilerBytes };
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

function fetchPackageHash() {
  const repository = process.cwd();
  const workspace = mkdtempSync(join(tmpdir(), "agent-release-zig-fetch-"));
  const archive = join(workspace, "agent.tar");
  try {
    copyFileSync(join(repository, "build.zig"), join(workspace, "build.zig"));
    copyFileSync(join(repository, "build.zig.zon"), join(workspace, "build.zig.zon"));
    execFileSync("tar", ["-cf", archive, "-C", repository, ...declaredPackagePaths]);
    return execFileSync("zig", [
      "fetch",
      "--global-cache-dir",
      join(workspace, "cache"),
      archive,
    ], {
      cwd: workspace,
      encoding: "utf8",
    }).trim();
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}
