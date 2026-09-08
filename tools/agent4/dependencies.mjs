import { createHash } from "node:crypto";
import { constants, lstatSync, openSync, closeSync, fstatSync, readSync,
  readdirSync, realpathSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const DEFAULT_LOCK = join(ROOT, "conformance/agent4/dependencies.lock.json");
const MAX_FILE_BYTES = 128 * 1024 * 1024;
const MAX_ENTRIES = 10000;
const MAX_DEPTH = 32;
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fail(message) { throw new Error(`Agent4DependencyMismatch: ${message}`); }
function same(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(label);
}
function safePath(value) {
  return typeof value === "string" && value.length > 0 && !value.includes("\\") &&
    !value.includes("\0") && !value.split("/").some(p => !p || p === "." || p === "..");
}

/** Bounded, no-follow reads also reject a file replaced or changed while reading. */
export function readRegular(path, limit = MAX_FILE_BYTES) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size > BigInt(limit)) fail(`invalid file: ${path}`);
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count === 0) fail(`short read: ${path}`);
      offset += count;
    }
    const after = fstatSync(fd, { bigint: true });
    const named = lstatSync(path, { bigint: true });
    for (const field of ["dev", "ino", "size", "mtimeNs", "ctimeNs"])
      if (before[field] !== after[field] || after[field] !== named[field])
        fail(`file changed while reading: ${path}`);
    if (bytes.length !== Number(before.size)) fail(`short read: ${path}`);
    return bytes;
  } finally { closeSync(fd); }
}

/** Complete stable inventory: bytes, relative names, entry types and modes, never timestamps. */
export function inventory(root) {
  if (!lstatSync(root).isDirectory()) fail(`not a directory: ${root}`);
  const rows = [];
  function visit(relative, depth) {
    if (depth > MAX_DEPTH) fail("inventory depth exceeded");
    const directory = join(root, relative);
    const before = lstatSync(directory, { bigint: true });
    const names = readdirSync(directory).sort();
    for (const name of names) {
      if (rows.length >= MAX_ENTRIES) fail("inventory entry limit exceeded");
      const path = relative ? `${relative}/${name}` : name;
      if (!safePath(path)) fail("unsafe inventory path");
      const absolute = join(root, path);
      const stat = lstatSync(absolute);
      const mode = stat.mode & 0o777;
      if (stat.isDirectory()) {
        rows.push({ path, kind: "directory", mode });
        visit(path, depth + 1);
      } else if (stat.isFile()) {
        const bytes = readRegular(absolute);
        rows.push({ path, kind: "file", mode, bytes: bytes.length, sha256: sha256(bytes) });
      } else fail(`unsupported dependency entry: ${path}`);
    }
    const after = lstatSync(directory, { bigint: true });
    for (const field of ["dev", "ino", "mode", "mtimeNs", "ctimeNs"])
      if (before[field] !== after[field]) fail(`directory changed while reading: ${relative}`);
  }
  visit("", 0);
  return { files: rows, inventorySha256: sha256(Buffer.from(JSON.stringify(rows))),
    entries: rows.length, bytes: rows.reduce((sum, row) => sum + (row.bytes ?? 0), 0) };
}

/** Recompute Git's actual tree object identity from an exported source tree. */
export function gitTree(root) {
  const hash = (type, bytes) => createHash("sha1")
    .update(`${type} ${bytes.length}\0`).update(bytes).digest();
  function tree(directory, depth) {
    if (depth > MAX_DEPTH) fail("source depth exceeded");
    const entries = readdirSync(directory).map(name => {
      const path = join(directory, name), stat = lstatSync(path);
      if (!stat.isDirectory() && !stat.isFile()) fail(`unsupported source entry: ${name}`);
      return { name, path, stat, key: Buffer.from(name + (stat.isDirectory() ? "/" : "")) };
    }).sort((a, b) => Buffer.compare(a.key, b.key));
    const bytes = entries.map(({ name, path, stat }) => {
      const isDir = stat.isDirectory();
      const mode = isDir ? "40000" : (stat.mode & 0o111) ? "100755" : "100644";
      const digest = isDir ? tree(path, depth + 1) : hash("blob", readRegular(path));
      return Buffer.concat([Buffer.from(`${mode} ${name}\0`), digest]);
    });
    return hash("tree", Buffer.concat(bytes));
  }
  inventory(root);
  return tree(root, 0).toString("hex");
}

