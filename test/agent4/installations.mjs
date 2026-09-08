import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { inventory, readDependencyLock, readRegular, sha256,
  withVerifiedDependencies } from "../../tools/agent4/dependencies.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MODULES = new Set(["std", "boundary", "boundary_data_v2", "agent_contracts"]);
const FORBIDDEN = /(?:^|\/)(?:system_compiler|strategy_v3|flow|runtime|world|kernel)(?:[._/]|$)/;

function authoringFiles(sourceRoot) {
  const files = new Map();
  const pending = ["src/agent4.zig", "src/contracts.zig", "build.zig", "build_agent4.zig"];
  while (pending.length) {
    const name = pending.pop();
    if (files.has(name)) continue;
    assert(!FORBIDDEN.test(name), `forbidden authoring dependency: ${name}`);
    const bytes = readRegular(join(sourceRoot, name));
    files.set(name, bytes);
    const text = bytes.toString("utf8");
    const imports = [...text.matchAll(/@import\("([^"\n]+)"\)/g)];
    assert.equal(imports.length, [...text.matchAll(/@import\(/g)].length, "nonliteral import needs installation accounting");
    for (const [, imported] of imports) {
      if (imported.endsWith(".zig")) {
        const absolute = resolve(sourceRoot, dirname(name), imported);
        const child = relative(sourceRoot, absolute);
        assert(!child.startsWith("../") && !child.startsWith("/"), "source import escapes package");
        pending.push(child);
      } else assert(MODULES.has(imported), `unclassified authoring module: ${imported}`);
    }
    assert(!/@embedFile\(/.test(text), "embedded authoring input needs explicit installation accounting");
  }
  for (const name of ["build.zig.zon", "LICENSE", "README.md"])
    files.set(name, readRegular(join(sourceRoot, name)));
  return files;
}

const BUILD = `const std = @import("std");
pub fn build(b: *std.Build) void {
    const optimize = b.standardOptimizeOption(.{});
    const dependency = b.dependency("agent", .{ .target = b.graph.host, .optimize = optimize });
    const root = b.createModule(.{
        .root_source_file = b.path("main.zig"),
        .target = b.graph.host,
        .optimize = optimize,
        .imports = &.{
            .{ .name = "agent", .module = dependency.module("agent") },
            .{ .name = "agent_contracts", .module = dependency.module("agent_contracts") },
            .{ .name = "boundary", .module = dependency.module("boundary") },
        },
    });
    const emitter = b.addExecutable(.{ .name = "installed-author", .root_module = root });
    const run = b.addRunArtifact(emitter);
    b.getInstallStep().dependOn(&b.addInstallFileWithDir(run.captureStdOut(.{}), .prefix, "application.bpi2").step);
}
`;

const MANIFEST = `.{
    .name = .agent_review_consumer,
    .version = "4.0.0-dev.0",
    .minimum_zig_version = "0.16.0",
    .fingerprint = 0x0d924ec48f15f9eb,
    .dependencies = .{ .agent = .{ .path = "../agent" } },
    .paths = .{ "build.zig", "build.zig.zon", "main.zig" },
}
`;

const MAIN = `const std = @import("std");
const agent = @import("agent");
const contracts = @import("agent_contracts");
const boundary = @import("boundary");
comptime {
    if (agent.contracts.Utf8 != contracts.Utf8)
        @compileError("Agent and its pure contracts must share nominal types");
}
const Application = struct {
    pub fn emit(c: agent.Context) !boundary.computation.Module {
        const integer = try contracts.schema(u32, c.builder);
        const effect = try c.external("consumer.installed.read.v1", integer, integer, .read);
        const entry = try c.builder.declare(&.{integer}, integer, &.{effect}, &.{});
        const input = try c.builder.reference(c.builder.parameter(entry, 0));
        try c.builder.define(entry, try c.builder.term(.{ .perform = .{ .effect = effect, .payload = input } }));
        return c.builder.module(entry, try c.schema(void));
    }
};
pub fn main(init: std.process.Init) !void {
    const System = agent.system(.{ .InitialArgs = u32, .Result = u32, .Failure = void, .application = Application });
    var compiled = try agent.compile(init.gpa, System);
    defer compiled.deinit();
    const buffer = try init.gpa.alloc(u8, try boundary.image_v2.encodedLength(compiled.program));
    defer init.gpa.free(buffer);
    const bytes = try compiled.encode(init.gpa, buffer);
    var decoded = try boundary.image_v2.decode(init.gpa, bytes);
    defer decoded.deinit();
    if (decoded.program.effects.len != 1 or
        !std.mem.eql(u8, decoded.program.effects[0].identity, "consumer.installed.read.v1"))
        return error.UnexpectedEffectContract;
    var scratch: [4096]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &scratch);
    try output.interface.writeAll(bytes);
    try output.interface.flush();
}
`;

/** A02: real external authoring using only the installed public Zig package surfaces. */
export async function authoringInstallation({ sourceRoot = ROOT, output } = {}) {
  const lock = readDependencyLock(join(sourceRoot, "conformance/agent4/dependencies.lock.json"));
  const area = join(sourceRoot, ".agent4/installation-tests"); mkdirSync(area, { recursive: true });
  const work = mkdtempSync(join(area, "authoring-"));
  const installed = join(work, "agent"), consumer = join(work, "consumer");
  const source = authoringFiles(sourceRoot);
  for (const [path, bytes] of source) {
    const destination = join(installed, path); mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes, { flag: "wx" });
  }
  const before = inventory(installed);
  for (const path of ["runtime", ".agent4", "zig-pkg", "src/system_compiler.zig"])
    assert(!existsSync(join(installed, path)), `forbidden installation input: ${path}`);
  mkdirSync(consumer);
  writeFileSync(join(consumer, "build.zig"), BUILD);
  writeFileSync(join(consumer, "build.zig.zon"), MANIFEST);
  writeFileSync(join(consumer, "main.zig"), MAIN);
  const args = ["build", "-Doptimize=ReleaseSafe", "--cache-dir", join(work, "cache/local"),
    "--global-cache-dir", join(work, "cache/global"), "--prefix", join(work, "out")];
  const options = { cwd: consumer, encoding: "utf8", timeout: 600000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, ZIG_GLOBAL_CACHE_DIR: join(work, "cache/global") } };
  execFileSync("zig", [args[0], "--fetch=all", ...args.slice(1)], options);
  const packageRoot = join(consumer, "zig-pkg", lock.boundary.package.zigHash);
  let packageEvidence;
  try {
    await withVerifiedDependencies({ boundaryPackage: packageRoot, authoringOnly: true,
      lockPath: join(sourceRoot, "conformance/agent4/dependencies.lock.json") }, observations => {
      packageEvidence = observations.boundary;
      execFileSync("zig", args, options);
    });
  } finally {
    assert.deepEqual(inventory(installed), before, "authoring installation changed while compiling");
    for (const [path, bytes] of source)
      assert(readRegular(join(sourceRoot, path)).equals(bytes), `source changed during A02: ${path}`);
  }
  const image = readRegular(join(work, "out/application.bpi2"));
  assert.equal(image.subarray(0, 8).toString(), "ABL_BPI2", "external author did not emit a Boundary 2 image");
  assert.equal(image.readUInt16LE(8), 2, "unexpected Boundary record version");
  assert.equal(image.readBigUInt64LE(12), BigInt(image.length - 20), "incomplete image record");
  const result = { acceptance: "A02", result: "passed", relation: "external public-module authoring without World",
    installedSource: { inventorySha256: before.inventorySha256, files: before.files },
    consumerSha256: sha256(Buffer.from(BUILD + MANIFEST + MAIN)), boundary: packageEvidence,
    image: { bytes: image.length, sha256: sha256(image) },
    moduleIdentity: "agent.contracts.Utf8 equals separately imported agent_contracts.Utf8",
    workDirectory: work, command: ["zig", ...args],
    limitations: ["This case emits BPI2; runtime execution is covered by separate integration cases."] };
  if (output) { mkdirSync(dirname(resolve(output)), { recursive: true }); writeFileSync(output, JSON.stringify(result, null, 2) + "\n"); }
  return result;
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    let output;
    if (args.length) {
      if (args.length !== 2 || args[0] !== "--output" || args[1].startsWith("--"))
        throw new Error("usage: installations.mjs [--output FILE]");
      output = args[1];
    }
    console.log(JSON.stringify(await authoringInstallation({ output }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
