#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import { inspectTarGz } from "../reference_stack.mjs";
import { admitZigBinarySha256 } from "../zig_binary_identity.mjs";
import {
  closedVerifierPath,
  materializeVerifierBin,
  resolveVerifierExecutables
} from "../verifier_executables.mjs";

const EXPECTED_KERNEL_SHA256 =
  "12973fb655f126c2acd5693a84be47496649d1ab10bf22d565c9b675172e4f27";
const EXPECTED_UNRELATED_BPI1_SHA256 =
  "6564f37639bfd4cf33491582e71b4f6602f865ea619b9616627080d86f805f0e";
const EXPECTED_UNRELATED_MV2P1_SHA256 =
  "08ad3c629f819e580c6bec364db9c88ad578f66e24a2cbb1e3c5424987fa7ec5";
const EXPECTED_APPLICATION_WASM_SHA256 =
  "8f60b66adad465fbbe01ad4511c765c0e0e31929fea7717de1fa862ceff1d491";
const EXPECTED_PROOF_INPUT_DIGEST =
  "cd203ba8cc3d4410fa2a8d81cc0ec389b2de5d1612f0ee6a2e4a056bd83e053d";
const EXPECTED_BPI1_SHA256 =
  "7440076a8078220d9d4000b871423d981bbbee19aedba499afaa4a86239fe6a6";
const EXPECTED_MV2P1_SHA256 =
  "03e93800b20201d2015a93821bd19418848637541f9125eee3877b5a4db24c2e";
const EXPECTED_APPLICATION_ID =
  "b2e6628424ed95648a554ab5730566476360de86c9534a375357ba152031cf4c";
const EXPECTED_TERMINAL_RESULT_SHA256 =
  "6a473b2e74e2f8229d10061d1b613ad71ab2ad5b139c21bd9a898b7a2778f75c";
const EXPECTED_FINAL_GIT_TREE =
  "0d9ac8802aac6597cb0a443245efb6f92a0249fe";
const EXPECTED_PROGRAM_TRANSITION_DIGEST =
  "48eb6ec9a74b9a4c958d78c526f3eacded2ba5baad2402a05465e3f1dbe34816";
const EXPECTED_MACHINE_V2_CONTRACT_DIGEST =
  "e5143aecdf9e1d0e7c18ccf70ef158eeec2e59840574acc40a09ec58d7e9b08d";
const EXPECTED_DECISION_CONTRACT_DIGEST =
  "28ad8f64d48be98b260c14d91ef7a61387c0782b61f0cca641bd38ed8efae7ae";
const EXPECTED_WORLD_HOST_RUNTIME_SHA256 =
  "dfb59aaa8c2288ae85c69a31cfd7a400d9f2f27f26e0098f973442cb273977f2";
const EXPECTED_WORLD_CAPABILITIES_RUNTIME_SHA256 =
  "7400c278f42ceb252e6e683f7206c7b0d25909b9013b538dcd8a3594f005cd16";

const INNER_RECEIPT_FIELDS = Object.freeze([
  "format",
  "agent_commit",
  "agent_source_archive_sha256",
  "agent_source_git_tree",
  "agent_source_tree_digest",
  "agent_version",
  "boundary_version",
  "boundary_compiler_version",
  "boundary_source_commit",
  "boundary_package_hash",
  "world_version",
  "world_source_commit",
  "world_package_hash",
  "kernel_wasm_sha256",
  "kernel_import_count",
  "application_wasm_sha256",
  "proof_input_digest",
  "world_host_runtime_sha256",
  "world_capabilities_runtime_sha256",
  "bpi1_sha256",
  "mv2p1_sha256",
  "unrelated_bpi1_sha256",
  "unrelated_mv2p1_sha256",
  "program_transition_digest",
  "machine_v2_contract_digest",
  "application_id",
  "decision_contract_digest",
  "effect_count",
  "effect_catalog_count",
  "observed_effect_identity_count",
  "model_decision_count",
  "repository_effect_count",
  "yield_boundary_count",
  "state_comparison_count",
  "interface_identity_comparison_count",
  "payload_comparison_count",
  "request_identity_comparison_count",
  "response_comparison_count",
  "specialized_file_read_count",
  "interpreted_file_read_count",
  "specialized_search_count",
  "interpreted_search_count",
  "specialized_test_run_count",
  "interpreted_test_run_count",
  "specialized_pre_mutation_test_failed",
  "interpreted_pre_mutation_test_failed",
  "specialized_terminal_result_sha256",
  "interpreted_terminal_result_sha256",
  "specialized_final_git_tree",
  "interpreted_final_git_tree",
  "clean_room_agent_source_absent",
  "application_specific_wasm_absent",
  "hidden_verifier_passed",
  "specialized_interpreted_equivalent",
  "clean_room_inventory",
  "negative_gates"
]);

