import { existsSync, lstatSync, mkdirSync, mkdtempSync, chmodSync,
  writeFileSync, renameSync, rmSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { DEFAULT_LOCK, readDependencyLock, readRegular, sha256, inventory, gitTree,
  verifyBoundary, verifyRuntime, snapshotDependencies } from "./dependencies.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_LIST_BYTES = 4 * 1024 * 1024;
function fail(message) { throw new Error(`Agent4SetupRejected: ${message}`); }
function equal(actual, expected, label) { if (actual !== expected) fail(label); }

function command(executable, args, options = {}) {
  const env = { ...process.env, LC_ALL: "C", TZ: "UTC" };
  delete env.TAR_OPTIONS;
  return execFileSync(executable, args, { encoding: "utf8", maxBuffer: MAX_LIST_BYTES,
    timeout: 600000, ...options, env: { ...env, ...options.env } });
}

export function setupPaths({ agentRoot = ROOT, workDir = join(agentRoot, ".agent4") } = {}) {
  agentRoot = realpathSync(agentRoot);
  workDir = resolve(workDir);
  if (!existsSync(dirname(workDir)) || realpathSync(dirname(workDir)) !== agentRoot ||
      !/^\.agent4(?:-[a-zA-Z0-9_-]+)?$/.test(basename(workDir)))
    fail("work-dir must be a direct Agent checkout child named .agent4 or .agent4-NAME");
  workDir = join(agentRoot, basename(workDir));
  const manifest = readRegular(join(agentRoot, "build.zig.zon"), 1024 * 1024).toString();
  if (!/\.name\s*=\s*\.agent\s*,/.test(manifest)) fail("setup root is not an Agent source package");
  const input = join(workDir, "inputs"), out = join(workDir, "out"), cache = join(workDir, "cache");
  const paths = { agentRoot, workDir, input, out, cache, temporary: join(workDir, "setup-tmp"),
    boundarySource: join(input, "boundary"), worldSource: join(input, "world"),
    worldRuntime: join(out, "world-runtime"), worldBuild: join(out, "world"),
    packageCache: join(cache, "package"), buildCache: join(cache, "world-local"),
    buildGlobalCache: join(cache, "world-global") };
  for (const path of Object.values(paths)) assertNoSymlinks(path, agentRoot);
  return paths;
}

function assertNoSymlinks(path, stop) {
  for (let current = resolve(path); current !== stop; current = dirname(current)) {
    if (dirname(current) === current) fail("path escaped Agent root");
    try { if (lstatSync(current).isSymbolicLink()) fail(`symlink path: ${current}`); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

export function authenticateArchive(bytes, expected) {
  equal(bytes.length, expected.bytes, "archive length mismatch; no extraction performed");
  equal(sha256(bytes), expected.sha256, "archive digest mismatch; no extraction performed");
  return bytes;
}

/** Authenticate before decompressing or invoking tar. Extract only files/directories under one root. */
export function extractArchive(bytes, expected, archiveRoot, destination, temporaryRoot) {
  authenticateArchive(bytes, expected);
  if (existsSync(destination)) fail("refusing to replace an existing dependency directory");
  const tar = gunzipSync(bytes, { maxOutputLength: MAX_ARCHIVE_BYTES });
  const names = command("tar", ["-tf", "-"], { input: tar }).trimEnd().split("\n");
  if (names.length > 10000) fail("archive entry bound exceeded");
  const seen = new Set();
  for (const name of names) {
    const normalized = name.replace(/\/$/, "");
    if (!(normalized === archiveRoot || normalized.startsWith(`${archiveRoot}/`)) ||
        /[\x00-\x1f\x7f\\]/.test(normalized) || normalized.startsWith("/") ||
        normalized.split("/").some(p => !p || p === "." || p === "..") ||
        normalized.split("/").length > 33 || seen.has(normalized)) fail("unsafe archive path");
    seen.add(normalized);
  }
  const details = command("tar", ["-tvf", "-"], { input: tar }).trimEnd().split("\n");
  if (details.length !== names.length || details.some(line => !/^[d-]/.test(line)))
    fail("archive links or special files are forbidden");
  mkdirSync(temporaryRoot, { recursive: true });
  const staged = mkdtempSync(join(temporaryRoot, "extract-"));
  try {
    command("tar", ["-xf", "-", "--strip-components=1", "--no-same-owner", "-C", staged], { input: tar });
    for (const row of inventory(staged).files)
      chmodSync(join(staged, row.path), row.kind === "directory" || row.mode & 0o111 ? 0o755 : 0o644);
    mkdirSync(dirname(destination), { recursive: true });
    renameSync(staged, destination);
  } finally { rmSync(staged, { recursive: true, force: true }); }
}

async function archiveAt(path, expected, { offline, verifyOnly }) {
  if (existsSync(path)) return authenticateArchive(readRegular(path), expected);
  if (offline || verifyOnly) fail(`missing authenticated archive: ${path}`);
  const response = await fetch(expected.url, { redirect: "follow", signal: AbortSignal.timeout(120000) });
  if (!response.ok || new URL(response.url).protocol !== "https:") fail("archive download failed");
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > expected.bytes || length > MAX_ARCHIVE_BYTES) fail("archive download exceeds locked size");
    chunks.push(chunk);
  }
  const bytes = authenticateArchive(Buffer.concat(chunks, length), expected);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes, { flag: "wx", mode: 0o644 });
  return bytes;
}

function sourceAt(path, bytes, expected, paths, verifyOnly) {
  const verify = root => {
    equal(inventory(root).inventorySha256, expected.source.inventorySha256, "source inventory mismatch");
    equal(gitTree(root), expected.gitTree, "source Git tree mismatch");
  };
  if (!existsSync(path)) {
    if (verifyOnly) fail(`missing dependency source: ${path}`);
    const name = expected.repository.split("/")[1];
    mkdirSync(paths.temporary, { recursive: true });
    const staging = mkdtempSync(join(paths.temporary, "source-")), candidate = join(staging, "source");
    try {
      extractArchive(bytes, expected.archive, `${name}-${expected.commit}`, candidate, paths.temporary);
      verify(candidate);
      renameSync(candidate, path);
    } finally { rmSync(staging, { recursive: true, force: true }); }
  }
  verify(path);
}

function packageAt(paths, lock, boundaryArchive, { verifyOnly, lockPath, zig }) {
  const packageRoot = join(paths.input, "boundary-package", lock.boundary.package.zigHash);
  assertNoSymlinks(packageRoot, paths.agentRoot);
  if (!existsSync(packageRoot)) {
    if (verifyOnly) fail(`missing Boundary package: ${packageRoot}`);
    mkdirSync(paths.packageCache, { recursive: true });
    const hash = command(zig, ["fetch", "--global-cache-dir", paths.packageCache, boundaryArchive]).trim();
    equal(hash, lock.boundary.package.zigHash, "Zig package hash mismatch");
    const packageArchive = join(paths.packageCache, "p", `${hash}.tar.gz`);
    const bytes = readRegular(packageArchive);
    mkdirSync(paths.temporary, { recursive: true });
    const staging = mkdtempSync(join(paths.temporary, "package-")), candidate = join(staging, "package");
    try {
      extractArchive(bytes, lock.boundary.package.archive, hash, candidate, paths.temporary);
      verifyBoundary({ packageRoot: candidate, packageProfile: "archive-extracted", lockPath });
      mkdirSync(dirname(packageRoot), { recursive: true });
      renameSync(candidate, packageRoot);
    } finally { rmSync(staging, { recursive: true, force: true }); }
  }
  verifyBoundary({ packageRoot, packageProfile: "archive-extracted", lockPath });
  return packageRoot;
}

function assembleRuntime(paths, lock) {
  const staged = mkdtempSync(join(paths.temporary, "runtime-"));
  try {
    for (const row of lock.world.runtime.files) {
      const target = join(staged, row.path);
      if (row.kind === "directory") mkdirSync(target, { recursive: true });
      else {
        const source = row.path === lock.world.runtime.kernel.path ?
          join(paths.worldBuild, row.path) : join(paths.worldSource, row.path);
        const bytes = readRegular(source);
        equal(sha256(bytes), row.sha256, `runtime source mismatch: ${row.path}`);
        equal(bytes.length, row.bytes, `runtime source length mismatch: ${row.path}`);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, bytes, { flag: "wx", mode: row.mode });
      }
      chmodSync(target, row.mode);
    }
    equal(inventory(staged).inventorySha256, lock.world.runtime.inventorySha256, "runtime assembly mismatch");
    renameSync(staged, paths.worldRuntime);
  } finally { rmSync(staged, { recursive: true, force: true }); }
}

