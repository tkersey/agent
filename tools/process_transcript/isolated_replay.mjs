#!/usr/bin/env bun

import { createServer } from "node:net";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  appendFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  dirname,
  join,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SOURCE_FILES = Object.freeze([
  "process_kernel_client.mjs",
  "replay.mjs",
  "transcript_format.mjs",
]);
const DATA_FILES = Object.freeze([
  "agent-repository-repair-process-v1-transcript.bin",
  "agent-repository-repair-process-v1-transcript.json",
  "boundary-process-kernel-v1.wasm",
]);
const EXPECTED_INVENTORY = Object.freeze([...SOURCE_FILES, ...DATA_FILES].sort());
const ALLOWED_NODE_IMPORTS = new Set([
  "node:buffer",
  "node:crypto",
  "node:fs/promises",
  "node:path",
  "node:url",
]);
const FORBIDDEN_SOURCE_LITERALS = Object.freeze([
  "world-host",
  "world-capabilities",
  "repository_repair_codecs",
  "repository_workspace_binding",
  "Actuality.Compiled",
  "node:child_process",
  "node:http",
  "node:https",
  "node:net",
  "Bun.",
  "fetch(",
]);
const MAX_CHILD_OUTPUT_BYTES = 8 * 1024 * 1024;
const CHILD_DEADLINE_MS = 60_000;
const CHILD_TERMINATION_GRACE_MS = 1_000;

export async function runIsolatedReplay({
  agentRoot,
  kernelPath,
  manifestPath,
  payloadPath,
} = {}) {
  const roots = await validateInputs({ agentRoot, kernelPath, manifestPath, payloadPath });
  const cleanRoot = await mkdtemp(join(tmpdir(), "agent-process-transcript-replay-"));
  try {
    const runtimeRoot = join(cleanRoot, "runtime");
    const forbiddenRoot = join(cleanRoot, "forbidden-source-canaries");
    await Promise.all([
      mkdir(runtimeRoot, { mode: 0o700 }),
      createForbiddenSourceCanaries(forbiddenRoot),
    ]);

    const sourceRoot = dirname(fileURLToPath(import.meta.url));
    await Promise.all([
      ...SOURCE_FILES.map((name) => cp(join(sourceRoot, name), join(runtimeRoot, name), {
        errorOnExist: true,
        force: false,
      })),
      cp(roots.kernelPath, join(runtimeRoot, DATA_FILES[2]), {
        errorOnExist: true,
        force: false,
      }),
      cp(roots.manifestPath, join(runtimeRoot, DATA_FILES[1]), {
        errorOnExist: true,
        force: false,
      }),
      cp(roots.payloadPath, join(runtimeRoot, DATA_FILES[0]), {
        errorOnExist: true,
        force: false,
      }),
    ]);

    await assertExactRuntimeInventory(runtimeRoot);
    await assertGenericReplayClosure(runtimeRoot);
    const sourceNegatives = await proveSourceSmugglingRejected(cleanRoot, runtimeRoot);

    const sandbox = await createSandbox({ runtimeRoot });
    const sandboxNegatives = await proveSandboxBoundary({
      sandbox,
      runtimeRoot,
      forbiddenRoot,
      roots,
    });

    const execution = await sandbox.run([
      ...sandbox.bunCommand,
      join(runtimeRoot, "replay.mjs"),
      "--kernel",
      join(runtimeRoot, DATA_FILES[2]),
      "--manifest",
      join(runtimeRoot, DATA_FILES[1]),
      "--payload",
      join(runtimeRoot, DATA_FILES[0]),
    ]);
    if (execution.code !== 0) {
      throw new Error(
        `isolated_replay_failed:${execution.code}:${execution.stderr.toString("utf8").slice(0, 16_384)}`,
      );
    }
    let replay;
    try {
      replay = JSON.parse(execution.stdout.toString("utf8"));
    } catch {
      throw new Error("isolated_replay_receipt_invalid");
    }
    if (replay?.format !== "agent-repository-repair-process-transcript-replay/v1" ||
        replay.result !== "passed" || replay.reductionCount !== 96 ||
        replay.residualBoundaryCount !== 17 || replay.freshWasmInstanceCount !== 97 ||
        replay.transferAfterBoundary !== 8 || replay.transferRecovered !== true) {
      throw new Error(`isolated_replay_receipt_incomplete:${JSON.stringify(replay)}`);
    }

    await assertExactRuntimeInventory(runtimeRoot);
    await assertGenericReplayClosure(runtimeRoot);
    return Object.freeze({
      ...replay,
      format: "agent-repository-repair-process-transcript-isolated-replay/v1",
      result: "passed",
      runtimeInventory: EXPECTED_INVENTORY,
      sourceSmugglingRejected: sourceNegatives.sourceSmugglingRejected,
      importSmugglingRejected: sourceNegatives.importSmugglingRejected,
      applicationWasmSmugglingRejected: sourceNegatives.applicationWasmSmugglingRejected,
      sandboxAgentSourceReadRejected: sandboxNegatives.agentSource,
      sandboxRepositoryFixtureReadRejected: sandboxNegatives.repositoryFixture,
      sandboxWorldSourceReadRejected: sandboxNegatives.worldSource,
      sandboxWorldCapabilitiesSourceReadRejected: sandboxNegatives.worldCapabilitiesSource,
      sandboxOutsideRuntimeReadRejected: sandboxNegatives.outsideRuntime,
      sandboxNetworkRejected: sandboxNegatives.network,
      sandboxGitRejected: sandboxNegatives.git,
      sandboxGitMetadataReadRejected: sandboxNegatives.gitMetadata,
      sandboxRuntimeInputWriteRejected: sandboxNegatives.runtimeInputWrite,
      sandboxPositiveControlPassed: sandboxNegatives.positiveControl,
      ...(process.platform === "linux"
        ? { sandboxHostProcRootReadRejected: sandboxNegatives.hostProcRoot }
        : {}),
    });
  } finally {
    await rm(cleanRoot, { recursive: true, force: true });
  }
}

