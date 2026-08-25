#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
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
import { dirname, join, resolve } from "node:path";

import { inspectTarGz } from "../reference_stack.mjs";

const FORWARDED_OPTIONS = Object.freeze([
  "boundary-archive",
  "boundary-kernel-wasm",
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
  const boundaryPackages = readdirSync(packageScratch)
    .filter((name) => name.startsWith("boundary-"));
  if (boundaryPackages.length !== 1) {
    throw new Error(`expected one Boundary package, found ${boundaryPackages.length}`);
  }
  prefetchDependencyTree(
    options.zig,
    join(packageScratch, boundaryPackages[0]),
    join(proofRoot, "boundary-fetch-cache"),
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
    const value = options[toCamelCase(name)];
    if (value !== undefined) command.push(`-D${name}=${value}`);
  }
  run(options.zig, command, sourceSnapshot, environment);
  requireSourceUnchanged(options.agentRoot, binding, gitExecutable, environment);
  const receiptPath = join(
    prefix,
    "agent-interpretation-v1",
    "agent-interpretation-v1-receipt.json"
  );
  const receiptBytes = readFileSync(receiptPath);
  const receipt = JSON.parse(receiptBytes);
  if (receipt.agent_commit !== binding.head ||
      receipt.agent_source_archive_sha256 !== archiveSha256) {
    throw new Error("snapshot proof receipt source binding mismatch");
  }
  mkdirSync(dirname(options.receiptOutput), { recursive: true });
  writeFileSync(options.receiptOutput, receiptBytes, { flag: "wx" });
  process.stdout.write(`agent_source_commit=${binding.head}\n`);
  process.stdout.write(`agent_source_tree=${binding.tree}\n`);
  process.stdout.write(`agent_source_archive_sha256=${archiveSha256}\n`);
  process.stdout.write("agent_source_snapshot_read_only=true\n");
  passed = true;
} finally {
  if (passed) rmSync(proofRoot, { recursive: true, force: true });
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
  for (const key of ["agentRoot", "zig", "globalCacheDir", "receiptOutput"]) {
    if (typeof result[key] !== "string") throw new Error(`missing argument: ${key}`);
  }
  return result;
}