const NEGATIVE_GATE_FIELDS = Object.freeze([
  "corrupted_bpi1_rejected",
  "corrupted_bpi1_routing_magic_rejected",
  "corrupted_mv2p1_rejected",
  "wrong_kernel_rejected",
  "missing_bpi1_rejected",
  "unrelated_pair_validated",
  "unrelated_completion_rejected",
  "mutated_response_rejected",
  "source_smuggling_rejected",
  "provider_loop_import_smuggling_rejected",
  "application_specific_wasm_smuggling_rejected",
  "untracked_path_detected",
  "sandbox_agent_source_read_rejected",
  "sandbox_application_wasm_read_rejected",
  "sandbox_world_host_source_read_rejected",
  "sandbox_world_capabilities_source_read_rejected",
  "sandbox_outside_clean_room_read_rejected",
  "sandbox_positive_control_passed",
  "sandbox_network_read_rejected",
  "sandbox_runtime_input_write_rejected",
  "sandbox_git_control_write_rejected",
  ...(process.platform === "linux" ? ["sandbox_host_proc_root_read_rejected"] : []),
  "proof_input_mutation_detected"
]);

const FORWARDED_OPTIONS = Object.freeze([
  "boundary-archive",
  "boundary-kernel-wasm",
  "interpretation-kernel-wasm",
  "interpretation-unrelated-bpi1",
  "interpretation-unrelated-mv2p1",
  "world-archive",
  "world-host-archive",
  "world-capabilities-archive",
  "world-capabilities-root",
  "world-host-root"
]);

const options = parseArguments(process.argv.slice(2));
const proofRoot = realpathSync(
  mkdtempSync(join(tmpdir(), "agent-interpretation-source-"))
);
let passed = false;

