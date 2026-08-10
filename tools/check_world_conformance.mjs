import { createHash } from "node:crypto";
import {
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    renameSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const versions = Object.freeze({
    agent: "1.1.1",
    boundary: "1.3.2",
    world: "3.1.1",
    host: "1.0.0",
    capabilities: "2.0.2",
});
const releases = Object.freeze({
    boundary: Object.freeze({
        url: "https://github.com/tkersey/boundary/archive/refs/tags/v1.3.2.tar.gz",
        sha256: "d33a682f92033fa287169e4bc42c5e96f891cf1fe307381efc6983361de3fe0d",
        packageHash: "boundary-1.3.2-flclaAI0EQBXh0WrWcNTh-CwL-m0RLPbRX8RBRxP9E95",
    }),
    world: Object.freeze({
        url: "https://github.com/tkersey/world/archive/refs/tags/v3.1.1.tar.gz",
        sha256: "ebde48f0bc037678e79051e3f8c3cde2fa1964df0b14ff53ed9cef94ccb1f63c",
        packageHash: "world-3.1.1-XXTUeKXGBgAZhWa2YvUU9Sj4GE-E53Km85AcgecObJV6",
    }),
    host: Object.freeze({
        assetApiPath: "repos/tkersey/world-host/releases/assets/490040522",
        sha256: "f881aaf3ada062ca3d80fc46d10cb001f38504d816ecd4995faf34bcd14ecc70",
    }),
    capabilities: Object.freeze({
        assetApiPath: "repos/tkersey/world-capabilities/releases/assets/507613227",
        sha256: "e1718f14ff6c2443b52a06e35650cf8530feb7863ef120950ee7c5c6f1c951a6",
    }),
});

const options = parseArgs(process.argv.slice(2));
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const proofRoot = mkdtempSync(join(tmpdir(), "agent-world-conformance-"));
let passed = false;

try {
    const archiveRoot = join(proofRoot, "archives");
    const stagingRoot = join(proofRoot, "staging");
    const materializedAgent = join(proofRoot, "agent");
    const materializedBoundary = join(proofRoot, "boundary");
    const materializedWorld = join(proofRoot, "world");
    const consumerRoot = join(proofRoot, "consumer");
    const outputRoot = join(proofRoot, "output");
    const runtimeRoot = join(proofRoot, "runtime");
    mkdirSync(archiveRoot, { recursive: true });
    mkdirSync(stagingRoot, { recursive: true });
    mkdirSync(runtimeRoot, { recursive: true });

    const [boundaryArchive, worldArchive, hostArchive, capabilitiesArchive] = await Promise.all([
        loadArchive("AGENT_BOUNDARY_ARCHIVE", releases.boundary.url),
        loadArchive("AGENT_WORLD_ARCHIVE", releases.world.url),
        loadArchive("AGENT_WORLD_HOST_ARCHIVE", null, releases.host.assetApiPath),
        loadArchive("AGENT_CAPABILITIES_ARCHIVE", null, releases.capabilities.assetApiPath),
    ]);
    verifySha256("Boundary v1.3.2", boundaryArchive, releases.boundary.sha256);
    verifySha256("World v3.1.1", worldArchive, releases.world.sha256);
    verifySha256("world-host v1.0.0", hostArchive, releases.host.sha256);
    verifySha256("world-capabilities v2.0.2 Effect v1", capabilitiesArchive, releases.capabilities.sha256);

    const boundaryArchivePath = join(archiveRoot, "boundary-v1.3.2.tar.gz");
    const worldArchivePath = join(archiveRoot, "world-v3.1.1.tar.gz");
    const hostArchivePath = join(archiveRoot, "world-host-v1.0.0.tar.gz");
    const capabilitiesArchivePath = join(archiveRoot, "world-capabilities-v2.0.2-effect-v1.tar.gz");
    writeFileSync(boundaryArchivePath, boundaryArchive);
    writeFileSync(worldArchivePath, worldArchive);
    writeFileSync(hostArchivePath, hostArchive);
    writeFileSync(capabilitiesArchivePath, capabilitiesArchive);

    assertPackageHash(options.zig, boundaryArchivePath, releases.boundary.packageHash);
    assertPackageHash(options.zig, worldArchivePath, releases.world.packageHash);

    const agentPackage = await materializeAgent(stagingRoot, archiveRoot);
    extractOneRoot(
        boundaryArchivePath,
        join(proofRoot, "boundary-extracted"),
        `boundary-${versions.boundary}`,
        materializedBoundary,
    );
    extractOneRoot(worldArchivePath, join(proofRoot, "world-extracted"), `world-${versions.world}`, materializedWorld);
    useMaterializedBoundary(join(materializedAgent, "build.zig.zon"));
    useMaterializedBoundary(join(materializedWorld, "build.zig.zon"));

    cpSync(join(materializedAgent, "test/world_consumer"), consumerRoot, { recursive: true });
    const consumerZon = join(consumerRoot, "build.zig.zon");
    const consumerText = readFileSync(consumerZon, "utf8").replace(
        /        \.world = \.\{[\s\S]*?        \},\n/,
        '        .world = .{ .path = "../world" },\n',
    );
    writeFileSync(consumerZon, consumerText);

    run(options.zig, [
        "build",
        "--cache-dir",
        join(proofRoot, "zig-cache"),
        "--global-cache-dir",
        join(proofRoot, "zig-global-cache"),
        "--prefix",
        outputRoot,
        "--summary",
        "all",
    ], consumerRoot);

    const hostExtracted = join(proofRoot, "host-extracted");
    const capabilitiesExtracted = join(proofRoot, "capabilities-extracted");
    extract(hostArchivePath, hostExtracted);
    extract(capabilitiesArchivePath, capabilitiesExtracted);
    const hostReleaseRoot = exactRoot(hostExtracted, `world-host-v${versions.host}`);
    const capabilitiesReleaseRoot = exactRoot(
        capabilitiesExtracted,
        `world-capabilities-v${versions.capabilities}`,
    );
    const runtimeHost = join(runtimeRoot, "host/src/v1");
    const runtimeCapabilities = join(runtimeRoot, "capabilities");
    mkdirSync(dirname(runtimeHost), { recursive: true });
    cpSync(join(hostReleaseRoot, "host/src/v1"), runtimeHost, { recursive: true });
    cpSync(capabilitiesReleaseRoot, runtimeCapabilities, { recursive: true });
    assertCapabilityPack(runtimeCapabilities);

    const wasmNames = Object.freeze({
        researchReact: "research-react.world.wasm",
        researchReflective: "research-reflective.world.wasm",
        codingReact: "coding-react.world.wasm",
        codingReflective: "coding-reflective.world.wasm",
        researchDirect: "research-direct.world.wasm",
    });
    const runtimeApplications = join(runtimeRoot, "applications");
    mkdirSync(runtimeApplications);
    const runtimeWasm = {};
    for (const [key, name] of Object.entries(wasmNames)) {
        const source = join(outputRoot, "world-apps", name);
        if (!existsSync(source) || statSync(source).size === 0) {
            throw new Error(`World build did not emit ${name}`);
        }
        const destination = join(runtimeApplications, name);
        cpSync(source, destination);
        runtimeWasm[key] = destination;
    }
    if (existsSync(join(runtimeRoot, "agent")) || existsSync(join(runtimeRoot, "world"))) {
        throw new Error("runtime directory contains a compiler source package");
    }
    const zigProbe = spawnSync("zig", ["version"], { env: { PATH: "" }, encoding: "utf8" });
    if (!zigProbe.error || zigProbe.error.code !== "ENOENT") {
        throw new Error("Zig unexpectedly resolves from the runtime PATH");
    }

    const runtimeConfig = {
        hostIndex: join(runtimeHost, "index.mjs"),
        wasm: runtimeWasm,
        runtimeSourceCheckoutsPresent: false,
        zigAvailableAtRuntime: false,
    };
    const lifecycle = spawnSync(
        process.execPath,
        [join(materializedAgent, "test/world_consumer/run_lifecycle.mjs")],
        {
            cwd: runtimeRoot,
            encoding: "utf8",
            env: {
                PATH: "",
                AGENT_WORLD_RUNTIME_CONFIG: JSON.stringify(runtimeConfig),
            },
            maxBuffer: 64 * 1024 * 1024,
        },
    );
    if (lifecycle.status !== 0) {
        throw new Error(`Agent World lifecycle failed:\n${lifecycle.stdout ?? ""}\n${lifecycle.stderr ?? ""}`);
    }
    const receipt = JSON.parse(lifecycle.stdout.trim());
    assertLifecycle(receipt);

    console.log(`agent_package_version=${versions.agent}`);
    console.log(`agent_archive_kind=${agentPackage.kind}`);
    console.log(`agent_archive_sha256=${agentPackage.sha256}`);
    console.log(`agent_package_hash=${agentPackage.packageHash}`);
    console.log(`boundary_package_version=${versions.boundary}`);
    console.log(`boundary_archive_sha256=${releases.boundary.sha256}`);
    console.log(`boundary_package_hash=${releases.boundary.packageHash}`);
    console.log("boundary_machine_abi=2");
    console.log(`world_package_version=${versions.world}`);
    console.log(`world_archive_sha256=${releases.world.sha256}`);
    console.log(`world_package_hash=${releases.world.packageHash}`);
    console.log("world_application_abi=1");
    console.log("world_frame_version=1");
    console.log("effect_protocol_version=1");
    console.log(`world_host_version=${versions.host}`);
    console.log(`world_host_archive_sha256=${releases.host.sha256}`);
    console.log("world_host_runtime_changed=false");
    console.log(`world_capabilities_version=${versions.capabilities}`);
    console.log(`world_capabilities_archive_sha256=${releases.capabilities.sha256}`);
    console.log("capability_frame_authority=false");
    for (const [name, value] of Object.entries(receipt)) {
        console.log(`${camelToSnake(name)}=${value}`);
    }
    console.log("clean_room_agent_definition=true");
    console.log("clean_room_strategy_selection=true");
    console.log("agent_source_checkout_required=false");
    console.log("boundary_source_checkout_required=false");
    console.log("world_source_checkout_required=false");
    console.log("source_checkout_required=false");
    console.log("sibling_checkout_required=false");
    console.log("zig_required_at_runtime=false");
    console.log("check_agent_world_conformance=pass");
    passed = true;
} finally {
    if (passed) rmSync(proofRoot, { recursive: true, force: true });
    else console.error(`agent_world_conformance_proof_root=${proofRoot}`);
}

async function materializeAgent(stagingRoot, archiveRoot) {
    const releasedArchive = process.env.AGENT_V1_ARCHIVE;
    if (releasedArchive) {
        const expectedSha256 = process.env.AGENT_V1_ARCHIVE_SHA256;
        if (!expectedSha256) {
            throw new Error("AGENT_V1_ARCHIVE_SHA256 is required with AGENT_V1_ARCHIVE");
        }
        const bytes = await loadArchive("AGENT_V1_ARCHIVE", null);
        verifySha256(`Agent v${versions.agent}`, bytes, expectedSha256);
        const archivePath = join(archiveRoot, `agent-v${versions.agent}.tar.gz`);
        writeFileSync(archivePath, bytes);
        const packageHash = fetchPackageHash(options.zig, archivePath);
        const extractedRoot = join(dirname(stagingRoot), "agent-extracted");
        extract(archivePath, extractedRoot);
        renameSync(exactRoot(extractedRoot, `agent-${versions.agent}`), join(dirname(stagingRoot), "agent"));
        return { kind: "release", sha256: sha256(bytes), packageHash };
    }

    const stagedAgent = join(stagingRoot, "agent");
    mkdirSync(stagedAgent);
    const surfaces = declaredPackageSurfaces(readFileSync(join(sourceRoot, "build.zig.zon"), "utf8"));
    const files = packageFiles(surfaces);
    if (files.length === 0) throw new Error("Agent candidate package is empty");
    for (const relative of files) {
        const source = join(sourceRoot, relative);
        if (!existsSync(source) || !statSync(source).isFile()) continue;
        const destination = join(stagedAgent, relative);
        mkdirSync(dirname(destination), { recursive: true });
        cpSync(source, destination);
    }
    const archivePath = join(archiveRoot, "agent-candidate.tar.gz");
    run("tar", ["-czf", archivePath, "-C", stagingRoot, "agent"]);
    const bytes = readFileSync(archivePath);
    const packageHash = fetchPackageHash(options.zig, archivePath);
    const extractedRoot = join(dirname(stagingRoot), "agent-extracted");
    extract(archivePath, extractedRoot);
    const root = exactRoot(extractedRoot, "agent");
    renameSync(root, join(dirname(stagingRoot), "agent"));
    return { kind: "candidate", sha256: sha256(bytes), packageHash };
}

function extractOneRoot(archive, extractedRoot, expectedName, destination) {
    extract(archive, extractedRoot);
    renameSync(exactRoot(extractedRoot, expectedName), destination);
}

function extract(archive, destination) {
    mkdirSync(destination, { recursive: true });
    run("tar", ["-xzf", archive, "-C", destination]);
}

function exactRoot(root, expectedName) {
    const entries = readdirSync(root, { withFileTypes: true });
    if (entries.length !== 1 || !entries[0].isDirectory() || entries[0].name !== expectedName) {
        throw new Error(`unexpected archive root: expected=${expectedName} actual=${entries.map((entry) => entry.name).join(",")}`);
    }
    return join(root, expectedName);
}

function assertCapabilityPack(root) {
    for (const relative of [
        "packages/fixture-model/manifest.json",
        "packages/human-approval/manifest.json",
        "packages/local-memory-kv/manifest.json",
        "packages/sandbox-files/manifest.json",
        "src/v1/agent_invoke.mjs",
    ]) {
        if (!existsSync(join(root, relative))) {
            throw new Error(`Effect v1 capability release is missing ${relative}`);
        }
    }
}

function assertLifecycle(receipt) {
    const required = {
        applicationWasmImportCount: 0,
        applicationWasmMemoryBounded: true,
        boundaryPackageVersion: versions.boundary,
        boundaryMachineAbi: 2,
        worldPackageVersion: versions.world,
        worldApplicationAbi: 1,
        worldFrameVersion: 1,
        effectProtocolVersion: 1,
        maximumPendingEffectsPerFrame: 1,
        specializationMatrixMachineCount: 4,
        specializationMatrixWasmCount: 4,
        sameStrategyDifferentAgent: true,
        sameAgentDifferentStrategy: true,
        unusedStrategyCodePresent: false,
        unusedActionCodePresent: false,
        boundaryEquivalentApplicationWasm: true,
        freshInstanceResume: true,
        deterministicRetry: true,
        retryChildFrameByteIdentical: true,
        replayFreshEffectCount: 0,
        branching: true,
        migration: true,
        migrationReceiverPreflight: true,
        malformedDecisionsRejected: true,
        negativeCases: true,
        researchTerminalResult: 55,
        codingTerminalResult: 26,
    };
    for (const [name, expected] of Object.entries(required)) {
        if (receipt[name] !== expected) {
            throw new Error(`lifecycle receipt mismatch: ${name} expected=${expected} actual=${receipt[name]}`);
        }
    }
    if (!(receipt.applicationWasmSizeRatio <= 1.15)) {
        throw new Error(`generated application WASM ratio exceeds 1.15: ${receipt.applicationWasmSizeRatio}`);
    }
    if (!(receipt.stepRuntimeRatio <= 1.10)) {
        throw new Error(`generated step runtime ratio exceeds 1.10: ${receipt.stepRuntimeRatio}`);
    }
}

function declaredPackageSurfaces(zon) {
    const body = zon.match(/\.paths\s*=\s*\.\{([\s\S]*?)\n\s*\},\n\s*\.fingerprint/)?.[1];
    if (!body) throw new Error("cannot parse Agent package paths");
    return [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function packageFiles(surfaces) {
    if (!existsSync(join(sourceRoot, ".git"))) {
        return surfaces.flatMap((surface) => filesUnder(surface)).sort();
    }
    const result = run("git", [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        ...surfaces,
    ], sourceRoot, false);
    return result.stdout.split("\0").filter(Boolean).sort();
}

function filesUnder(relative) {
    const absolute = join(sourceRoot, relative);
    if (!existsSync(absolute)) return [];
    if (statSync(absolute).isFile()) return [relative];
    return readdirSync(absolute, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name))
        .flatMap((entry) => {
            const child = join(relative, entry.name);
            if (entry.isDirectory()) return filesUnder(child);
            return entry.isFile() ? [child] : [];
        });
}

function useMaterializedBoundary(path) {
    const source = readFileSync(path, "utf8");
    const replacement = '        .boundary = .{ .path = "../boundary" },';
    const updated = source.replace(
        /        \.boundary = \.\{\n[\s\S]*?        \},/,
        replacement,
    );
    if (updated === source) throw new Error(`${basename(path)} has no replaceable Boundary dependency`);
    writeFileSync(path, updated);
}

async function loadArchive(environmentName, defaultUrl, assetApiPath = null) {
    const override = process.env[environmentName];
    if (override) {
        if (/^https?:\/\//.test(override)) return download(override);
        return readFileSync(resolve(override));
    }
    if (defaultUrl !== null) return download(defaultUrl);
    const result = spawnSync(
        "gh",
        ["api", "-H", "Accept: application/octet-stream", assetApiPath],
        { encoding: null, maxBuffer: 64 * 1024 * 1024 },
    );
    if (result.status !== 0) {
        throw new Error(`release asset download failed: ${result.stderr?.toString("utf8") ?? ""}`);
    }
    return Buffer.from(result.stdout);
}

async function download(url) {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) throw new Error(`archive download failed: ${url} HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
}

function verifySha256(label, bytes, expected) {
    const actual = sha256(bytes);
    if (actual !== expected) throw new Error(`${label} archive SHA-256 mismatch: expected=${expected} actual=${actual}`);
}

function sha256(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}

function fetchPackageHash(zig, archive) {
    return run(zig, ["fetch", archive], undefined, false).stdout.trim();
}

function assertPackageHash(zig, archive, expected) {
    const actual = fetchPackageHash(zig, archive);
    if (actual !== expected) throw new Error(`Zig package hash mismatch: expected=${expected} actual=${actual}`);
}

function run(command, args, cwd = undefined, forward = true) {
    const result = spawnSync(command, args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 128 * 1024 * 1024,
    });
    if (forward && result.stdout) process.stdout.write(result.stdout);
    if (forward && result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}:\n${result.stderr ?? ""}`);
    }
    return result;
}

function camelToSnake(value) {
    return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function parseArgs(args) {
    if (args.length !== 2 || args[0] !== "--zig" || !args[1]) {
        throw new Error("usage: node tools/check_world_conformance.mjs --zig <absolute-zig>");
    }
    const zig = resolve(args[1]);
    if (!existsSync(zig)) throw new Error(`Zig executable does not exist: ${zig}`);
    return { zig };
}
