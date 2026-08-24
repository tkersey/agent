#!/usr/bin/env node
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { inspectTarGz } from "./reference_stack.mjs";

const releases = Object.freeze({
    boundary: Object.freeze({
        version: "1.6.0",
        root: "boundary-1e1886184540773d213cae28e743b16c24fd7ef2",
        url: "https://github.com/tkersey/boundary/archive/1e1886184540773d213cae28e743b16c24fd7ef2.tar.gz",
        sha256: "1a108d400dd4f821569238c2e1925d5d324d44504058dccfa3b6abe93de3e334",
    }),
    world: Object.freeze({
        version: "3.1.4",
        root: "world-5a64a70d39e9712b16aee3bb57c23409ece1abc3",
        url: "https://github.com/tkersey/world/archive/5a64a70d39e9712b16aee3bb57c23409ece1abc3.tar.gz",
        sha256: "6787c5580a487979cef79d10b1e7d8cda767593436f3d5bfd9eca6ae9c3fee9d",
    }),
});

const options = parseArgs(process.argv.slice(2));
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const proofRoot = mkdtempSync(join(tmpdir(), "agent-hermetic-"));
let passed = false;

try {
    const archives = join(proofRoot, "archives");
    mkdirSync(archives);
    const boundaryArchive = await acquire("boundary", options.boundaryArchive, options.offline, archives);
    const worldArchive = await acquire("world", options.worldArchive, options.offline, archives);
    const boundaryRoot = extractRelease("boundary", boundaryArchive, proofRoot);
    const worldRoot = extractRelease("world", worldArchive, proofRoot);
    installBoundaryModuleShim(boundaryRoot);
    const agentRoot = join(proofRoot, "agent");
    cpSync(sourceRoot, agentRoot, {
        recursive: true,
        filter: (path) => ![".git", ".ledger", "zig-cache", ".zig-cache", "zig-out", "zig-pkg"].includes(path.slice(path.lastIndexOf("/") + 1)),
    });
    replaceDependency(join(agentRoot, "build.zig.zon"), "boundary", '../boundary');
    replaceDependency(join(agentRoot, "build.zig.zon"), "world", '../world');
    replaceDependency(join(worldRoot, "build.zig.zon"), "boundary", '../boundary');

    const environment = {
        ...process.env,
        AGENT_BOUNDARY_ROOT: boundaryRoot,
        AGENT_WORLD_ROOT: worldRoot,
        HTTP_PROXY: "http://127.0.0.1:1",
        HTTPS_PROXY: "http://127.0.0.1:1",
        ALL_PROXY: "http://127.0.0.1:1",
        NO_PROXY: "",
    };
    for (const name of ["GH_TOKEN", "GITHUB_TOKEN", "OPENAI_API_KEY"]) delete environment[name];
    runNetworkIsolated(options.zig, [
        "build",
        "check-agent-semantic",
        "lint",
        "--cache-dir",
        join(proofRoot, "zig-cache"),
        "--global-cache-dir",
        join(proofRoot, "zig-global-cache"),
        "--summary",
        "all",
    ], agentRoot, environment);
    console.log("agent_hermetic_boundary_version=1.6.0");
    console.log(`agent_hermetic_boundary_sha256=${releases.boundary.sha256}`);
    console.log("agent_hermetic_world_version=3.1.4");
    console.log(`agent_hermetic_world_sha256=${releases.world.sha256}`);
    console.log("agent_hermetic_network_after_acquisition=false");
    console.log("agent_hermetic_check=pass");
    passed = true;
} finally {
    if (passed) rmSync(proofRoot, { recursive: true, force: true });
    else console.error(`agent_hermetic_proof_root=${proofRoot}`);
}

async function acquire(kind, override, offline, archiveRoot) {
    if (offline && override === null) throw new Error(`${kind} archive is required in offline mode`);
    const bytes = override === null ? await download(releases[kind].url) : readFileSync(resolve(override));
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== releases[kind].sha256) throw new Error(`${kind} archive checksum mismatch: expected=${releases[kind].sha256} actual=${actual}`);
    const path = join(archiveRoot, `${kind}-v${releases[kind].version}.tar.gz`);
    writeFileSync(path, bytes);
    return path;
}