export function readDependencyLock(lockPath = DEFAULT_LOCK) {
  const lock = JSON.parse(readRegular(lockPath, 1024 * 1024));
  if (lock.format !== "agent4-dependency-lock/v1" ||
      !["candidate-integration", "released-integration"].includes(lock.status))
    fail("unsupported lock format/status");
  for (const [name, repository] of [["boundary", "tkersey/boundary"], ["world", "tkersey/world"]]) {
    const item = lock[name];
    if (item?.repository !== repository || !/^[a-f0-9]{40}$/.test(item.commit ?? "") ||
        !/^[a-f0-9]{40}$/.test(item.gitTree ?? "") ||
        !/^[a-f0-9]{64}$/.test(item.source?.inventorySha256 ?? "") ||
        !/^[a-f0-9]{64}$/.test(item.archive?.sha256 ?? "")) fail(`invalid ${name} lock`);
    const expectedUrl = `https://github.com/${repository}/archive/${item.commit}.tar.gz`;
    if (item.archive.url !== expectedUrl) fail(`unbound ${name} archive URL`);
    if (lock.status === "released-integration" && !/^\d+\.\d+\.\d+$/.test(item.version))
      fail("development inputs cannot be labeled released");
  }
  const runtime = lock.world.runtime;
  const packageProfiles = lock.boundary.package?.profiles;
  if (lock.boundary.package?.defaultProfile !== "zig-managed") fail("invalid default package profile");
  for (const profile of ["zig-managed", "archive-extracted"]) {
    const selected = packageProfiles?.[profile];
    if (!/^[a-f0-9]{64}$/.test(selected?.inventorySha256 ?? "") ||
        !Number.isSafeInteger(selected.entries) || selected.entries < 0 ||
        !Number.isSafeInteger(selected.bytes) || selected.bytes < 0) fail("invalid package profile");
  }
  if (runtime?.abi !== 2 || !safePath(runtime.entrypoint) || !safePath(runtime.kernel?.path) ||
      !/^[a-f0-9]{64}$/.test(runtime.kernel?.sha256 ?? "") ||
      !/^[a-f0-9]{64}$/.test(runtime.inventorySha256 ?? "") || !Array.isArray(runtime.files))
    fail("invalid runtime lock");
  const seen = new Set();
  for (const row of runtime.files) {
    if (!safePath(row.path) || seen.has(row.path) ||
        !["file", "directory"].includes(row.kind) || !Number.isInteger(row.mode) ||
        row.mode < 0 || row.mode > 0o777 || (row.kind === "file" &&
        (!/^[a-f0-9]{64}$/.test(row.sha256 ?? "") || !Number.isSafeInteger(row.bytes) || row.bytes < 0)))
      fail("invalid runtime inventory");
    seen.add(row.path);
  }
  same(sha256(Buffer.from(JSON.stringify(runtime.files))), runtime.inventorySha256,
    "runtime inventory binding");
  return lock;
}

function verifyArchive(path, expected, label) {
  const bytes = readRegular(path);
  same({ bytes: bytes.length, sha256: sha256(bytes) },
    { bytes: expected.bytes, sha256: expected.sha256 }, `${label} archive identity`);
  return { bytes: bytes.length, sha256: sha256(bytes) };
}
function verifySource(path, expected, label) {
  const actual = inventory(path);
  same(actual.inventorySha256, expected.source.inventorySha256, `${label} source inventory`);
  same(gitTree(path), expected.gitTree, `${label} Git tree`);
  return { inventorySha256: actual.inventorySha256, gitTree: expected.gitTree };
}

export function verifyBoundary({ sourceRoot, packageRoot, packageProfile = "zig-managed",
  archivePath, lockPath = DEFAULT_LOCK } = {}) {
  const lock = readDependencyLock(lockPath), observed = {};
  if (!sourceRoot && !packageRoot) fail("Boundary source or package path required");
  if (sourceRoot) observed.source = verifySource(sourceRoot, lock.boundary, "Boundary");
  if (packageRoot) {
    const actual = inventory(packageRoot);
    if (!["zig-managed", "archive-extracted"].includes(packageProfile)) fail("unknown Boundary package profile");
    const expected = lock.boundary.package.profiles[packageProfile];
    same(actual.inventorySha256, expected.inventorySha256, "Boundary package inventory");
    observed.package = { profile: packageProfile, inventorySha256: actual.inventorySha256 };
  }
  if (archivePath) observed.archive = verifyArchive(archivePath, lock.boundary.archive, "Boundary");
  return observed;
}

