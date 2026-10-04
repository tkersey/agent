import { selectZig } from "../../tools/agent4/toolchain.mjs";
import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test, { after } from "node:test";
const toolchain = selectZig([]);
after(() => toolchain.assertUnchanged());
import { gitTree, inventory } from "../../tools/agent4/dependencies.mjs";

const root = resolve(import.meta.dirname, "../..");
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "agent4-source-consumer-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function copyPackage(destination) {
  mkdirSync(destination);
  // Mirror the actual package surface, including uncommitted local proof work.
  const manifest = readFileSync(join(root, "build.zig.zon"), "utf8");
  const paths = manifest.match(/\.paths\s*=\s*\.\{([\s\S]*?)\}/)[1];
  for (const [, path] of paths.matchAll(/"([^"]+)"/g)) {
    const target = join(destination, path);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(root, path), target, { recursive: true,
      filter: path => ![".git", ".agent4", ".zig-cache", "zig-cache", "zig-out", "zig-pkg"].includes(basename(path)) });
  }
}
function build(cwd, directory, extra = [], environment = {}) {
  const result = spawnSync(toolchain.executable, ["build", "-Doptimize=safe", ...extra,
    "--cache-dir", join(directory, "cache"),
    "--prefix", join(directory, "out")], { cwd, env: { ...toolchain.env, ZIG_GLOBAL_CACHE_DIR: join(directory, "global-cache"), ZIG_LOCAL_PKG_DIR: join(directory, "packages"), ...environment }, encoding: "utf8", stdio: "pipe", timeout: 600000,
    maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Object.assign(new Error(result.stderr.slice(-4000)), result);
  assert(!result.stderr.includes("skipping running files"), "nested tests must actually execute");
  return result;
}

test("all source-override module exports retain authentication in cached external builds", t => {
  const directory = fixture(t), agent = join(directory, "agent"), consumer = join(directory, "consumer");
  copyPackage(agent); mkdirSync(consumer);
  // A synthetic stand-in tests build dependency routing, not Boundary semantics.
  // No actual Boundary source or locked installation is modified.
  const source = join(directory, "synthetic-source");
  mkdirSync(join(source, "src/data"), { recursive: true });
  writeFileSync(join(source, "src/root.zig"),
    'pub const data = @import("boundary_data");\n' +
    'pub const program = struct { pub fn compileObserved() void {} };\n' +
    'pub const source = struct { pub const Compiled = struct { flow: void }; };\n');
  writeFileSync(join(source, "src/data/root.zig"), 'pub const program = struct {};\n');
  const lockPath = join(agent, "conformance/agent4/dependencies.lock.json");
  const lock = JSON.parse(readFileSync(lockPath));
  lock.boundary.source = inventory(source); lock.boundary.gitTree = gitTree(source);
  writeFileSync(lockPath, JSON.stringify(lock));
  writeFileSync(join(consumer, "build.zig.zon"), `.{
    .name = .agent_review_consumer, .version = "4.0.0-dev.0",
    .fingerprint = 0x0d924ec48f15f9eb,
    .dependencies = .{ .agent = .{ .path = "../agent" } },
    .paths = .{ "build.zig", "build.zig.zon", "main.zig" },
  }`);
  writeFileSync(join(consumer, "build.zig"), `const std = @import("std");
    pub fn build(b: *std.Build) void {
      const optimize = b.standardOptimizeOption(.{});
      const source = b.option([]const u8, "source", "source").?;
      const surface = b.option([]const u8, "surface", "surface").?;
      const agent = b.dependency("agent", .{ .optimize = optimize, .@"boundary-source" = source });
      const module = b.createModule(.{ .root_source_file = b.path("main.zig"),
        .target = b.graph.host, .optimize = optimize,
        .imports = &.{.{ .name = "selected", .module = agent.module(surface) }} });
      b.installArtifact(b.addExecutable(.{ .name = "consumer", .root_module = module }));
    }`);
  writeFileSync(join(consumer, "main.zig"), 'pub fn main() void { _ = @import("selected"); }\n');
  for (const surface of ["agent", "agent_contracts", "boundary", "boundary_data"]) {
    const options = [`-Dsource=${source}`, `-Dsurface=${surface}`];
    build(consumer, directory, options);
    if (surface === "agent") {
      const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
      // Warm graphs must inherit the current caller's tool selection, while
      // nested node:test runners must not inherit the enclosing runner context.
      for (const variant of ["first", "second"]) {
        const bin = join(directory, variant), marker = join(bin, "invoked");
        mkdirSync(bin);
        const node = join(bin, "node");
        writeFileSync(node, `#!/bin/sh\n[ "\${NODE_TEST_CONTEXT+x}" != x ] || exit 73\nprintf '%s\\n' selected >> ${quote(marker)}\nexec ${quote(process.execPath)} "$@"\n`);
        chmodSync(node, 0o755);
        build(consumer, directory, options, {
          PATH: `${bin}:${toolchain.env.PATH}`,
          NODE_TEST_CONTEXT: "child-v8",
        });
        assert.equal(readFileSync(marker, "utf8"), "selected\n");
      }
    }
    const marker = join(source, "unadmitted-file"); writeFileSync(marker, "not in the admitted inventory");
    try {
      assert.throws(() => build(consumer, directory, options),
        error => /Boundary source inventory/.test(error.stderr?.toString()), surface);
    } finally { rmSync(marker); }
    const rootFile = join(source, "src/root.zig");
    const original = readFileSync(rootFile), originalMode = statSync(rootFile).mode & 0o777;
    for (const mutation of ["contents", "rename", "delete", "executable-intent"]) {
      const renamed = join(source, "src/renamed-root.zig");
      if (mutation === "contents") writeFileSync(rootFile, Buffer.concat([original, Buffer.from("\n// changed after admission\n")]));
      else if (mutation === "rename") renameSync(rootFile, renamed);
      else if (mutation === "delete") rmSync(rootFile);
      else chmodSync(rootFile, originalMode ^ 0o100);
      try {
        assert.throws(() => build(consumer, directory, options),
          error => /Boundary source inventory/.test(error.stderr?.toString()), `${surface}: ${mutation}`);
      } finally {
        if (existsSync(renamed)) renameSync(renamed, rootFile);
        writeFileSync(rootFile, original);
        chmodSync(rootFile, originalMode);
      }
    }
    // The graph is still warm; a changed trusted expectation must be observed too.
    const originalLock = readFileSync(lockPath);
    const changed = JSON.parse(originalLock);
    changed.boundary.gitTree = "0".repeat(40);
    writeFileSync(lockPath, JSON.stringify(changed));
    try {
      assert.throws(() => build(consumer, directory, options),
        error => /Agent4DependencyMismatch: Boundary Git tree/.test(error.stderr?.toString()), `${surface}: lock`);
    } finally { writeFileSync(lockPath, originalLock); }
    build(consumer, directory, options);
  }
});

test("manifest-selected source package completes authoring checks outside Git", t => {
  const directory = fixture(t), source = join(directory, "agent");
  copyPackage(source);
  assert.notEqual(spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: source }).status, 0);
  assert(!existsSync(join(source, ".git")) && !existsSync(join(source, ".agent4")));
  build(source, directory, ["check-agent4"]);
  assert.equal(readFileSync(join(directory, "out/agent4/document/document.bpi3")).subarray(0, 8).toString(), "ABL_BPI3");
  assert(!existsSync(join(directory, "out/agent4-release")), "authoring must not perform release packaging");
});
