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
        version: "1.6.1",
        root: "boundary-4788bc152d2b0213e9c5c4e6544df1231e4b034d",
        url: "https://github.com/tkersey/boundary/archive/4788bc152d2b0213e9c5c4e6544df1231e4b034d.tar.gz",
        sha256: "b4036e1eceb3c18a237cbf9d48ee023a39d5217665265e380a665296b9599948",
        buildGraph: Object.freeze({
            build: "42bc915e1ea22141bd1db6297885eb4849ed7b3781a39d4f1f5f826526df3d6c",
            manifest: "660271a04a0a35fd74e6dcfbb243e484e9c256bd351abeabe8c42e54f882ba88",
        }),
    }),
    world: Object.freeze({
        version: "3.1.4",
        root: "world-5d8fad6e76863312c19a5ba6988bf6307f29a783",
        url: "https://github.com/tkersey/world/archive/5d8fad6e76863312c19a5ba6988bf6307f29a783.tar.gz",
        sha256: "7af0a97d5751bda62fc745855785ce9407bc5d556fd9054a32fbd2b609298057",
        buildGraph: Object.freeze({
            build: "f0c015f313bdc4a04e80c269f57f25b87f2e04500d27688da7ba8e2414a3e90d",
            manifest: "e36f34a9787706ea6842d3360933da5c8df67d7db61b7b7adbd593fe51c99745",
        }),
    }),
});

const options = parseArgs(process.argv.slice(2));
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const proofRoot = mkdtempSync(join(tmpdir(), "agent-hermetic-"));
let passed = false;