/** Authenticate all executable module dependencies before dynamic import. No World import occurs here. */
export function verifyRuntime(runtimePath, { lockPath = DEFAULT_LOCK } = {}) {
  const lock = readDependencyLock(lockPath), expected = lock.world.runtime;
  const actual = inventory(runtimePath);
  same(actual.files, expected.files, "World runtime contents");
  same(actual.inventorySha256, expected.inventorySha256, "World runtime inventory");
  const kernel = readRegular(join(runtimePath, expected.kernel.path));
  same({ sha256: sha256(kernel), bytes: kernel.length },
    { sha256: expected.kernel.sha256, bytes: expected.kernel.bytes }, "World kernel identity");
  return { inventorySha256: actual.inventorySha256, kernelSha256: expected.kernel.sha256,
    entrypoint: join(realpathSync(runtimePath), expected.entrypoint),
    kernelPath: join(realpathSync(runtimePath), expected.kernel.path) };
}

export function snapshotDependencies({ boundarySource,
  boundaryArchive,
  boundaryPackage, boundaryPackageProfile = "zig-managed", worldSource = join(ROOT, ".agent4/inputs/world"),
  worldArchive = join(ROOT, ".agent4/inputs/world-699a314.tar.gz"),
  worldRuntime = join(ROOT, ".agent4/out/world-runtime"),
  authoringOnly = false, lockPath = DEFAULT_LOCK } = {}) {
  const lock = readDependencyLock(lockPath);
  const sourceRoot = boundarySource ?? (boundaryPackage ? undefined : join(ROOT, ".agent4/inputs/boundary"));
  const archivePath = boundaryArchive ?? (boundarySource || boundaryPackage ? undefined :
    join(ROOT, ".agent4/inputs/boundary-7a4d10e.tar.gz"));
  const result = { lockSha256: sha256(readRegular(lockPath)),
    boundary: verifyBoundary({ sourceRoot, packageRoot: boundaryPackage,
      packageProfile: boundaryPackageProfile, archivePath, lockPath }) };
  if (!authoringOnly) result.world = {
    source: verifySource(worldSource, lock.world, "World"),
    archive: verifyArchive(worldArchive, lock.world.archive, "World"),
    runtime: verifyRuntime(worldRuntime, { lockPath }),
  };
  return result;
}

export function assertDependenciesUnchanged(before, after) {
  same(after, before, "dependency inputs changed during aggregate");
}

/** Postflight runs even if the aggregate fails; neither failure is hidden by the other. */
export async function withVerifiedDependencies(options, work) {
  const before = snapshotDependencies(options);
  let result, failure;
  try { result = await work(before); } catch (error) { failure = error; }
  try { assertDependenciesUnchanged(before, snapshotDependencies(options)); }
  catch (error) { if (failure) throw new AggregateError([failure, error]); throw error; }
  if (failure) throw failure;
  return result;
}

function main(args) {
  if (args.shift() !== "verify") fail("usage: dependencies.mjs verify [options]");
  const flags = new Map([["--boundary-source", "boundarySource"], ["--boundary-package", "boundaryPackage"],
    ["--boundary-package-profile", "boundaryPackageProfile"],
    ["--boundary-archive", "boundaryArchive"], ["--world-source", "worldSource"],
    ["--world-archive", "worldArchive"], ["--world-runtime", "worldRuntime"], ["--lock", "lockPath"]]);
  const options = {}, seen = new Set();
  while (args.length) {
    const flag = args.shift();
    if (seen.has(flag)) fail(`duplicate option: ${flag}`);
    seen.add(flag);
    if (flag === "--authoring-only") { options.authoringOnly = true; continue; }
    const key = flags.get(flag), value = args.shift();
    if (!key || !value || value.startsWith("--")) fail(`invalid option: ${flag}`);
    options[key] = key === "boundaryPackageProfile" ? value : resolve(value);
  }
  if (options.authoringOnly && [...seen].some(flag => flag.startsWith("--world-")))
    fail("World options conflict with authoring-only");
  if (options.boundaryPackageProfile && !options.boundaryPackage)
    fail("package profile requires a Boundary package path");
  console.log(JSON.stringify(snapshotDependencies(options), null, 2));
}

if (import.meta.main) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
