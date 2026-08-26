#!/usr/bin/env bun
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
    acquireReferenceStack,
    materializeReferenceArtifact,
    materializeWorldCapabilitiesArtifact,
    readReferenceStackLock,
} from "./reference_stack.mjs";

const options = parseArgs(process.argv.slice(2));
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = readReferenceStackLock(join(sourceRoot, "conformance/reference-stack-v1.lock.json"));
const proofRoot = mkdtempSync(join(tmpdir(), "agent-public-reference-stack-"));
let passed = false;

try {
    const acquired = await acquireReferenceStack(lock, {
        offline: options.offline,
        overrides: {
            worldHost: options.worldHostArchive,
            worldCapabilities: options.worldCapabilitiesArchive,
        },
    });
    const archives = join(proofRoot, "archives");
    const host = materializeReferenceArtifact("worldHost", acquired.worldHost, archives, join(proofRoot, "host-extracted"));
    const capabilities = materializeWorldCapabilitiesArtifact(
        acquired.worldCapabilities,
        archives,
        join(proofRoot, "capabilities-extracted"),
        {
            bunExecutable: process.execPath,
            environment: capabilitiesBuildEnvironment(proofRoot),
        },
    );
    const capabilitiesArchiveSha256 = acquired.worldCapabilities.entry.sha256;
    const runtimeRoot = join(proofRoot, "runtime");
    const runtimeHost = join(runtimeRoot, "world-host");
    const runtimeCapabilities = join(runtimeRoot, "world-capabilities");
    mkdirSync(runtimeHost, { recursive: true });
    mkdirSync(runtimeCapabilities, { recursive: true });
    copyRuntime(host.root, runtimeHost, ["LICENSE", "package.json", "bin", "src"]);
    copyRuntime(capabilities.root, runtimeCapabilities, ["LICENSE", "package.json", "packages", "src"]);
    assert.equal(existsSync(join(runtimeRoot, "agent")), false);
    assert.equal(existsSync(join(runtimeRoot, "boundary")), false);
    assert.equal(existsSync(join(runtimeRoot, "world")), false);

    const runtimeEnvironment = sanitizedEnvironment(proofRoot);
    const zigProbe = spawnSync("zig", ["version"], { env: runtimeEnvironment, encoding: "utf8" });
    assert(zigProbe.error?.code === "ENOENT", "Zig unexpectedly resolves from runtime PATH");

    run(process.execPath, [join(host.root, "conformance/check-runtime.mjs"), "--root", host.root], host.root, runtimeEnvironment);
    const capabilityChecksum = `${capabilitiesArchiveSha256}  ${basename(capabilities.archivePath)}\n`;
    const capabilitySidecar = `${capabilities.archivePath}.sha256`;
    writeFileSync(capabilitySidecar, capabilityChecksum);
    const conformanceBin = join(proofRoot, "conformance-bin");
    mkdirSync(conformanceBin);
    symlinkSync(process.execPath, join(conformanceBin, "bun"));
    run(process.execPath, [
        join(capabilities.root, "conformance/run-conformance.mjs"),
        "--archive",
        capabilities.archivePath,
        "--checksum",
        capabilitySidecar,
    ], capabilities.root, {
        ...runtimeEnvironment,
        PATH: `${conformanceBin}:/usr/bin:/bin`,
        WORLD_CAPABILITIES_CONFORMANCE_WRAPPER: "1",
    });

    const modes = ["deterministic", "retry", "replay", "branch", "migrate"];
    const receipts = {};
    for (const mode of modes) {
        const result = run(process.execPath, [
            join(sourceRoot, "tools/actuality/run.mjs"),
            "--mode",
            mode,
            "--agent-root",
            sourceRoot,
            "--world-host-root",
            runtimeHost,
            "--capabilities-root",
            runtimeCapabilities,
            "--artifact-root",
            options.artifactRoot,
        ], runtimeRoot, runtimeEnvironment, false);
        receipts[mode] = JSON.parse(result.stdout);
    }
    assert.equal(receipts.deterministic.hidden_verifier_passed, true);
    assert.equal(receipts.deterministic.typed_final_result, true);
    assert.equal(receipts.retry.deterministic_retry, true);
    assert.equal(receipts.retry.retry_child_frame_byte_identical, true);
    assert.equal(receipts.replay.replay_fresh_effect_count, 0);
    assert.equal(receipts.branch.branching, true);
    assert.equal(receipts.migrate.migration, true);
    assert.equal(receipts.migrate.migration_receiver_preflight, true);

    if (options.receiptPath !== null) {
        mkdirSync(dirname(options.receiptPath), { recursive: true });
        writeFileSync(options.receiptPath, `${JSON.stringify({
            format: "agent-reference-stack-receipt-v1",
            worldHostArchiveSha256: acquired.worldHost.entry.sha256,
            worldCapabilitiesArchiveSha256: capabilitiesArchiveSha256,
            worldCapabilitiesSourceArchiveSha256: acquired.worldCapabilities.entry.sourceSha256,
            deterministic: receipts.deterministic,
            retry: receipts.retry,
            replay: receipts.replay,
            branch: receipts.branch,
            migrate: receipts.migrate,
        }, null, 2)}\n`);
    }

    for (const [kind, artifact] of Object.entries(acquired)) {
        console.log(`${snake(kind)}_version=${artifact.entry.version}`);
        if (kind === "worldCapabilities" && artifact.entry.provenance === "source-build") {
            console.log(`world_capabilities_source_archive_sha256=${artifact.entry.sourceSha256}`);
            console.log(`world_capabilities_archive_sha256=${capabilitiesArchiveSha256}`);
            console.log("world_capabilities_artifact_source=source-built");
        } else {
            console.log(`${snake(kind)}_archive_sha256=${artifact.entry.sha256}`);
            console.log(`${snake(kind)}_artifact_source=${artifact.source}`);
        }
        if (artifact.resolvedUrl !== null) console.log(`${snake(kind)}_resolved_url=${redactedUrl(artifact.resolvedUrl)}`);
    }
    console.log("github_authentication_required=false");
    console.log("github_cli_required=false");
    console.log("private_repository_permission_required=false");
    console.log("numeric_asset_api_path_count=0");
    console.log("source_checkout_required=false");
    console.log("sibling_checkout_required=false");
    console.log("zig_required_at_runtime=false");
    console.log("agent_reference_stack_retry=true");
    console.log("agent_reference_stack_replay=true");
    console.log("agent_reference_stack_branching=true");
    console.log("agent_reference_stack_migration=true");
    console.log("agent_reference_stack_actuality=true");
    passed = true;
} finally {
    if (passed) rmSync(proofRoot, { recursive: true, force: true });
    else console.error(`agent_reference_stack_proof_root=${proofRoot}`);
}

