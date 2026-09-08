import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync,
  symlinkSync, existsSync, readdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { DEFAULT_LOCK, inventory, gitTree, sha256 } from "../../tools/agent4/dependencies.mjs";
import { setupPaths, authenticateArchive, extractArchive, setup } from "../../tools/agent4/setup.mjs";

function temporary(context) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "agent4-setup-")));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "build.zig.zon"), ".{ .name = .agent, }\n");
  return root;
}

function archive(entries) {
  const chunks = [];
  for (const { name, value = "", type = "0" } of entries) {
    const header = Buffer.alloc(512), content = Buffer.from(value);
    const octal = (offset, size, value) => header.write(value.toString(8).padStart(size - 1, "0") + "\0", offset, size);
    header.write(name); octal(100, 8, type === "5" ? 0o755 : 0o644);
    octal(108, 8, 0); octal(116, 8, 0); octal(124, 12, content.length); octal(136, 12, 0);
    header.fill(32, 148, 156); header.write(type, 156); header.write("ustar\0", 257); header.write("00", 263);
    octal(148, 8, header.reduce((sum, byte) => sum + byte, 0));
    chunks.push(header, content, Buffer.alloc((512 - content.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}

test("wrong locked digest rejects before decompression or output creation", context => {
  const root = temporary(context), bytes = Buffer.from("not even gzip");
  const expected = { bytes: bytes.length, sha256: "0".repeat(64) };
  assert.throws(() => authenticateArchive(bytes, expected), /digest mismatch/);
  assert.throws(() => extractArchive(bytes, expected, "source", join(root, "result"), join(root, "tmp")), /digest mismatch/);
  assert.deepEqual(readdirSync(root), ["build.zig.zon"]);
});

test("authenticated extraction admits regular source bytes and rejects unsafe paths and links", context => {
  const root = temporary(context), bytes = archive([
    { name: "source/", type: "5" }, { name: "source/a.zig", value: "source bytes\n" },
  ]);
  const destination = join(root, "valid");
  extractArchive(bytes, { bytes: bytes.length, sha256: sha256(bytes) }, "source", destination, join(root, "tmp"));
  assert.equal(readFileSync(join(destination, "a.zig"), "utf8"), "source bytes\n");
  for (const [index, entry] of [
    { name: "source/../escape", value: "escape" },
    { name: "other/file", value: "outside root" },
    { name: "source/link", type: "2" },
    { name: "source/fifo", type: "6" },
  ].entries()) {
    const hostile = archive([entry]), target = join(root, `rejected-${index}`);
    assert.throws(() => extractArchive(hostile, { bytes: hostile.length, sha256: sha256(hostile) },
      "source", target, join(root, "tmp")));
    assert.equal(existsSync(target), false);
  }
  assert.equal(existsSync(join(root, "escape")), false);
});

test("setup permits only owned isolated directories and rejects symlink routes", context => {
  const agentRoot = temporary(context), workDir = join(agentRoot, ".agent4-test");
  assert.equal(setupPaths({ agentRoot, workDir }).workDir, workDir);
  assert.throws(() => setupPaths({ agentRoot, workDir: join(agentRoot, "ordinary") }), /work-dir/);
  assert.throws(() => setupPaths({ agentRoot, workDir: join(workDir, "inputs/world/cache") }), /work-dir/);
  symlinkSync(join(agentRoot, "missing"), workDir);
  assert.throws(() => setupPaths({ agentRoot, workDir }), /symlink/);
  writeFileSync(join(agentRoot, "build.zig.zon"), ".{ .name = .world, }\n");
  assert.throws(() => setupPaths({ agentRoot }), /not an Agent/);
});

function existingFixture(context) {
  const agentRoot = temporary(context), paths = setupPaths({ agentRoot });
  const lock = JSON.parse(readFileSync(DEFAULT_LOCK));
  mkdirSync(paths.input, { recursive: true });
  const archiveBytes = Buffer.from("authenticated existing source archive fixture");
  for (const name of ["boundary", "world"]) {
    const source = paths[`${name}Source`]; mkdirSync(source);
    writeFileSync(join(source, "source.zig"), `// ${name} fixture\n`);
    lock[name].source = inventory(source); lock[name].gitTree = gitTree(source);
    lock[name].archive.bytes = archiveBytes.length; lock[name].archive.sha256 = sha256(archiveBytes);
    writeFileSync(join(paths.input, `${name}-${lock[name].commit.slice(0, 7)}.tar.gz`), archiveBytes);
  }
  const boundaryPackage = join(paths.input, "boundary-package", lock.boundary.package.zigHash);
  mkdirSync(boundaryPackage, { recursive: true });
  writeFileSync(join(boundaryPackage, "source.zig"), "// package fixture\n");
  lock.boundary.package.profiles["zig-managed"] = inventory(boundaryPackage);
  lock.boundary.package.profiles["archive-extracted"] = inventory(boundaryPackage);
  mkdirSync(paths.worldRuntime, { recursive: true });
  writeFileSync(join(paths.worldRuntime, "index.mjs"), "export const fixture = true;\n");
  writeFileSync(join(paths.worldRuntime, "kernel.wasm"), "fixture kernel");
  Object.assign(lock.world.runtime, inventory(paths.worldRuntime), { entrypoint: "index.mjs",
    kernel: { path: "kernel.wasm", bytes: 14, sha256: sha256(Buffer.from("fixture kernel")) } });
  const lockPath = join(agentRoot, "lock.json"); writeFileSync(lockPath, JSON.stringify(lock));
  const zig = join(agentRoot, "fixture-zig");
  writeFileSync(zig, `#!/bin/sh\n[ "$1" = version ] || exit 71\nprintf '%s\\n' '${lock.toolchain.zig.version}'\n`);
  chmodSync(zig, 0o755);
  return { ...paths, agentRoot, lockPath, zig, lock, boundaryPackage };
}

test("verified existing tuple is reused offline without builds, fetches or source changes", async context => {
  const f = existingFixture(context), before = inventory(f.input);
  const options = { agentRoot: f.agentRoot, lockPath: f.lockPath, zig: f.zig, offline: true };
  const dry = await setup({ ...options, verifyOnly: true });
  const first = await setup(options), second = await setup(options);
  assert.deepEqual(first, dry); assert.deepEqual(second, first);
  assert.deepEqual(inventory(f.input), before);
  assert.equal(existsSync(f.cache), false);
  assert.equal(existsSync(f.temporary), false);
  assert.equal(existsSync(join(f.workDir, ".setup-lock")), false);
});

test("an existing corrupt archive is rejected without replacing retained inputs", async context => {
  const f = existingFixture(context);
  const path = join(f.input, `boundary-${f.lock.boundary.commit.slice(0, 7)}.tar.gz`);
  const bytes = readFileSync(path); bytes[0] ^= 1; writeFileSync(path, bytes);
  const before = inventory(f.input);
  await assert.rejects(setup({ agentRoot: f.agentRoot, lockPath: f.lockPath, zig: f.zig, offline: true }), /digest mismatch/);
  assert.deepEqual(inventory(f.input), before);
  assert.equal(existsSync(f.cache), false);
});

test("authoring-only setup verifies no World path", async context => {
  const f = existingFixture(context);
  rmSync(f.worldSource, { recursive: true }); rmSync(f.worldRuntime, { recursive: true });
  rmSync(join(f.input, `world-${f.lock.world.commit.slice(0, 7)}.tar.gz`));
  const result = await setup({ agentRoot: f.agentRoot, lockPath: f.lockPath, zig: f.zig,
    authoringOnly: true, offline: true, verifyOnly: true });
  assert.equal(result.worldRuntime, undefined);
  assert.equal(result.observations.world, undefined);
});

test("CLI and its aliases reject unknown and repeated setup options before acquisition", context => {
  const cli = fileURLToPath(new URL("../../tools/agent4/setup.mjs", import.meta.url));
  const alias = join(temporary(context), "setup-alias.mjs"); symlinkSync(cli, alias);
  for (const entry of [cli, alias])
    for (const args of [["--unknown"], ["--offline", "--offline"], ["--work-dir"]])
      assert.throws(() => execFileSync(process.execPath, [entry, ...args], { stdio: "pipe" }));
});
