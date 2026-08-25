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

const EXPECTED_KERNEL_SHA256 =
  "12973fb655f126c2acd5693a84be47496649d1ab10bf22d565c9b675172e4f27";
const EXPECTED_UNRELATED_BPI1_SHA256 =
  "6564f37639bfd4cf33491582e71b4f6602f865ea619b9616627080d86f805f0e";
const EXPECTED_UNRELATED_MV2P1_SHA256 =
  "08ad3c629f819e580c6bec364db9c88ad578f66e24a2cbb1e3c5424987fa7ec5";

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
  const environment = sourceSnapshotEnvironment(options.zig, home);
  const boundaryInputs = snapshotBoundaryInputs(options, proofRoot);
  const binding = bindSource(options.agentRoot, gitExecutable, environment);
  const archive = join(proofRoot, "agent-source.tar.gz");
  run(gitExecutable, [
    "-C",
    options.agentRoot,
    "archive",
    "--format=tar.gz",
    "--prefix=agent-source/",
    `--output=${archive}`,
    binding.head
  ], options.agentRoot, environment);
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
    options.zig,
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
  run(options.zig, command, sourceSnapshot, environment);
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
  else process.stderr.write(`agent_source_snapshot_root=${proofRoot}\n`);
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
  return run(executable, ["-C", root, ...args], root, environment, false).stdout.trim();
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

function sourceSnapshotEnvironment(zig, home) {
  const environment = {
    HOME: home,
    LANG: "C",
    LC_ALL: "C",
    LOGNAME: process.env.LOGNAME ?? "agent-interpretation",
    NO_COLOR: "1",
    PATH: [...new Set([
      dirname(zig),
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin"
    ])].join(":"),
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