async function validateInputs({ agentRoot, kernelPath, manifestPath, payloadPath }) {
  const values = { agentRoot, kernelPath, manifestPath, payloadPath };
  for (const [name, value] of Object.entries(values)) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`isolated_replay_${name}_required`);
    }
  }
  const resolved = Object.fromEntries(
    await Promise.all(Object.entries(values).map(async ([name, value]) => [name, await realpath(resolve(value))])),
  );
  for (const name of ["kernelPath", "manifestPath", "payloadPath"]) {
    if (!(await stat(resolved[name])).isFile()) throw new Error(`isolated_replay_${name}_not_file`);
  }
  if (!(await stat(resolved.agentRoot)).isDirectory()) {
    throw new Error("isolated_replay_agentRoot_not_directory");
  }
  for (const relativePath of ["src/root.zig", "fixtures/repository-repair-v1/src/range.mjs"]) {
    const sourcePath = join(resolved.agentRoot, relativePath);
    if (!existsSync(sourcePath) || !(await stat(sourcePath)).isFile()) {
      throw new Error(`isolated_replay_agent_source_sentinel_missing:${relativePath}`);
    }
  }
  return Object.freeze(resolved);
}

export async function assertExactRuntimeInventory(runtimeRoot) {
  const entries = await readdir(runtimeRoot, { withFileTypes: true });
  const nonFiles = entries.filter((entry) => !entry.isFile()).map((entry) => entry.name).sort();
  if (nonFiles.length !== 0) {
    throw new Error(`isolated_replay_inventory_non_file:${JSON.stringify(nonFiles)}`);
  }
  const observed = entries.map((entry) => entry.name).sort();
  if (JSON.stringify(observed) !== JSON.stringify(EXPECTED_INVENTORY)) {
    throw new Error(`isolated_replay_inventory_invalid:${JSON.stringify(observed)}`);
  }
  return Object.freeze(observed);
}