async function download(url) {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) throw new Error(`public archive download failed: ${url} HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
}

function extractRelease(kind, archive, root) {
    const expectedRoot = releases[kind].root;
    inspectTarGz(archive, expectedRoot);
    const extracted = join(root, `${kind}-extracted`);
    mkdirSync(extracted);
    run("tar", ["-xzf", archive, "-C", extracted], root, process.env, false);
    const source = join(extracted, expectedRoot);
    const destination = join(root, kind);
    if (!existsSync(source)) throw new Error(`${kind} archive root is missing`);
    cpSync(source, destination, { recursive: true, errorOnExist: true });
    return destination;
}

function replaceDependency(path, name, replacementPath) {
    const source = readFileSync(path, "utf8");
    const pattern = new RegExp(`        \\.${name} = \\.\\{[\\s\\S]*?        \\},`);
    const updated = source.replace(pattern, `        .${name} = .{ .path = "${replacementPath}" },`);
    if (updated === source) throw new Error(`${path} has no replaceable ${name} dependency`);
    writeFileSync(path, updated);
}

function run(command, args, cwd, env, forward = true) {
    const result = spawnSync(command, args, { cwd, env, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
    if (forward && result.stdout) process.stdout.write(result.stdout);
    if (forward && result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}:\n${result.stderr ?? ""}`);
    return result;
}

function runNetworkIsolated(command, args, cwd, env) {
    if (process.platform !== "darwin" || !existsSync("/usr/bin/sandbox-exec")) {
        throw new Error("check-agent-hermetic requires an available OS network-isolation boundary");
    }
    return run(
        "/usr/bin/sandbox-exec",
        ["-p", "(version 1) (allow default) (deny network*)", command, ...args],
        cwd,
        env,
    );
}

function installBoundaryModuleShim(root) {
    const zonPath = join(root, "build.zig.zon");
    const zon = readFileSync(zonPath, "utf8");
    const updatedZon = zon.replace(/    \.dependencies = \.\{[\s\S]*?    \},\n    \.minimum_zig_version/, "    .dependencies = .{},\n    .minimum_zig_version");
    if (updatedZon === zon) throw new Error("Boundary package dependencies were not closed");
    writeFileSync(zonPath, updatedZon);
    writeFileSync(join(root, "build.zig"), boundaryModuleShim());
}

function boundaryModuleShim() {
    return `const std = @import("std");

const Core = struct {
    agent_profile: *std.Build.Module,
    control_ir: *std.Build.Module,
    driver: *std.Build.Module,
    effect_v2: *std.Build.Module,
    machine: *std.Build.Module,
    portable_value: *std.Build.Module,
    program_v2: *std.Build.Module,
};

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const control_ir = b.createModule(.{ .root_source_file = b.path("src/control_ir.zig"), .target = target, .optimize = optimize });
    const portable_value = b.createModule(.{ .root_source_file = b.path("src/portable_value.zig"), .target = target, .optimize = optimize });
    const machine = b.createModule(.{ .root_source_file = b.path("src/machine.zig"), .target = target, .optimize = optimize });
    machine.addImport("portable_value", portable_value);
    const rnf = b.createModule(.{ .root_source_file = b.path("src/rnf.zig"), .target = target, .optimize = optimize });
    rnf.addImport("control_ir", control_ir);
    const compiler = b.createModule(.{ .root_source_file = b.path("src/compiler.zig"), .target = target, .optimize = optimize });
    compiler.addImport("control_ir", control_ir);
    compiler.addImport("machine", machine);
    compiler.addImport("portable_value", portable_value);
    compiler.addImport("rnf", rnf);
    const program_v2 = b.createModule(.{ .root_source_file = b.path("src/program_v2.zig"), .target = target, .optimize = optimize });
    program_v2.addImport("compiler", compiler);
    program_v2.addImport("machine", machine);
    const driver = b.createModule(.{ .root_source_file = b.path("src/driver.zig"), .target = target, .optimize = optimize });
    const effect_v2 = b.createModule(.{ .root_source_file = b.path("src/effect_v2.zig"), .target = target, .optimize = optimize });
    const agent_profile = b.createModule(.{ .root_source_file = b.path("src/agent_profile.zig"), .target = target, .optimize = optimize });
    agent_profile.addImport("program_v2", program_v2);
    const boundary = b.addModule("boundary", .{ .root_source_file = b.path("src/root.zig"), .target = target, .optimize = optimize });
    boundary.addImport("agent_profile", agent_profile);
    boundary.addImport("control_ir", control_ir);
    boundary.addImport("driver", driver);
    boundary.addImport("effect_v2", effect_v2);
    boundary.addImport("machine", machine);
    boundary.addImport("portable_value", portable_value);
    boundary.addImport("program_v2", program_v2);
}
`;
}

function parseArgs(argv) {
    const result = { zig: null, offline: false, boundaryArchive: null, worldArchive: null };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === "--offline") result.offline = true;
        else if (["--zig", "--boundary-archive", "--world-archive"].includes(argument)) {
            if (index + 1 >= argv.length) throw new Error(`${argument} requires a value`);
            result[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = resolve(argv[index += 1]);
        } else throw new Error(`unknown argument: ${argument}`);
    }
    if (!result.zig) throw new Error("--zig is required");
    return result;
}