function capabilitiesBuildEnvironment(proofRoot) {
    const environment = {
        ...process.env,
        HOME: join(proofRoot, "capabilities-build-home"),
        PATH: "/usr/bin:/bin",
    };
    mkdirSync(environment.HOME);
    for (const name of ["GH_TOKEN", "GITHUB_TOKEN", "OPENAI_API_KEY", "BUN_OPTIONS", "NODE_OPTIONS"]) {
        delete environment[name];
    }
    return environment;
}

function copyRuntime(source, destination, entries) {
    for (const entry of entries) cpSync(join(source, entry), join(destination, entry), { recursive: true, errorOnExist: true });
}

function sanitizedEnvironment(proofRoot) {
    const environment = { ...process.env, HOME: join(proofRoot, "home"), PATH: "/usr/bin:/bin" };
    mkdirSync(environment.HOME);
    for (const name of ["GH_TOKEN", "GITHUB_TOKEN", "OPENAI_API_KEY", "BUN_OPTIONS", "NODE_OPTIONS"]) delete environment[name];
    return environment;
}

function run(command, args, cwd, env, forward = true) {
    const result = spawnSync(command, args, { cwd, env, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
    if (forward && result.stdout) process.stdout.write(result.stdout);
    if (forward && result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}:\n${result.stderr ?? ""}`);
    return result;
}

function parseArgs(argv) {
    const result = { offline: false, worldHostArchive: null, worldCapabilitiesArchive: null, artifactRoot: null, receiptPath: null };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === "--offline") result.offline = true;
        else if (["--world-host-archive", "--world-capabilities-archive", "--artifact-root", "--receipt-path"].includes(argument)) {
            if (index + 1 >= argv.length) throw new Error(`${argument} requires a value`);
            result[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = resolve(argv[index += 1]);
        } else throw new Error(`unknown argument: ${argument}`);
    }
    if (!result.artifactRoot) throw new Error("--artifact-root is required");
    return result;
}

function basename(path) {
    return path.slice(path.lastIndexOf("/") + 1);
}

function snake(value) {
    return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function redactedUrl(value) {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.href;
}