export async function assertGenericReplayClosure(runtimeRoot) {
  const sourceNames = new Set(SOURCE_FILES);
  for (const name of SOURCE_FILES) {
    const source = await readFile(join(runtimeRoot, name), "utf8");
    if (/\bimport\s*\(/u.test(source) || /\brequire\s*\(/u.test(source)) {
      throw new Error(`isolated_replay_dynamic_import_smuggling:${name}`);
    }
    for (const literal of FORBIDDEN_SOURCE_LITERALS) {
      if (source.includes(literal)) {
        throw new Error(`isolated_replay_source_smuggling:${name}:${literal}`);
      }
    }
    for (const specifier of staticImportSpecifiers(source)) {
      if (specifier.startsWith("node:")) {
        if (!ALLOWED_NODE_IMPORTS.has(specifier)) {
          throw new Error(`isolated_replay_builtin_smuggling:${name}:${specifier}`);
        }
        continue;
      }
      if (!specifier.startsWith("./") || specifier.includes("\\") || specifier.includes("..")) {
        throw new Error(`isolated_replay_import_smuggling:${name}:${specifier}`);
      }
      const dependency = specifier.slice(2);
      if (!sourceNames.has(dependency)) {
        throw new Error(`isolated_replay_import_smuggling:${name}:${specifier}`);
      }
    }
  }
}

function staticImportSpecifiers(source) {
  const values = [];
  const pattern = /(?:\bimport\s+(?:[^"']*?\s+from\s+)?|\bexport\s+[^"']*?\s+from\s+)["']([^"']+)["']/gu;
  for (const match of source.matchAll(pattern)) values.push(match[1]);
  return values;
}

async function proveSourceSmugglingRejected(cleanRoot, runtimeRoot) {
  const extraSourceRoot = join(cleanRoot, "negative-extra-source");
  await cp(runtimeRoot, extraSourceRoot, { recursive: true, errorOnExist: true, force: false });
  await writeFile(join(extraSourceRoot, "agent-source.zig"), "pub const smuggled = true;\n", { flag: "wx" });
  const sourceSmugglingRejected = await rejects(() => assertExactRuntimeInventory(extraSourceRoot));

  const importRoot = join(cleanRoot, "negative-import");
  await cp(runtimeRoot, importRoot, { recursive: true, errorOnExist: true, force: false });
  await appendFile(join(importRoot, "replay.mjs"), "\nimport '../../src/root.zig';\n");
  const importSmugglingRejected = await rejects(() => assertGenericReplayClosure(importRoot));

  const applicationRoot = join(cleanRoot, "negative-application-wasm");
  await cp(runtimeRoot, applicationRoot, { recursive: true, errorOnExist: true, force: false });
  await writeFile(join(applicationRoot, "repository-repair-application.wasm"), Buffer.from([0, 97, 115, 109]), {
    flag: "wx",
  });
  const applicationWasmSmugglingRejected = await rejects(
    () => assertExactRuntimeInventory(applicationRoot),
  );

  if (!sourceSmugglingRejected || !importSmugglingRejected || !applicationWasmSmugglingRejected) {
    throw new Error("isolated_replay_source_smuggling_negative_failed");
  }
  return Object.freeze({
    sourceSmugglingRejected,
    importSmugglingRejected,
    applicationWasmSmugglingRejected,
  });
}

async function createSandbox({ runtimeRoot }) {
  const environment = sanitizedEnvironment();
  const bunExecutable = await realpath(process.execPath);
  const bunCommand = Object.freeze([
    bunExecutable,
    "--no-install",
    "--no-env-file",
    "--no-addons",
    "--no-macros",
    "--config=/dev/null",
  ]);
  if (process.platform === "darwin") {
    if (!existsSync("/usr/bin/sandbox-exec")) {
      throw new Error("isolated_replay_requires_sandbox_exec");
    }
    const profile = await macSandboxProfile({ runtimeRoot, bunExecutable });
    return Object.freeze({
      bunCommand,
      run: (argv) => runChild("/usr/bin/sandbox-exec", ["-p", profile, ...argv], {
        cwd: runtimeRoot,
        env: environment,
      }),
    });
  }
  if (process.platform === "linux") {
    const prefix = await linuxBubblewrapPrefix({ runtimeRoot });
    return Object.freeze({
      bunCommand,
      run: (argv) => runChild(prefix[0], [...prefix.slice(1), ...argv], {
        cwd: runtimeRoot,
        env: environment,
      }),
    });
  }
  throw new Error(`isolated_replay_platform_unsupported:${process.platform}`);
}

async function macSandboxProfile({ runtimeRoot, bunExecutable }) {
  const candidates = [
    "/System/Library",
    "/usr/bin",
    "/usr/sbin",
    "/usr/lib",
    "/usr/share",
    "/bin",
    "/sbin",
    "/dev",
    "/private/etc",
    "/private/var/db/timezone",
    dirname(process.execPath),
    dirname(bunExecutable),
    runtimeRoot,
  ].filter(existsSync);
  const readable = [...new Set(await Promise.all(candidates.flatMap((path) => [
    Promise.resolve(resolve(path)),
    realpath(path),
  ])))];
  return `(version 1)
    (allow default)
    (deny network*)
    ${denyOutside("file-read*", readable)}
    (deny file-write*)
    (deny file-read* (literal "/usr/bin/git"))
    (deny process-fork)
    (deny process-exec (require-not (literal ${JSON.stringify(bunExecutable)})))`;
}

function denyOutside(operation, admittedPaths) {
  const paths = [...new Set(admittedPaths.map((path) => resolve(path)))];
  const ancestors = new Set(["/"]);
  for (const path of paths) {
    let current = dirname(path);
    while (current !== "/") {
      ancestors.add(current);
      current = dirname(current);
    }
  }
  const admitted = [
    ...paths.map((path) => `(subpath ${JSON.stringify(path)})`),
    ...[...ancestors].map((path) => `(literal ${JSON.stringify(path)})`),
  ];
  return `(deny ${operation} (require-all ${admitted.map((rule) => `(require-not ${rule})`).join(" ")}))`;
}

async function linuxBubblewrapPrefix({ runtimeRoot }) {
  const candidates = ["/usr/bin/bwrap", "/bin/bwrap"];
  const bubblewrap = candidates.find(existsSync);
  if (bubblewrap === undefined) throw new Error("isolated_replay_requires_bwrap");
  const executable = await realpath(bubblewrap);
  const metadata = await lstat(executable);
  if (!metadata.isFile() || metadata.uid !== 0 || (metadata.mode & 0o022) !== 0) {
    throw new Error(`isolated_replay_bwrap_untrusted:${executable}`);
  }

  const linkCandidates = ["/bin", "/sbin", "/lib", "/lib64"].filter(existsSync);
  const systemLinks = [];
  const systemDirectories = ["/usr", "/nix/store", "/run/current-system/sw"].filter(existsSync);
  for (const path of linkCandidates) {
    const entry = await lstat(path);
    if (entry.isSymbolicLink()) {
      systemLinks.push(Object.freeze({ destination: path, target: await readlink(path) }));
    } else if (entry.isDirectory()) {
      systemDirectories.push(path);
    }
  }
  const systemFiles = [
    "/etc/group",
    "/etc/ld.so.cache",
    "/etc/localtime",
    "/etc/nsswitch.conf",
    "/etc/passwd",
    "/etc/ssl/certs/ca-certificates.crt",
  ].filter(existsSync);
  const bunExecutable = await realpath(process.execPath);
  const extraExecutables = systemDirectories.some(
    (root) => bunExecutable === root || bunExecutable.startsWith(`${root}${sep}`),
  ) ? [] : [bunExecutable];
  const mountedDirectories = bubblewrapMountDirectories(
    [...systemDirectories, runtimeRoot],
    [...systemFiles, ...extraExecutables],
  );

  const prefix = [
    executable,
    "--die-with-parent",
    "--new-session",
    "--unshare-net",
    "--unshare-pid",
    "--clearenv",
    ...mountedDirectories.flatMap((path) => ["--dir", path]),
    ...systemDirectories.flatMap((path) => ["--ro-bind", path, path]),
    ...systemLinks.flatMap(({ target, destination }) => ["--symlink", target, destination]),
    ...systemFiles.flatMap((path) => ["--ro-bind", path, path]),
    ...extraExecutables.flatMap((path) => ["--ro-bind", path, path]),
    "--ro-bind", runtimeRoot, runtimeRoot,
    "--dev", "/dev",
    "--proc", "/proc",
    "--chdir", runtimeRoot,
    "--setenv", "PATH", "/nonexistent",
    "--setenv", "HOME", "/nonexistent",
    "--setenv", "TMPDIR", "/nonexistent",
  ];
  for (const gitPath of ["/usr/bin/git", "/bin/git"].filter(existsSync)) {
    prefix.push("--ro-bind", "/dev/null", gitPath);
  }
  return prefix;
}

function bubblewrapMountDirectories(directoryPaths, filePaths) {
  const directories = new Set();
  for (const seed of [...directoryPaths, ...filePaths.map(dirname)]) {
    let current = resolve(seed);
    while (current !== "/") {
      directories.add(current);
      current = dirname(current);
    }
  }
  return [...directories].sort(
    (left, right) => left.split("/").length - right.split("/").length || left.localeCompare(right),
  );
}

function sanitizedEnvironment() {
  const environment = {
    LANG: "C",
    LC_ALL: "C",
    HOME: "/nonexistent",
    TMPDIR: "/nonexistent",
    PATH: "/nonexistent",
    BUN_INSTALL_CACHE_DIR: "/nonexistent",
  };
  for (const name of ["DYLD_LIBRARY_PATH", "LD_LIBRARY_PATH", "NODE_PATH", "BUN_INSTALL"]) {
    if (process.env[name] !== undefined) environment[name] = "";
  }
  return environment;
}

async function proveSandboxBoundary({ sandbox, runtimeRoot, forbiddenRoot, roots }) {
  const siblingRoot = dirname(roots.agentRoot);
  const probes = {
    agentSource: [
      join(forbiddenRoot, "agent/src/root.zig"),
      join(roots.agentRoot, "src/root.zig"),
    ],
    repositoryFixture: [
      join(forbiddenRoot, "agent/fixtures/repository-repair-v1/src/range.mjs"),
      join(roots.agentRoot, "fixtures/repository-repair-v1/src/range.mjs"),
    ],
    worldSource: [
      join(forbiddenRoot, "world/src/world.zig"),
      ...(existsSync(join(siblingRoot, "world/src/world.zig"))
        ? [join(siblingRoot, "world/src/world.zig")]
        : []),
    ],
    worldCapabilitiesSource: [
      join(forbiddenRoot, "world-capabilities/src/v1/index.mjs"),
      ...(existsSync(join(siblingRoot, "world-capabilities/src/v1/index.mjs"))
        ? [join(siblingRoot, "world-capabilities/src/v1/index.mjs")]
        : []),
    ],
    outsideRuntime: [
      join(forbiddenRoot, "outside.txt"),
      fileURLToPath(import.meta.url),
    ],
    gitMetadata: [
      join(forbiddenRoot, "agent/.git"),
      join(roots.agentRoot, ".git"),
    ],
  };
  const results = {};
  for (const [name, paths] of Object.entries(probes)) {
    const readTargets = paths.flatMap((path) => [
      path,
      ...(macDataVolumeAlias(path) === null ? [] : [macDataVolumeAlias(path)]),
    ]);
    results[name] = (await Promise.all(readTargets.map((path) => sandboxReadRejected(sandbox, path))))
      .every(Boolean);
  }

  if (process.platform === "linux") {
    const hostProcPath = `/proc/${process.pid}/root${resolve(join(forbiddenRoot, "outside.txt"))}`;
    results.hostProcRoot = await sandboxReadRejected(sandbox, hostProcPath);
  }

  const positivePath = join(runtimeRoot, DATA_FILES[1]);
  const positive = await sandbox.run([
    ...sandbox.bunCommand,
    "--eval",
    `import { readFile } from "node:fs/promises"; await readFile(${JSON.stringify(positivePath)});`,
  ]);
  results.positiveControl = positive.code === 0;
  results.network = await sandboxNetworkRejected(sandbox);

  const immutableInput = join(runtimeRoot, DATA_FILES[1]);
  const immutableBefore = await runtimeInventoryIdentity(runtimeRoot);
  const writeProbe = await sandbox.run([
    ...sandbox.bunCommand,
    "--eval",
    `import { chmod, writeFile } from "node:fs/promises";
     try { await chmod(${JSON.stringify(immutableInput)}, 0o600);
       await writeFile(${JSON.stringify(immutableInput)}, "mutated\\n"); process.exit(41); }
     catch { process.exit(23); }`,
  ]);
  const immutableAfter = await runtimeInventoryIdentity(runtimeRoot);
  results.runtimeInputWrite = writeProbe.code === 23 &&
    JSON.stringify(immutableBefore) === JSON.stringify(immutableAfter);

  const gitProbe = await sandbox.run([
    ...sandbox.bunCommand,
    "--eval",
    `import { spawnSync } from "node:child_process";
     const viaPath = spawnSync("git", ["--version"]);
     const direct = spawnSync("/usr/bin/git", ["--version"]);
     if (!viaPath.error && viaPath.status === 0) process.exit(41);
     if (!direct.error && direct.status === 0) process.exit(42);`,
  ]);
  results.git = gitProbe.code === 0;

  if (Object.values(results).some((value) => value !== true)) {
    throw new Error(`isolated_replay_sandbox_negative_failed:${JSON.stringify(results)}`);
  }
  return Object.freeze(results);
}

function macDataVolumeAlias(path) {
  if (process.platform !== "darwin") return null;
  const absolute = resolve(path);
  if (absolute === "/Users" || absolute.startsWith("/Users/") ||
      absolute === "/private" || absolute.startsWith("/private/")) {
    return `/System/Volumes/Data${absolute}`;
  }
  return null;
}

async function sandboxReadRejected(sandbox, path) {
  const result = await sandbox.run([
    ...sandbox.bunCommand,
    "--eval",
    `import { readFile } from "node:fs/promises";
     try { await readFile(${JSON.stringify(path)}); process.exit(41); }
     catch { process.exit(23); }`,
  ]);
  return result.code === 23;
}

async function sandboxNetworkRejected(sandbox) {
  const server = createServer((socket) => {
    socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
  });
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("sandbox_network_address_invalid");
    const result = await sandbox.run([
      ...sandbox.bunCommand,
      "--eval",
      `try { await fetch("http://127.0.0.1:${address.port}"); process.exit(41); }
       catch { process.exit(23); }`,
    ]);
    return result.code === 23;
  } finally {
    await new Promise((accept, reject) => server.close((error) => error ? reject(error) : accept()));
  }
}

async function createForbiddenSourceCanaries(root) {
  const files = [
    ["agent/src/root.zig", "pub const forbidden_agent_source = true;\n"],
    ["agent/fixtures/repository-repair-v1/src/range.mjs", "export const forbiddenFixture = true;\n"],
    ["world/src/world.zig", "pub const forbidden_world_source = true;\n"],
    ["world-capabilities/src/v1/index.mjs", "export const forbiddenCapabilities = true;\n"],
    ["agent/.git", "gitdir: /forbidden/agent.git\n"],
    ["outside.txt", "forbidden outside runtime\n"],
  ];
  await Promise.all(files.map(async ([relativePath, contents]) => {
    const path = join(root, relativePath);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, contents, { flag: "wx", mode: 0o600 });
  }));
}

async function runtimeInventoryIdentity(root) {
  const identity = [];
  for (const name of EXPECTED_INVENTORY) {
    const bytes = await readFile(join(root, name));
    identity.push(Object.freeze({
      name,
      byteLength: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }));
  }
  return Object.freeze(identity);
}

async function runChild(command, args, { cwd, env }) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let outputLength = 0;
    let terminationError = null;
    let killTimer = null;
    const terminate = (error) => {
      if (terminationError !== null) return;
      terminationError = error;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), CHILD_TERMINATION_GRACE_MS);
    };
    const deadline = setTimeout(
      () => terminate(new Error("isolated_replay_child_deadline")),
      CHILD_DEADLINE_MS,
    );
    const collect = (target) => (chunk) => {
      outputLength += chunk.length;
      if (outputLength > MAX_CHILD_OUTPUT_BYTES) {
        terminate(new Error("isolated_replay_child_output_limit"));
        return;
      }
      target.push(Buffer.from(chunk));
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.once("error", (error) => {
      clearTimeout(deadline);
      if (killTimer !== null) clearTimeout(killTimer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(deadline);
      if (killTimer !== null) clearTimeout(killTimer);
      if (terminationError !== null) {
        reject(terminationError);
        return;
      }
      accept(Object.freeze({
        code,
        signal,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      }));
    });
  });
}

async function rejects(operation) {
  try {
    await operation();
    return false;
  } catch {
    return true;
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error("usage: isolated_replay.mjs --agent-root ROOT --kernel FILE --manifest FILE --payload FILE");
    }
    const key = {
      "--agent-root": "agentRoot",
      "--kernel": "kernelPath",
      "--manifest": "manifestPath",
      "--payload": "payloadPath",
    }[name];
    if (key === undefined || options[key] !== undefined) {
      throw new Error(`isolated_replay_argument_invalid:${name}`);
    }
    options[key] = value;
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const result = await runIsolatedReplay(parseArgs(argv));
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