try {
    const gitExecutable = "/usr/bin/git";
    const tarExecutable = "/usr/bin/tar";
    if (!existsSync(gitExecutable) || !existsSync(tarExecutable)) {
        throw new Error("trusted source-snapshot tools are unavailable");
    }
    const globalCacheRoot = join(proofRoot, "zig-global-cache");
    const hermeticHome = join(proofRoot, "home");
    mkdirSync(hermeticHome);
    const baseEnvironment = {
        HOME: hermeticHome,
        LANG: "C",
        LC_ALL: "C",
        LOGNAME: process.env.LOGNAME ?? "agent-hermetic",
        NO_COLOR: "1",
        PATH: closedVerifierPath(options.zig),
        SHELL: "/bin/sh",
        TERM: "dumb",
        TMPDIR: process.env.TMPDIR ?? tmpdir(),
        USER: process.env.USER ?? "agent-hermetic",
        XDG_CACHE_HOME: join(proofRoot, "xdg-cache"),
        ZIG_GLOBAL_CACHE_DIR: globalCacheRoot,
    };
    const archives = join(proofRoot, "archives");
    mkdirSync(archives);
    const boundaryArchive = await acquire("boundary", options.boundaryArchive, options.offline, archives);
    const worldArchive = await acquire("world", options.worldArchive, options.offline, archives);
    const boundaryRoot = extractRelease("boundary", boundaryArchive, proofRoot, tarExecutable, baseEnvironment);
    const worldRoot = extractRelease("world", worldArchive, proofRoot, tarExecutable, baseEnvironment);
    requireReleaseBuildGraph("boundary", boundaryRoot);
    requireReleaseBuildGraph("world", worldRoot);
    const acquisitionEnvironment = { ...baseEnvironment };
    for (const name of [
        "ALL_PROXY",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "SSL_CERT_DIR",
        "SSL_CERT_FILE",
    ]) {
        if (process.env[name] !== undefined) {
            acquisitionEnvironment[name] = process.env[name];
        }
    }
    prefetchDependencyTree(
        options.zig,
        boundaryRoot,
        join(proofRoot, "boundary-fetch-cache"),
        globalCacheRoot,
        acquisitionEnvironment,
    );
    requireReleaseBuildGraph("boundary", boundaryRoot);
    requireReleaseBuildGraph("world", worldRoot);
    const agentSource = materializeAgentSource(
        sourceRoot,
        proofRoot,
        gitExecutable,
        tarExecutable,
        baseEnvironment,
    );
    const agentRoot = agentSource.root;
    replaceDependency(join(agentRoot, "build.zig.zon"), "boundary", '../boundary');
    replaceDependency(join(agentRoot, "build.zig.zon"), "world", '../world');
    replaceDependency(join(worldRoot, "build.zig.zon"), "boundary", '../boundary');
    prefetchDependencyTree(
        options.zig,
        agentRoot,
        join(proofRoot, "agent-fetch-cache"),
        globalCacheRoot,
        acquisitionEnvironment,
    );

    const environment = {
        ...baseEnvironment,
        AGENT_HERMETIC: "1",
        AGENT_ZIG_EXE: options.zig,
        AGENT_BOUNDARY_ROOT: boundaryRoot,
        AGENT_WORLD_ROOT: worldRoot,
        HTTP_PROXY: "http://127.0.0.1:1",
        HTTPS_PROXY: "http://127.0.0.1:1",
        ALL_PROXY: "http://127.0.0.1:1",
        NO_PROXY: "",
    };
    requireNoAmbientZigOverrides(environment);
    runNetworkIsolated(options.zig, [
        "build",
        "check-agent-semantic",
        "lint",
        "--cache-dir",
        join(proofRoot, "zig-cache"),
        "--global-cache-dir",
        globalCacheRoot,
        "--summary",
        "all",
    ], agentRoot, environment);
    requireAgentSourceUnchanged(
        sourceRoot,
        agentSource.head,
        gitExecutable,
        baseEnvironment,
    );
    requireReleaseBuildGraph("boundary", boundaryRoot);
    if (existsSync(join(hermeticHome, ".cache", "zig"))) {
        throw new Error("hermetic proof escaped into the temporary HOME Zig cache");
    }
    console.log("agent_hermetic_boundary_version=1.6.1");
    console.log(`agent_hermetic_boundary_sha256=${releases.boundary.sha256}`);
    console.log("agent_hermetic_world_version=3.1.4");
    console.log(`agent_hermetic_world_sha256=${releases.world.sha256}`);
    console.log(`agent_hermetic_agent_commit=${agentSource.head}`);
    console.log(`agent_hermetic_agent_archive_sha256=${agentSource.sha256}`);
    console.log("agent_hermetic_agent_source_snapshot=true");
    console.log("agent_hermetic_boundary_build_graph_preserved=true");
    console.log(`agent_hermetic_archive_tool=${tarExecutable}`);
    console.log("agent_hermetic_release_build_graph_bound=true");
    console.log("agent_hermetic_ambient_zig_cache_absent=true");
    console.log("agent_hermetic_ambient_zig_overrides_absent=true");
    console.log("agent_hermetic_closed_verifier_path=true");
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

function sha256File(path) {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function requireReleaseBuildGraph(kind, root) {
    const expected = releases[kind].buildGraph;
    if (sha256File(join(root, "build.zig")) !== expected.build ||
        sha256File(join(root, "build.zig.zon")) !== expected.manifest) {
        throw new Error(`${kind} build graph does not match the authenticated release`);
    }
}

function closedVerifierPath(zig) {
    return [...new Set([
        dirname(zig),
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ])].join(":");
}

function materializeAgentSource(source, root, gitExecutable, tarExecutable, environment) {
    const head = bindAgentGitSource(source, gitExecutable, environment);
    const archive = join(root, "agent-source.tar.gz");
    run(gitExecutable, [
        "-C",
        source,
        "archive",
        "--format=tar.gz",
        "--prefix=agent-source/",
        `--output=${archive}`,
        head,
    ], source, environment, false);
    requireAgentSourceUnchanged(source, head, gitExecutable, environment);
    inspectTarGz(archive, "agent-source", { tarExecutable, environment });
    const extracted = join(root, "agent-extracted");
    mkdirSync(extracted);
    run(tarExecutable, ["-xzf", archive, "-C", extracted], root, environment, false);
    const snapshot = join(extracted, "agent-source");
    if (!existsSync(snapshot) || existsSync(join(snapshot, ".git"))) {
        throw new Error("authenticated Agent source snapshot is invalid");
    }
    return Object.freeze({
        head,
        root: snapshot,
        sha256: sha256File(archive),
    });
}

function bindAgentGitSource(source, gitExecutable, environment) {
    const head = run(
        gitExecutable,
        ["-C", source, "rev-parse", "HEAD"],
        source,
        environment,
        false,
    ).stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(head)) throw new Error("Agent Git head is invalid");
    requireAgentSourceUnchanged(source, head, gitExecutable, environment);
    return head;
}

function requireAgentSourceUnchanged(source, expectedHead, gitExecutable, environment) {
    const head = run(
        gitExecutable,
        ["-C", source, "rev-parse", "HEAD"],
        source,
        environment,
        false,
    ).stdout.trim();
    const status = run(
        gitExecutable,
        ["-C", source, "status", "--porcelain=v1", "--untracked-files=all"],
        source,
        environment,
        false,
    ).stdout.split("\n").filter(Boolean).filter((line) => {
        const encoded = line.slice(3);
        const path = encoded.includes(" -> ")
            ? encoded.split(" -> ").at(-1)
            : encoded;
        return !path.startsWith("zig-out/") && !path.startsWith("zig-pkg/");
    });
    if (head !== expectedHead || status.length !== 0) {
        throw new Error("Agent source changed during snapshot-bound proof");
    }
}

function extractRelease(kind, archive, root, tarExecutable, environment) {
    const expectedRoot = releases[kind].root;
    inspectTarGz(archive, expectedRoot, { tarExecutable, environment });
    const extracted = join(root, `${kind}-extracted`);
    mkdirSync(extracted);
    run(tarExecutable, ["-xzf", archive, "-C", extracted], root, environment, false);
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

function requireNoAmbientZigOverrides(environment) {
    const unexpected = Object.keys(environment).filter(
        (name) => name.startsWith("ZIG_") && name !== "ZIG_GLOBAL_CACHE_DIR",
    );
    if (unexpected.length !== 0) {
        throw new Error(`hermetic proof admitted Zig environment overrides: ${unexpected.join(",")}`);
    }
}

function prefetchDependencyTree(zig, root, cacheRoot, globalCacheRoot, environment) {
    run(zig, [
        "build",
        "--fetch",
        "--cache-dir",
        cacheRoot,
        "--global-cache-dir",
        globalCacheRoot,
    ], root, environment);
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