try {
  const gitExecutable = "/usr/bin/git";
  const tarExecutable = "/usr/bin/tar";
  if (!existsSync(gitExecutable) || !existsSync(tarExecutable)) {
    throw new Error("trusted source-snapshot tools are unavailable");
  }
  const home = join(proofRoot, "home");
  mkdirSync(home);
  const verifierExecutables = resolveVerifierExecutables();
  const admittedZigTarget = realpathSync(options.zig);
  requireZigBinary(admittedZigTarget);
  const verifierBin = materializeVerifierBin(proofRoot, admittedZigTarget, verifierExecutables);
  const admittedZig = join(verifierBin, "zig");
  requireZigBinary(admittedZig);
  const environment = sourceSnapshotEnvironment(home, verifierBin);
  const boundaryInputs = snapshotBoundaryInputs(options, proofRoot);
  requireSourceGitIsolation(options.agentRoot, gitExecutable, environment);
  const binding = bindSource(options.agentRoot, gitExecutable, environment);
  const archive = join(proofRoot, "agent-source.tar.gz");
  git(options.agentRoot, gitExecutable, environment, [
    "archive",
    "--format=tar.gz",
    "--prefix=agent-source/",
    `--output=${archive}`,
    binding.head
  ]);
  requireSourceUnchanged(options.agentRoot, binding, gitExecutable, environment);
  inspectTarGz(archive, "agent-source", { tarExecutable, environment });
  const archiveSha256 = sha256(readFileSync(archive));
  const extracted = join(proofRoot, "extracted");
  mkdirSync(extracted);
  run(tarExecutable, ["-xzf", archive, "-C", extracted], proofRoot, environment);
  const sourceSnapshot = join(extracted, "agent-source");
  if (!existsSync(sourceSnapshot) || existsSync(join(sourceSnapshot, ".git"))) {
    throw new Error("Agent source snapshot is invalid");
  }
  const sourceTreeDigest = digestSourceTree(sourceSnapshot);
  const packageScratch = join(sourceSnapshot, "zig-pkg");
  mkdirSync(packageScratch);
  makeReadOnly(sourceSnapshot, packageScratch);
  prefetchDependencyTree(
    admittedZig,
    sourceSnapshot,
    join(proofRoot, "agent-fetch-cache"),
    options.globalCacheDir,
    environment
  );

  const prefix = join(proofRoot, "out");
  const command = [
    "build",
    "check-agent-interpretation-v1",
    "-Dinterpretation-source-snapshot=true",
    `-Dagent-source-head=${binding.head}`,
    `-Dagent-source-archive-sha256=${archiveSha256}`,
    `-Dagent-source-tree=${binding.tree}`,
    "--cache-dir",
    join(proofRoot, "zig-cache"),
    "--global-cache-dir",
    options.globalCacheDir,
    "--prefix",
    prefix,
    "--summary",
    "all"
  ];
  for (const name of FORWARDED_OPTIONS) {
    const key = toCamelCase(name);
    const value = boundaryInputs[key] ?? options[key];
    if (value !== undefined) command.push(`-D${name}=${value}`);
  }
  run(admittedZig, command, sourceSnapshot, environment);
  requireSourceUnchanged(options.agentRoot, binding, gitExecutable, environment);
  const receiptPath = join(
    prefix,
    "agent-interpretation-v1",
    "agent-interpretation-v1-receipt.json"
  );
  const receipt = JSON.parse(readFileSync(receiptPath));
  if (receipt.format !== "agent-interpretation-v1-inner" ||
      receipt.agent_commit !== binding.head ||
      receipt.agent_source_git_tree !== binding.tree ||
      receipt.agent_source_archive_sha256 !== archiveSha256 ||
      receipt.agent_source_tree_digest !== sourceTreeDigest ||
      receipt.kernel_wasm_sha256 !== EXPECTED_KERNEL_SHA256 ||
      receipt.unrelated_bpi1_sha256 !== EXPECTED_UNRELATED_BPI1_SHA256 ||
      receipt.unrelated_mv2p1_sha256 !== EXPECTED_UNRELATED_MV2P1_SHA256) {
    throw new Error("snapshot proof receipt source binding mismatch");
  }
  requireCanonicalInnerReceipt(receipt);
  const publicReceipt = {
    ...receipt,
    format: "agent-interpretation-v1",
    agent_source_binding: "git-archive-v1"
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(publicReceipt, null, 2)}\n`);
  mkdirSync(dirname(options.receiptOutput), { recursive: true });
  writeFileSync(options.receiptOutput, receiptBytes);
  process.stdout.write(`agent_source_commit=${binding.head}\n`);
  process.stdout.write(`agent_source_tree=${binding.tree}\n`);
  process.stdout.write(`agent_source_archive_sha256=${archiveSha256}\n`);
  process.stdout.write(`agent_source_tree_digest=${sourceTreeDigest}\n`);
  process.stdout.write("agent_source_snapshot_read_only=true\n");
  passed = true;
} finally {
  if (passed) {
    makeWritable(proofRoot);
    rmSync(proofRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50
    });
  }
  else {
    makeWritable(proofRoot);
    process.stderr.write(`agent_source_snapshot_root=${proofRoot}\n`);
  }
}

function bindSource(root, gitExecutable, environment) {
  const head = git(root, gitExecutable, environment, ["rev-parse", "HEAD"]);
  const tree = git(root, gitExecutable, environment, ["rev-parse", "HEAD^{tree}"]);
  if (!/^[0-9a-f]{40}$/.test(head) || !/^[0-9a-f]{40}$/.test(tree)) {
    throw new Error("Agent Git source identity is invalid");
  }
  const binding = Object.freeze({ head, tree });
  requireSourceUnchanged(root, binding, gitExecutable, environment);
  return binding;
}

function requireSourceUnchanged(root, expected, gitExecutable, environment) {
  const current = Object.freeze({
    head: git(root, gitExecutable, environment, ["rev-parse", "HEAD"]),
    tree: git(root, gitExecutable, environment, ["rev-parse", "HEAD^{tree}"])
  });
  const status = git(root, gitExecutable, environment, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all"
  ]).split("\n").filter(Boolean).filter((line) => {
    const encoded = line.slice(3);
    const path = encoded.includes(" -> ") ? encoded.split(" -> ").at(-1) : encoded;
    return !path.startsWith("zig-out/") && !path.startsWith("zig-pkg/");
  });
  if (current.head !== expected.head || current.tree !== expected.tree || status.length !== 0) {
    throw new Error("Agent source changed during snapshot-bound interpretation proof");
  }
}

function git(root, executable, environment, args) {
  return run(executable, [
    "-c", "core.attributesFile=/dev/null",
    "-c", "core.excludesFile=/dev/null",
    "-c", "core.fsmonitor=false",
    "-c", "core.hooksPath=/dev/null",
    "-c", "tar.tar.gz.command=/usr/bin/gzip -cn",
    "-C", root,
    ...args
  ], root, {
    ...environment,
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0"
  }, false).stdout.trim();
}

function requireSourceGitIsolation(root, executable, environment) {
  const gitPath = (path) => {
    const value = git(root, executable, environment, ["rev-parse", "--git-path", path]);
    return resolve(root, value);
  };
  const attributes = gitPath("info/attributes");
  if (existsSync(attributes) && readFileSync(attributes, "utf8").trim().length !== 0) {
    throw new Error("source snapshot rejects non-tree Git attributes");
  }
  const replacements = gitPath("refs/replace");
  if (existsSync(replacements) && treeContainsFile(replacements)) {
    throw new Error("source snapshot rejects Git replacement refs");
  }
}

function treeContainsFile(root) {
  const metadata = lstatSync(root);
  if (metadata.isFile()) return true;
  if (!metadata.isDirectory()) throw new Error(`source Git metadata is non-regular: ${root}`);
  return readdirSync(root).some((name) => treeContainsFile(join(root, name)));
}

function makeReadOnly(root, writableScratch) {
  const visit = (path) => {
    if (path === writableScratch) {
      chmodSync(path, 0o700);
      return;
    }
    const stat = lstatSync(path);
    if (stat.isDirectory()) {
      for (const name of readdirSync(path)) visit(join(path, name));
      chmodSync(path, 0o555);
    } else if (stat.isFile()) {
      chmodSync(path, stat.mode & 0o111 ? 0o555 : 0o444);
    } else {
      throw new Error(`Agent source snapshot contains a non-regular path: ${path}`);
    }
  };
  visit(root);
}

function makeWritable(root) {
  if (!existsSync(root)) return;
  const stat = lstatSync(root);
  if (stat.isDirectory()) {
    chmodSync(root, 0o700);
    for (const name of readdirSync(root)) makeWritable(join(root, name));
  } else if (stat.isFile()) {
    chmodSync(root, 0o600);
  }
}

function digestSourceTree(root) {
  const files = [];
  const visit = (directory) => {
    for (const name of readdirSync(directory).sort(
      (left, right) => left.localeCompare(right)
    )) {
      const full = join(directory, name);
      const stat = lstatSync(full);
      if (stat.isDirectory()) visit(full);
      else if (stat.isFile()) files.push(relative(root, full));
      else throw new Error(`Agent source snapshot contains a non-regular path: ${full}`);
    }
  };
  visit(root);
  const hasher = createHash("sha256");
  hasher.update("agent-source-snapshot-tree-v1\0");
  for (const path of files) {
    const encoded = Buffer.from(path, "utf8");
    const bytes = readFileSync(join(root, path));
    const lengths = Buffer.alloc(8);
    lengths.writeUInt32LE(encoded.length, 0);
    lengths.writeUInt32LE(bytes.length, 4);
    hasher.update(lengths);
    hasher.update(encoded);
    hasher.update(bytes);
  }
  return hasher.digest("hex");
}

function sourceSnapshotEnvironment(home, verifierBin) {
  const environment = {
    HOME: home,
    LANG: "C",
    LC_ALL: "C",
    LOGNAME: process.env.LOGNAME ?? "agent-interpretation",
    NO_COLOR: "1",
    PATH: closedVerifierPath(verifierBin),
    SHELL: "/bin/sh",
    TERM: "dumb",
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    USER: process.env.USER ?? "agent-interpretation",
    XDG_CACHE_HOME: join(home, ".cache")
  };
  for (const name of [
    "ALL_PROXY",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE"
  ]) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  return environment;
}

function prefetchDependencyTree(zig, root, cache, globalCache, environment) {
  run(zig, [
    "build",
    "--fetch",
    "--cache-dir",
    cache,
    "--global-cache-dir",
    globalCache
  ], root, environment);
}

function run(command, args, cwd, environment, forward = true) {
  const result = spawnSync(command, args, {
    cwd,
    env: environment,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024
  });
  if (forward && result.stdout) process.stdout.write(result.stdout);
  if (forward && result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}:\n${result.stderr ?? ""}`);
  }
  return result;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireZigBinary(zig) {
  admitZigBinarySha256(sha256(readFileSync(zig)));
}

