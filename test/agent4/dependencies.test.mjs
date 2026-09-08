import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync,
  chmodSync, symlinkSync, renameSync, truncateSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { DEFAULT_LOCK, inventory, gitTree, readRegular, sha256, readDependencyLock,
  verifyRuntime, verifyBoundary, snapshotDependencies, assertDependenciesUnchanged,
  withVerifiedDependencies } from "../../tools/agent4/dependencies.mjs";

function fixture(context) {
  const root = mkdtempSync(join(tmpdir(), "agent4-dependencies-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const boundary = join(root, "boundary"), runtime = join(root, "runtime");
  mkdirSync(boundary); mkdirSync(runtime); mkdirSync(join(runtime, "src"));
  writeFileSync(join(boundary, "source.zig"), "// immutable source\n");
  writeFileSync(join(runtime, "src/index.mjs"), "export const version = 'fixture';\n");
  writeFileSync(join(runtime, "kernel.wasm"), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  const lock = JSON.parse(readFileSync(DEFAULT_LOCK));
  lock.boundary.source = inventory(boundary);
  lock.boundary.gitTree = gitTree(boundary);
  lock.boundary.package.profiles["zig-managed"] = inventory(boundary);
  lock.boundary.package.profiles["archive-extracted"] = inventory(boundary);
  lock.world.runtime = { ...lock.world.runtime, ...inventory(runtime), entrypoint: "src/index.mjs",
    kernel: { path: "kernel.wasm", bytes: 8, sha256: sha256(readFileSync(join(runtime, "kernel.wasm"))) } };
  const lockPath = join(root, "lock.json");
  const save = () => writeFileSync(lockPath, JSON.stringify(lock));
  save();
  return { root, boundary, runtime, lock, lockPath, save,
    options: { boundaryPackage: boundary, authoringOnly: true, lockPath } };
}

test("complete source and package inventories match independently pinned identities", context => {
  const f = fixture(context);
  assert.ok(verifyBoundary({ sourceRoot: f.boundary, packageRoot: f.boundary, lockPath: f.lockPath }));
  writeFileSync(join(f.boundary, "source.zig"), "// changed source\n");
  assert.throws(() => verifyBoundary({ sourceRoot: f.boundary, lockPath: f.lockPath }), /source inventory/);
  assert.throws(() => verifyBoundary({ packageRoot: f.boundary, lockPath: f.lockPath }), /package inventory/);
});

test("source-only authoring works without an archive or World installation", context => {
  const f = fixture(context);
  rmSync(f.runtime, { recursive: true });
  const scripts = join(realpathSync(f.root), "tools/agent4"), contracts = join(f.root, "conformance/agent4");
  mkdirSync(scripts, { recursive: true }); mkdirSync(contracts, { recursive: true });
  const cli = join(scripts, "dependencies.mjs");
  cpSync(new URL("../../tools/agent4/dependencies.mjs", import.meta.url), cli);
  cpSync(f.lockPath, join(contracts, "dependencies.lock.json"));
  const alias = join(f.root, "verify-alias.mjs"); symlinkSync(cli, alias);
  for (const entry of [cli, alias]) {
    const result = JSON.parse(execFileSync(process.execPath,
      [entry, "verify", "--authoring-only", "--boundary-source", f.boundary],
      { cwd: f.root, encoding: "utf8" }));
    assert.equal(result.boundary.source.gitTree, f.lock.boundary.gitTree);
    assert.equal(result.boundary.archive, undefined);
    assert.equal(result.world, undefined);
    assert.throws(() => execFileSync(process.execPath, [entry, "verify", "--unknown"],
      { cwd: f.root, stdio: "pipe" }), error => /invalid option/.test(error.stderr.toString()));
  }
  const archive = join(f.root, "wrong.tar.gz"); writeFileSync(archive, "wrong archive");
  assert.throws(() => snapshotDependencies({ boundarySource: f.boundary, boundaryArchive: archive,
    authoringOnly: true, lockPath: f.lockPath }), /archive identity/);
});

test("Git tree hashing agrees with independent Git object construction", context => {
  const root = mkdtempSync(join(tmpdir(), "agent4-tree-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repository"), source = join(root, "source");
  mkdirSync(repo); mkdirSync(source); mkdirSync(join(source, "folder"));
  writeFileSync(join(source, "folder/a"), "inside\n");
  writeFileSync(join(source, "folder.ext"), "outside\n");
  execFileSync("git", ["init", "--quiet", repo]);
  const git = (args, input) => execFileSync("git", ["-C", repo, ...args], { input, encoding: "utf8" }).trim();
  const inner = git(["hash-object", "-w", "--stdin"], "inside\n");
  const outer = git(["hash-object", "-w", "--stdin"], "outside\n");
  const subtree = git(["mktree"], `100644 blob ${inner}\ta\n`);
  const expected = git(["mktree"], `100644 blob ${outer}\tfolder.ext\n040000 tree ${subtree}\tfolder\n`);
  assert.equal(gitTree(source), expected);
});

test("package materialization profiles are explicit exact inventories, never mode normalization", context => {
  const f = fixture(context), extracted = join(f.root, "archive-extracted");
  cpSync(f.boundary, extracted, { recursive: true });
  chmodSync(join(extracted, "source.zig"), 0o600);
  f.lock.boundary.package.profiles["archive-extracted"] = inventory(extracted); f.save();
  assert.throws(() => verifyBoundary({ packageRoot: extracted, lockPath: f.lockPath }), /package inventory/);
  const result = verifyBoundary({ packageRoot: extracted, packageProfile: "archive-extracted", lockPath: f.lockPath });
  assert.equal(result.package.profile, "archive-extracted");
  assert.throws(() => verifyBoundary({ packageRoot: extracted, packageProfile: "anything", lockPath: f.lockPath }), /unknown.*profile/);
  chmodSync(join(extracted, "source.zig"), 0o755);
  for (const packageProfile of ["zig-managed", "archive-extracted"])
    assert.throws(() => verifyBoundary({ packageRoot: extracted, packageProfile, lockPath: f.lockPath }), /package inventory/);
});

test("runtime authentication rejects changed, missing, extra, mode and symlink entries", context => {
  const f = fixture(context);
  assert.equal(verifyRuntime(f.runtime, { lockPath: f.lockPath }).kernelSha256, f.lock.world.runtime.kernel.sha256);
  const mutations = [
    path => writeFileSync(join(path, "src/index.mjs"), "throw new Error('substitution');"),
    path => rmSync(join(path, "src/index.mjs")),
    path => writeFileSync(join(path, "extra"), ""),
    path => mkdirSync(join(path, "empty")),
    path => chmodSync(join(path, "src"), 0o700),
    path => chmodSync(join(path, "src/index.mjs"), 0o700),
    path => symlinkSync(join(path, "kernel.wasm"), join(path, "link")),
  ];
  for (const [index, mutate] of mutations.entries()) {
    const changed = join(f.root, `changed-${index}`);
    cpSync(f.runtime, changed, { recursive: true }); mutate(changed);
    assert.throws(() => verifyRuntime(changed, { lockPath: f.lockPath }), /DependencyMismatch/);
  }
});

test("bundled self-hash cannot authorize changed kernel bytes", context => {
  const f = fixture(context);
  writeFileSync(join(f.runtime, "kernel.wasm"), "substitute kernel");
  writeFileSync(join(f.runtime, "SHA256SUMS"), sha256(Buffer.from("substitute kernel")));
  assert.throws(() => verifyRuntime(f.runtime, { lockPath: f.lockPath }), /runtime contents/);
});

test("source tree, archive identity and malformed lock fields fail closed", context => {
  const f = fixture(context);
  const archivePath = join(f.root, "archive.tar.gz");
  writeFileSync(archivePath, "wrong archive");
  assert.throws(() => verifyBoundary({ sourceRoot: f.boundary, archivePath, lockPath: f.lockPath }), /archive identity/);
  f.lock.boundary.gitTree = "0".repeat(40); f.save();
  assert.throws(() => verifyBoundary({ sourceRoot: f.boundary, lockPath: f.lockPath }), /Git tree/);
  f.lock.boundary.archive.url = "https://example.invalid/latest.tar.gz"; f.save();
  assert.throws(() => readDependencyLock(f.lockPath), /archive URL/);
});

test("duplicate and traversing runtime paths reject before reading runtime", context => {
  const f = fixture(context);
  f.lock.world.runtime.files.push(f.lock.world.runtime.files[0]); f.save();
  assert.throws(() => readDependencyLock(f.lockPath), /runtime inventory/);
  f.lock.world.runtime.files.pop();
  f.lock.world.runtime.entrypoint = "../outside.mjs"; f.save();
  assert.throws(() => readDependencyLock(f.lockPath), /runtime lock/);
});

test("inventory framing binds paths, empty directories and permission modes", context => {
  const f = fixture(context);
  const before = inventory(f.boundary);
  renameSync(join(f.boundary, "source.zig"), join(f.boundary, "renamed.zig"));
  assert.notEqual(inventory(f.boundary).inventorySha256, before.inventorySha256);
  const moved = join(f.root, "copy"); cpSync(f.boundary, moved, { recursive: true });
  assert.equal(inventory(moved).inventorySha256, inventory(f.boundary).inventorySha256);
});

test("postflight runs after aggregate failure and retains both errors", async context => {
  const f = fixture(context);
  const before = snapshotDependencies(f.options);
  assertDependenciesUnchanged(before, snapshotDependencies(f.options));
  await assert.rejects(withVerifiedDependencies(f.options, async () => {
    writeFileSync(join(f.boundary, "source.zig"), "changed");
    throw new Error("aggregate failed");
  }), error => error instanceof AggregateError && error.errors.length === 2 &&
    /aggregate failed/.test(error.errors[0].message) && /package inventory/.test(error.errors[1].message));
});

test("bounded no-follow reads reject oversized inputs and symbolic links", context => {
  const f = fixture(context), path = join(f.root, "large");
  writeFileSync(path, ""); truncateSync(path, 4097);
  assert.throws(() => readRegular(path, 4096), /invalid file/);
  symlinkSync(path, join(f.root, "link"));
  assert.throws(() => readRegular(join(f.root, "link"), 8192));
});

test("CLI rejects unknown, duplicate and conflicting options before dependency I/O", () => {
  const cli = resolve("tools/agent4/dependencies.mjs");
  for (const args of [["--unknown", "value"], ["--authoring-only", "--authoring-only"],
    ["--authoring-only", "--world-runtime", "/missing"]])
    assert.throws(() => execFileSync(process.execPath, [cli, "verify", ...args], { stdio: "pipe" }));
});