function runtimeAt(paths, lock, { verifyOnly, lockPath, zig, report }) {
  if (existsSync(paths.worldRuntime)) return verifyRuntime(paths.worldRuntime, { lockPath });
  if (verifyOnly) fail(`missing World runtime: ${paths.worldRuntime}`);
  mkdirSync(paths.out, { recursive: true });
  mkdirSync(paths.temporary, { recursive: true });
  const kernel = join(paths.worldBuild, lock.world.runtime.kernel.path);
  if (existsSync(kernel)) {
    equal(sha256(readRegular(kernel)), lock.world.runtime.kernel.sha256, "existing built kernel mismatch");
  } else {
    report("Building unchanged World kernel with its default physical profile");
    try {
      command(zig, ["build", "build-v2-kernel", "-Doptimize=ReleaseSafe",
        `-Dboundary-v2-source=${paths.boundarySource}`, "--cache-dir", paths.buildCache,
        "--global-cache-dir", paths.buildGlobalCache, "--prefix", paths.worldBuild], { cwd: paths.worldSource });
    } finally {
      equal(inventory(paths.boundarySource).inventorySha256, lock.boundary.source.inventorySha256,
        "Boundary source changed during build");
      equal(inventory(paths.worldSource).inventorySha256, lock.world.source.inventorySha256,
        "World source changed during build");
    }
  }
  assembleRuntime(paths, lock);
  return verifyRuntime(paths.worldRuntime, { lockPath });
}

