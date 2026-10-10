import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync,
  symlinkSync, existsSync, readdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { DEFAULT_LOCK, inventory, gitTree, sha256, readDependencyLock } from "../../tools/agent4/dependencies.mjs";
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
    { name: "source/hardlink", type: "1" },
    { name: "source/fifo", type: "6" },
  ].entries()) {
    const hostile = archive([entry]), target = join(root, `rejected-${index}`);
    assert.throws(() => extractArchive(hostile, { bytes: hostile.length, sha256: sha256(hostile) },
      "source", target, join(root, "tmp")));
    assert.equal(existsSync(target), false);
  }
  assert.equal(existsSync(join(root, "escape")), false);
});

test("duplicate archive members reject before publishing a dependency", context => {
  const root = temporary(context), bytes = archive([
    { name: "source/a.zig", value: "original" },
    { name: "source/a.zig", value: "replacement" },
  ]);
  const destination = join(root, "duplicate");
  assert.throws(() => extractArchive(bytes, { bytes: bytes.length, sha256: sha256(bytes) },
    "source", destination, join(root, "tmp")), /unsafe archive path/);
  assert.equal(existsSync(destination), false);
});

test("ambient tar options cannot omit authenticated source members", context => {
  const root = temporary(context), bytes = archive([{ name: "source/a.zig", value: "source bytes\n" }]);
  const destination = join(root, "extracted"), previous = process.env.TAR_OPTIONS;
  try {
    process.env.TAR_OPTIONS = "--exclude=*";
    extractArchive(bytes, { bytes: bytes.length, sha256: sha256(bytes) },
      "source", destination, join(root, "tmp"));
    assert.equal(readFileSync(join(destination, "a.zig"), "utf8"), "source bytes\n");
  } finally {
    if (previous === undefined) delete process.env.TAR_OPTIONS;
    else process.env.TAR_OPTIONS = previous;
  }
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

test("README alternate setup and downstream paths agree with admitted setup paths", context => {
  const agentRoot = temporary(context);
  const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
  const work = readme.match(/node tools\/agent4\/setup\.mjs --work-dir "([^"]+)"/);
  assert(work, "README must provide the alternate setup invocation");
  const paths = setupPaths({ agentRoot, workDir: work[1].replaceAll("$PWD", agentRoot) });
  for (const [flag, expected] of [["world-source", paths.worldSource], ["world-runtime", paths.worldRuntime]]) {
    const matches = [...readme.matchAll(new RegExp(`-D${flag}="([^"]+)"`, "g"))];
    assert(matches.some(match => match[1].replaceAll("$PWD", agentRoot) === expected),
      `${flag} must select the documented setup output`);
  }
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
  const zig = join(agentRoot, "fixture-zig"), library = join(agentRoot, "fixture-lib");
  mkdirSync(library); writeFileSync(join(library, "std.zig"), "// fixture library\n");
  const description = '.{\n    .lib_dir = ' + JSON.stringify(library) + ',\n}\n';
  const quote = text => "'" + text.replaceAll("'", "'\\''") + "'";
  writeFileSync(zig, '#!/bin/sh\ncase "$1" in\nversion) printf "%s\\n" ' + quote(lock.toolchain.zig.version) + ';;\nenv) printf "%s" ' + quote(description) + ';;\n*) exit 71;;\nesac\n');
  chmodSync(zig, 0o755);
  // These sequential fixtures own their compiler selection. The stub still
  // rejects compilation/fetch, proving offline reuse does neither.
  const selection = { AGENT_ZIG_EXE: zig, AGENT_ZIG_LIB: library, ZIG_LIB_DIR: library };
  const inherited = Object.fromEntries(Object.keys(selection).map(key => [key, process.env[key]]));
  Object.assign(process.env, selection);
  context.after(() => {
    for (const [key, value] of Object.entries(inherited)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
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

test("delivery lock rejects unbound source, endpoint and transport before acquisition", context => {
  const root = temporary(context), lockPath = join(root, "lock.json");
  for (const mutate of [
    lock => { delete lock.world.delivery; },
    lock => { lock.world.delivery.commit = "0".repeat(40); },
    lock => { if (lock.world.delivery.release) lock.world.delivery.release.descriptor.url = "https://example.com/unbound"; else lock.world.delivery.artifact.apiPath = "user"; },
    lock => { lock.world.delivery.archive.sha256 = "bad"; },
    lock => { (lock.world.delivery.release?.descriptor ?? lock.world.delivery.artifact).bytes = 129 * 1024 * 1024; },
  ]) {
    const lock = JSON.parse(readFileSync(DEFAULT_LOCK));
    mutate(lock); writeFileSync(lockPath, JSON.stringify(lock));
    assert.throws(() => readDependencyLock(lockPath), /invalid World delivery/);
  }
});

test("missing or corrupt offline bundle cannot trigger a kernel build", async context => {
  const f = existingFixture(context);
  rmSync(f.worldBundle, {recursive: true});
  const options = {agentRoot: f.agentRoot, lockPath: f.lockPath, zig: f.zig, offline: true};
  await assert.rejects(setup(options), /missing authenticated World bundle transport/);
  writeFileSync(join(f.input, "world-runtime-bundle.tar.gz"), "invalid transport");
  await assert.rejects(setup(options), /archive length mismatch/);
  assert.equal(existsSync(f.worldBundle), false);
});

for (const publicRelease of [false, true]) test(publicRelease ?
  "public release transport authenticates descriptor and archive without GitHub credentials" :
  "cached transport delegates acquisition to authenticated World source", async context => {
  const f = existingFixture(context);
  const expectedFiles = inventory(f.worldRuntime);
  const archivePath = join(f.input, "world-runtime-bundle.tar.gz");
  const bytes = Buffer.from("opaque World-owned transport fixture");
  if (!publicRelease) writeFileSync(archivePath, bytes);
  f.lock.world.delivery.archive = {...f.lock.world.delivery.archive, bytes: bytes.length, sha256: sha256(bytes)};
  const downloads = [];
  if (publicRelease) {
    f.lock.status = "released-integration";
    for (const name of ["boundary", "world"]) f.lock[name].version = f.lock[name].version.split("-")[0];
    const tag = `v${f.lock.world.version}`;
    const prefix = `https://github.com/tkersey/world/releases/download/${tag}/world-runtime-bundle`;
    const descriptor = Buffer.from(JSON.stringify({source: {commit: f.lock.world.commit},
      manifestSha256: f.lock.world.delivery.manifestSha256, archive: {bytes: bytes.length, sha256: sha256(bytes)}}));
    f.lock.world.delivery = {commit: f.lock.world.commit, manifestSha256: f.lock.world.delivery.manifestSha256,
      archive: {url: `${prefix}.tar.gz`, bytes: bytes.length, sha256: sha256(bytes)},
      release: {tag, descriptor: {url: `${prefix}.delivery.json`, bytes: descriptor.length, sha256: sha256(descriptor)}}};
    context.mock.method(globalThis, "fetch", async url => {
      downloads.push(url);
      assert([`${prefix}.delivery.json`, `${prefix}.tar.gz`].includes(url));
      const response = new Response(url.endsWith(".json") ? descriptor : bytes);
      Object.defineProperty(response, "url", {value: url});
      return response;
    });
  }
  mkdirSync(join(f.worldSource, "bin"));
  const args = ["runtime", "acquire", "--archive", archivePath,
    "--archive-sha256", sha256(bytes), "--manifest-sha256", f.lock.world.delivery.manifestSha256,
    "--output", f.worldBundle];
  // Only World understands these bytes. The fixture witnesses delegation and
  // the exact bindings, while real bundle format checks belong to World.
  writeFileSync(join(f.worldSource, "bin/world.mjs"), `
import assert from "node:assert/strict";
import {mkdirSync, writeFileSync} from "node:fs";
assert.deepEqual(process.argv.slice(2), ${JSON.stringify(args)});
mkdirSync(${JSON.stringify(f.worldRuntime)}, {recursive: true});
writeFileSync(${JSON.stringify(join(f.worldRuntime, "index.mjs"))}, "export const fixture = true;\\n");
writeFileSync(${JSON.stringify(join(f.worldRuntime, "kernel.wasm"))}, "fixture kernel");
`);
  f.lock.world.source = inventory(f.worldSource);
  f.lock.world.gitTree = gitTree(f.worldSource);
  writeFileSync(f.lockPath, JSON.stringify(f.lock));
  rmSync(f.worldBundle, {recursive: true});
  const result = await setup({agentRoot: f.agentRoot, lockPath: f.lockPath, zig: f.zig, offline: !publicRelease});
  assert.equal(result.worldRuntime, f.worldRuntime);
  assert.deepEqual(inventory(f.worldRuntime), expectedFiles);
  assert.equal(downloads.length, publicRelease ? 2 : 0);
  assert.deepEqual(readFileSync(archivePath), bytes);
  if (publicRelease) for (const mutate of [
    lock => { lock.world.delivery.release.tag = "v0.0.0"; },
    lock => { lock.world.delivery.archive.url = "https://example.com/unbound"; },
    lock => { lock.world.delivery.release.descriptor.url = "https://example.com/unbound"; },
    lock => { lock.world.delivery.release.descriptor.sha256 = "bad"; },
  ]) {
    const invalid = structuredClone(f.lock); mutate(invalid);
    writeFileSync(f.lockPath, JSON.stringify(invalid));
    assert.throws(() => readDependencyLock(f.lockPath), /invalid World delivery/);
  }
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

test("new packages use the authenticated source root and cannot reuse a polluted package cache", async context => {
  const f = existingFixture(context);
  const payload = readFileSync(join(f.boundaryPackage, "source.zig"));
  const bytes = archive([
    { name: `${f.lock.boundary.package.zigHash}/`, type: "5" },
    { name: `${f.lock.boundary.package.zigHash}/source.zig`, value: payload.toString() },
  ]);
  f.lock.boundary.package.archive = { bytes: bytes.length, sha256: sha256(bytes) };
  writeFileSync(f.lockPath, JSON.stringify(f.lock));
  const transport = join(f.agentRoot, "qualified-package.tar.gz"), observedCache = join(f.agentRoot, "used-cache.txt");
  writeFileSync(transport, bytes);
  const poison = join(f.packageCache, "p", `${f.lock.boundary.package.zigHash}.tar.gz`);
  mkdirSync(join(f.packageCache, "p"), {recursive:true}); writeFileSync(poison, "unrelated cached archive");
  rmSync(f.boundaryPackage, {recursive:true});
  const quote = text => "'" + text.replaceAll("'", "'\\''") + "'";
  const fetch = `fetch) [ "$2" = ${quote(f.boundarySource)} ] || exit 72; mkdir -p "$ZIG_GLOBAL_CACHE_DIR/p"; cp ${quote(transport)} "$ZIG_GLOBAL_CACHE_DIR/p/${f.lock.boundary.package.zigHash}.tar.gz"; printf '%s' "$ZIG_GLOBAL_CACHE_DIR" > ${quote(observedCache)}; printf '%s\\n' ${quote(f.lock.boundary.package.zigHash)};;\n`;
  writeFileSync(f.zig, readFileSync(f.zig, "utf8").replace("*) exit 71;;", fetch + "*) exit 71;;"));
  const result = await setup({agentRoot:f.agentRoot,lockPath:f.lockPath,zig:f.zig,authoringOnly:true,offline:true});
  assert.equal(result.boundaryPackage, f.boundaryPackage);
  assert(readFileSync(join(result.boundaryPackage, "source.zig")).equals(payload));
  assert.equal(readFileSync(poison, "utf8"), "unrelated cached archive");
  assert(!existsSync(readFileSync(observedCache, "utf8")), "run-owned acquisition cache must be cleaned");
});