function requireCanonicalInnerReceipt(receipt) {
  requireExactKeys(receipt, INNER_RECEIPT_FIELDS, "inner receipt");
  for (const [field, expected] of Object.entries({
    format: "agent-interpretation-v1-inner",
    agent_version: "2.7.0",
    boundary_version: "1.6.0",
    boundary_compiler_version: "1.6.1",
    boundary_source_commit: "4788bc152d2b0213e9c5c4e6544df1231e4b034d",
    boundary_package_hash: "boundary-1.6.1-flclaE0pHgC1I33KEuEcfwmoMEidT7fLonNkdqBIlfwf",
    world_version: "3.1.4",
    world_source_commit: "5d8fad6e76863312c19a5ba6988bf6307f29a783",
    world_package_hash: "world-3.1.4-XXTUeO3GBgD8JA4s-vElnLKVnT11p5mv6MS0eV5nk-Fd",
    kernel_wasm_sha256: EXPECTED_KERNEL_SHA256,
    world_host_runtime_sha256: EXPECTED_WORLD_HOST_RUNTIME_SHA256,
    world_capabilities_runtime_sha256: EXPECTED_WORLD_CAPABILITIES_RUNTIME_SHA256,
    application_wasm_sha256: EXPECTED_APPLICATION_WASM_SHA256,
    proof_input_digest: EXPECTED_PROOF_INPUT_DIGEST,
    bpi1_sha256: EXPECTED_BPI1_SHA256,
    mv2p1_sha256: EXPECTED_MV2P1_SHA256,
    unrelated_bpi1_sha256: EXPECTED_UNRELATED_BPI1_SHA256,
    unrelated_mv2p1_sha256: EXPECTED_UNRELATED_MV2P1_SHA256,
    program_transition_digest: EXPECTED_PROGRAM_TRANSITION_DIGEST,
    machine_v2_contract_digest: EXPECTED_MACHINE_V2_CONTRACT_DIGEST,
    application_id: EXPECTED_APPLICATION_ID,
    decision_contract_digest: EXPECTED_DECISION_CONTRACT_DIGEST,
    specialized_terminal_result_sha256: EXPECTED_TERMINAL_RESULT_SHA256,
    interpreted_terminal_result_sha256: EXPECTED_TERMINAL_RESULT_SHA256,
    specialized_final_git_tree: EXPECTED_FINAL_GIT_TREE,
    interpreted_final_git_tree: EXPECTED_FINAL_GIT_TREE
  })) {
    if (receipt[field] !== expected) {
      throw new Error(`inner receipt ${field} mismatch: ${receipt[field]}`);
    }
  }
  for (const [field, expected] of Object.entries({
    kernel_import_count: 0,
    effect_count: 17,
    effect_catalog_count: 6,
    observed_effect_identity_count: 6,
    model_decision_count: 9,
    repository_effect_count: 8,
    yield_boundary_count: 1,
    state_comparison_count: 17,
    interface_identity_comparison_count: 17,
    payload_comparison_count: 17,
    request_identity_comparison_count: 17,
    response_comparison_count: 17,
    specialized_file_read_count: 4,
    interpreted_file_read_count: 4,
    specialized_search_count: 1,
    interpreted_search_count: 1,
    specialized_test_run_count: 2,
    interpreted_test_run_count: 2
  })) {
    if (receipt[field] !== expected) {
      throw new Error(`inner receipt ${field} mismatch: ${receipt[field]}`);
    }
  }
  for (const field of [
    "specialized_pre_mutation_test_failed",
    "interpreted_pre_mutation_test_failed",
    "clean_room_agent_source_absent",
    "application_specific_wasm_absent",
    "hidden_verifier_passed",
    "specialized_interpreted_equivalent"
  ]) {
    if (receipt[field] !== true) throw new Error(`inner receipt ${field} is not true`);
  }
  for (const field of [
    "agent_commit",
    "agent_source_git_tree",
    "boundary_source_commit",
    "world_source_commit",
    "specialized_final_git_tree",
    "interpreted_final_git_tree"
  ]) {
    requireHex(receipt[field], field, 40);
  }
  for (const field of [
    "agent_source_archive_sha256",
    "agent_source_tree_digest",
    "kernel_wasm_sha256",
    "application_wasm_sha256",
    "proof_input_digest",
    "world_host_runtime_sha256",
    "world_capabilities_runtime_sha256",
    "bpi1_sha256",
    "mv2p1_sha256",
    "unrelated_bpi1_sha256",
    "unrelated_mv2p1_sha256",
    "program_transition_digest",
    "machine_v2_contract_digest",
    "application_id",
    "decision_contract_digest",
    "specialized_terminal_result_sha256",
    "interpreted_terminal_result_sha256"
  ]) {
    requireHex(receipt[field], field, 64);
  }
  if (!Array.isArray(receipt.clean_room_inventory) || receipt.clean_room_inventory.length === 0 ||
      new Set(receipt.clean_room_inventory).size !== receipt.clean_room_inventory.length ||
      receipt.clean_room_inventory.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    throw new Error("inner receipt clean-room inventory is invalid");
  }
  requireExactKeys(receipt.negative_gates, NEGATIVE_GATE_FIELDS, "inner receipt negative gates");
  for (const field of NEGATIVE_GATE_FIELDS) {
    if (receipt.negative_gates[field] !== true) {
      throw new Error(`inner receipt negative gate ${field} is not true`);
    }
  }
}

function requireExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(canonical)) {
    throw new Error(`${label} fields mismatch: ${actual.join(",")}`);
  }
}

function requireHex(value, field, length) {
  if (typeof value !== "string" || value.length !== length || !/^[0-9a-f]+$/.test(value)) {
    throw new Error(`inner receipt ${field} is not canonical hex`);
  }
}

function snapshotBoundaryInputs(options, proofRoot) {
  const root = join(proofRoot, "boundary-inputs");
  mkdirSync(root);
  const result = {};
  for (const [key, label, path, expected, basename] of [
    ["interpretationKernelWasm", "kernel", options.interpretationKernelWasm, EXPECTED_KERNEL_SHA256, "boundary-machine-v2-kernel-v1.wasm"],
    ["interpretationUnrelatedBpi1", "unrelated BPI1", options.interpretationUnrelatedBpi1, EXPECTED_UNRELATED_BPI1_SHA256, "one-effect.boundary-program-image"],
    ["interpretationUnrelatedMv2p1", "unrelated MV2P1", options.interpretationUnrelatedMv2p1, EXPECTED_UNRELATED_MV2P1_SHA256, "one-effect.machine-v2-profile"]
  ]) {
    const before = sha256(readFileSync(path));
    if (before !== expected) {
      throw new Error(`${label} source-snapshot input digest mismatch: ${before}`);
    }
    const snapshot = join(root, basename);
    copyFileSync(path, snapshot);
    chmodSync(snapshot, 0o444);
    const after = sha256(readFileSync(snapshot));
    if (after !== expected) throw new Error(`${label} snapshot digest mismatch: ${after}`);
    result[key] = snapshot;
  }
  return Object.freeze(result);
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--") || index + 1 >= argv.length) {
      throw new Error(`unknown argument: ${argument}`);
    }
    result[toCamelCase(argument.slice(2))] = resolve(argv[index += 1]);
  }
  for (const key of [
    "agentRoot",
    "zig",
    "globalCacheDir",
    "receiptOutput",
    "interpretationKernelWasm",
    "interpretationUnrelatedBpi1",
    "interpretationUnrelatedMv2p1"
  ]) {
    if (typeof result[key] !== "string") throw new Error(`missing argument: ${key}`);
  }
  return result;
}