export async function setup(options = {}) {
  const paths = setupPaths(options), lockPath = resolve(options.lockPath ?? DEFAULT_LOCK);
  const lock = readDependencyLock(lockPath), zig = options.zig ?? "zig";
  const report = options.report ?? (() => {});
  const selected = { ...options, lockPath, zig, report };
  equal(command(zig, ["version"]).trim(), lock.toolchain.zig.version, "Zig version mismatch");
  const boundaryArchive = join(paths.input, `boundary-${lock.boundary.commit.slice(0, 7)}.tar.gz`);
  const worldArchive = join(paths.input, `world-${lock.world.commit.slice(0, 7)}.tar.gz`);
  const perform = async () => {
    report("Authenticating locked Boundary source and package");
    const boundaryBytes = await archiveAt(boundaryArchive, lock.boundary.archive, selected);
    sourceAt(paths.boundarySource, boundaryBytes, lock.boundary, paths, options.verifyOnly);
    const boundaryPackage = packageAt(paths, lock, boundaryArchive, selected);
    if (!options.authoringOnly) {
      report("Authenticating locked World source and runtime");
      const worldBytes = await archiveAt(worldArchive, lock.world.archive, selected);
      sourceAt(paths.worldSource, worldBytes, lock.world, paths, options.verifyOnly);
      runtimeAt(paths, lock, selected);
    }
    const observations = snapshotDependencies({ ...paths, boundaryArchive, worldArchive,
      boundaryPackage, boundaryPackageProfile: "archive-extracted",
      authoringOnly: options.authoringOnly, lockPath });
    return { status: lock.status, workDir: paths.workDir, boundaryPackage,
      boundaryPackageProfile: "archive-extracted",
      boundarySource: paths.boundarySource,
      ...(options.authoringOnly ? {} : { worldRuntime: paths.worldRuntime }), observations };
  };
  if (options.verifyOnly) return perform();
  mkdirSync(paths.workDir, { recursive: true });
  const guard = join(paths.workDir, ".setup-lock");
  mkdirSync(guard);
  try { return await perform(); }
  finally { rmSync(guard, { recursive: true }); }
}

function parse(args) {
  const options = {}, seen = new Set();
  const values = new Map([["--work-dir", "workDir"], ["--lock", "lockPath"], ["--zig", "zig"]]);
  const toggles = new Map([["--offline", "offline"], ["--verify-only", "verifyOnly"],
    ["--authoring-only", "authoringOnly"]]);
  while (args.length) {
    const arg = args.shift();
    if (seen.has(arg)) fail(`duplicate option: ${arg}`);
    seen.add(arg);
    if (toggles.has(arg)) options[toggles.get(arg)] = true;
    else {
      const key = values.get(arg), value = args.shift();
      if (!key || !value || value.startsWith("--")) fail(`invalid option: ${arg}`);
      options[key] = value;
    }
  }
  return options;
}

if (import.meta.main) {
  try {
    const result = await setup({ ...parse(process.argv.slice(2)), report: message => console.error(message) });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
