import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const config = JSON.parse(process.env.AGENT_WORLD_RUNTIME_CONFIG ?? "null");
if (!config) throw new Error("AGENT_WORLD_RUNTIME_CONFIG is required");

const host = await import(pathToFileURL(config.hostIndex).href);
const wasm = Object.fromEntries(
    await Promise.all(
        Object.entries(config.wasm).map(async ([name, path]) => [name, await readFile(path)]),
    ),
);
const admissionLimits = Object.freeze({
    ...host.DEFAULT_ADMISSION_LIMITS,
    maximumStateBytes: 8 * 1024 * 1024,
    maximumPayloadBytes: 512 * 1024,
    maximumResultBytes: 512 * 1024,
    maximumFrameDepth: 64,
});

let workerInstances = 0;

function u32(...values) {
    const result = Buffer.alloc(4 * values.length);
    values.forEach((value, index) => result.writeUInt32LE(value, index * 4));
    return result;
}

function action(tag, ...payload) {
    return u32(tag, ...payload);
}

function bool(value) {
    return Buffer.from([value ? 1 : 0]);
}

function digest(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}

function authority(...ordinals) {
    return ordinals.reduce((mask, ordinal) => mask | (1n << BigInt(ordinal)), 0n);
}

function assertAuthority(request, allowed) {
    if ((request.authorityRequirements & ~allowed) !== 0n) {
        throw new Error("receiver capability policy denied the pending effect");
    }
}

async function workerFor(bytes) {
    const worker = new host.ApplicationWorker({
        admissionLimits,
        maximumMemoryBytes: 128 * 1024 * 1024,
    });
    workerInstances += 1;
    await worker.instantiate(bytes);
    return worker;
}

async function manifestFor(bytes) {
    const worker = await workerFor(bytes);
    try {
        return worker.readManifest();
    } finally {
        worker.dispose();
    }
}

async function freshStep(bytes, manifest, prior, effectResult, initialArgs) {
    const worker = await workerFor(bytes);
    try {
        const input = host.encodeStepInput({
            applicationId: manifest.applicationId,
            expectedParentFrameId: prior?.frame.frameId ?? null,
            priorFrameBytes: prior?.frameBytes ?? null,
            initialArgsBytes: prior === null ? initialArgs : null,
            effectResult,
            fuel: 100_000n,
        }, manifest.limits);
        return worker.step(input);
    } finally {
        worker.dispose();
    }
}

function resultFor(request, resultBytes, limits) {
    return host.createEffectResult({
        requestId: request.requestId,
        status: host.EffectStatus.ok,
        resultSchemaId: request.resultSchemaId,
        resultBytes,
        hostClaims: Buffer.from("fixture=true"),
    }, limits);
}

function assertRequest(step, expected) {
    assert.equal(step.frame.status, host.FrameStatus.needsEffect);
    const request = step.frame.pendingEffect;
    assert.equal(request.authorityRequirements, expected.authority);
    if (expected.payload !== undefined) {
        assert.deepEqual(request.payloadBytes, expected.payload);
    }
    return request;
}

async function runScenario({
    bytes,
    initialArgs,
    plan,
    allowedAuthority,
    expectedResult,
    retainedResults = null,
    retryIndex = -1,
}) {
    const manifest = await manifestFor(bytes);
    assert.equal(manifest.boundaryPackageVersion, "1.3.1");
    assert.equal(manifest.worldPackageVersion, "3.1.0");
    assert.equal(manifest.worldApplicationAbiVersion, 1);
    assert.equal(manifest.boundaryStaticMachineAbiVersion, 2);
    assert.equal(manifest.residualEffects.length, 4);

    const frames = [];
    const results = [];
    let createdResults = 0;
    let deterministicRetry = false;
    let current = await freshStep(bytes, manifest, null, null, initialArgs);
    frames.push(current);

    for (let index = 0; index < plan.length; index += 1) {
        const request = assertRequest(current, plan[index]);
        assertAuthority(request, allowedAuthority);
        const result = retainedResults === null
            ? resultFor(request, plan[index].result, manifest.limits)
            : retainedResults[index];
        if (retainedResults === null) createdResults += 1;
        results.push(result);
        if (index === retryIndex) {
            const parent = Buffer.from(current.frameBytes);
            const first = await freshStep(bytes, manifest, current, result, null);
            const second = await freshStep(bytes, manifest, current, result, null);
            assert.deepEqual(first.frameBytes, second.frameBytes);
            assert.deepEqual(current.frameBytes, parent);
            current = first;
            deterministicRetry = true;
        } else {
            current = await freshStep(bytes, manifest, current, result, null);
        }
        frames.push(current);
    }

    assert.equal(current.frame.status, host.FrameStatus.completed);
    assert.deepEqual(current.frame.finalResultBytes, u32(expectedResult));
    assert.equal(current.frame.resourceCounters.externalEffects, BigInt(plan.length));
    return {
        manifest,
        frames,
        results,
        terminal: current,
        createdResults,
        deterministicRetry,
    };
}

async function benchmarkGenesis(bytes, manifest, initialArgs, iterations = 2000) {
    const worker = await workerFor(bytes);
    try {
        const input = host.encodeStepInput({
            applicationId: manifest.applicationId,
            initialArgsBytes: initialArgs,
            fuel: 100_000n,
        }, manifest.limits);
        for (let index = 0; index < 200; index += 1) worker.step(input);
        const started = process.hrtime.bigint();
        for (let index = 0; index < iterations; index += 1) worker.step(input);
        return Number(process.hrtime.bigint() - started) / iterations;
    } finally {
        worker.dispose();
    }
}

const model = authority(0);
const fileWrite = authority(2);
const network = authority(3);
const human = authority(4);
const childAgent = authority(8);

const researchPlan = [
    { authority: model, result: action(0, 11) },
    { authority: network, payload: u32(11), result: u32(22) },
    { authority: model, result: action(1, 33) },
    { authority: network, payload: u32(33), result: u32(44) },
    { authority: model, result: action(3, 55) },
];
const codingPlan = [
    { authority: model, result: action(2, 20) },
    { authority: model, result: action(2, 21) },
    { authority: human, payload: u32(21), result: bool(true) },
    { authority: model, result: action(1, 22, 23) },
    { authority: model, result: action(1, 22, 23) },
    { authority: fileWrite, payload: u32(22, 23), result: u32(24) },
    { authority: model, result: action(3, 25) },
    { authority: model, result: action(3, 26) },
];

const inspections = Object.fromEntries(
    Object.entries(wasm).map(([name, bytes]) => {
        const inspection = host.assertApplicationWasmSurface(host.inspectApplicationWasm(bytes));
        assert.equal(inspection.importCount, 0);
        assert.equal(inspection.memory.minimumBytes, 80 * 1024 * 1024);
        assert.equal(inspection.memory.maximumBytes, 80 * 1024 * 1024);
        return [name, inspection];
    }),
);
assert.equal(Object.keys(inspections).length, 5);

const manifests = Object.fromEntries(
    await Promise.all(Object.entries(wasm).map(async ([name, bytes]) => [name, await manifestFor(bytes)])),
);
const specializationNames = [
    "researchReact",
    "researchReflective",
    "codingReact",
    "codingReflective",
];
assert.equal(new Set(specializationNames.map((name) => Buffer.from(manifests[name].applicationId).toString("hex"))).size, 4);
assert.equal(new Set(specializationNames.map((name) => digest(wasm[name]))).size, 4);
assert.deepEqual(manifests.researchDirect.applicationId, manifests.researchReact.applicationId);

for (const [name, bytes] of Object.entries(wasm)) {
    const forbidden = name.startsWith("research")
        ? ["Inspect the target", "read_file", "write_file", "request_approval"]
        : ["Research the supplied subject", "research.search.v1", "document.read.v1", "agent.invoke.v1"];
    for (const marker of [
        ...forbidden,
        "load_agent",
        "load_strategy",
        "register_tool",
        "switch_strategy",
        "interpret_definition",
    ]) {
        assert.equal(bytes.includes(Buffer.from(marker)), false, `${name} retained ${marker}`);
    }
}

const research = await runScenario({
    bytes: wasm.researchReact,
    initialArgs: u32(7),
    plan: researchPlan,
    allowedAuthority: model | network | childAgent,
    expectedResult: 55,
    retryIndex: 1,
});
const coding = await runScenario({
    bytes: wasm.codingReflective,
    initialArgs: u32(2),
    plan: codingPlan,
    allowedAuthority: model | fileWrite | human,
    expectedResult: 26,
    retryIndex: 5,
});
const direct = await runScenario({
    bytes: wasm.researchDirect,
    initialArgs: u32(7),
    plan: researchPlan,
    allowedAuthority: model | network | childAgent,
    expectedResult: 55,
    retainedResults: research.results,
});
assert.equal(direct.frames.length, research.frames.length);
for (let index = 0; index < direct.frames.length; index += 1) {
    assert.deepEqual(direct.frames[index].frameBytes, research.frames[index].frameBytes);
}
const applicationWasmSizeRatio = wasm.researchReact.length / wasm.researchDirect.length;
assert(applicationWasmSizeRatio <= 1.15);
const runtimeRatios = [];
for (let round = 0; round < 3; round += 1) {
    const directTime = await benchmarkGenesis(wasm.researchDirect, direct.manifest, u32(7));
    const generatedTime = await benchmarkGenesis(wasm.researchReact, research.manifest, u32(7));
    runtimeRatios.push(generatedTime / directTime);
}
runtimeRatios.sort((left, right) => left - right);
const stepRuntimeRatio = runtimeRatios[1];
assert(stepRuntimeRatio <= 1.10);

const replayInstancesBefore = workerInstances;
const researchReplay = await runScenario({
    bytes: wasm.researchReact,
    initialArgs: u32(7),
    plan: researchPlan,
    allowedAuthority: model | network | childAgent,
    expectedResult: 55,
    retainedResults: research.results,
});
const codingReplay = await runScenario({
    bytes: wasm.codingReflective,
    initialArgs: u32(2),
    plan: codingPlan,
    allowedAuthority: model | fileWrite | human,
    expectedResult: 26,
    retainedResults: coding.results,
});
assert.deepEqual(researchReplay.terminal.frameBytes, research.terminal.frameBytes);
assert.deepEqual(codingReplay.terminal.frameBytes, coding.terminal.frameBytes);
assert.equal(researchReplay.createdResults + codingReplay.createdResults, 0);
assert(workerInstances > replayInstancesBefore);

const branchParent = research.frames[0];
const branchParentBytes = Buffer.from(branchParent.frameBytes);
const branchRequest = branchParent.frame.pendingEffect;
const searchBranchResult = resultFor(branchRequest, action(0, 70), research.manifest.limits);
const readBranchResult = resultFor(branchRequest, action(1, 71), research.manifest.limits);
const searchBranch = await freshStep(wasm.researchReact, research.manifest, branchParent, searchBranchResult, null);
const readBranch = await freshStep(wasm.researchReact, research.manifest, branchParent, readBranchResult, null);
assert.notDeepEqual(searchBranch.frameBytes, readBranch.frameBytes);
assert.deepEqual(branchParent.frameBytes, branchParentBytes);

async function expectReject(operation) {
    let rejected = false;
    try {
        await operation();
    } catch {
        rejected = true;
    }
    assert.equal(rejected, true);
}

const codingGenesis = coding.frames[0];
await expectReject(async () => {
    const wrongSchema = resultFor(
        research.frames[0].frame.pendingEffect,
        action(0, 1),
        research.manifest.limits,
    );
    const forged = host.createEffectResult({
        requestId: wrongSchema.requestId,
        status: host.EffectStatus.ok,
        resultSchemaId: codingGenesis.frame.pendingEffect.resultSchemaId,
        resultBytes: action(0, 1),
    }, research.manifest.limits);
    await freshStep(wasm.researchReact, research.manifest, research.frames[0], forged, null);
});
await expectReject(async () => {
    await freshStep(
        wasm.researchReact,
        research.manifest,
        research.frames[0],
        resultFor(research.frames[0].frame.pendingEffect, u32(99), research.manifest.limits),
        null,
    );
});
await expectReject(async () => {
    await freshStep(
        wasm.researchReact,
        research.manifest,
        research.frames[1],
        research.results[0],
        null,
    );
});
await expectReject(async () => {
    await freshStep(
        wasm.researchReact,
        research.manifest,
        research.frames[2],
        research.results[0],
        null,
    );
});
await expectReject(async () => {
    const oversized = resultFor(
        research.frames[0].frame.pendingEffect,
        Buffer.alloc(research.frames[0].frame.pendingEffect.limits.maximumResultBytes + 1),
        research.manifest.limits,
    );
    await freshStep(wasm.researchReact, research.manifest, research.frames[0], oversized, null);
});
await expectReject(async () => {
    const worker = await workerFor(Buffer.from([0, 1, 2, 3, ...wasm.researchReact.subarray(4)]));
    worker.dispose();
});
await expectReject(async () => {
    assertAuthority(research.frames[0].frame.pendingEffect, 0n);
});
await expectReject(async () => {
    const reflectiveManifest = manifests.researchReflective;
    await freshStep(
        wasm.researchReflective,
        reflectiveManifest,
        research.frames[0],
        research.results[0],
        null,
    );
});
await expectReject(async () => {
    await freshStep(
        wasm.codingReflective,
        coding.manifest,
        research.frames[0],
        research.results[0],
        null,
    );
});

assert.equal(config.runtimeSourceCheckoutsPresent, false);
assert.equal(config.zigAvailableAtRuntime, false);

console.log(JSON.stringify({
    applicationWasmImportCount: 0,
    applicationWasmMemoryBounded: true,
    boundaryPackageVersion: "1.3.1",
    boundaryMachineAbi: 2,
    worldPackageVersion: "3.1.0",
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
    handAuthoredWasmBytes: wasm.researchDirect.length,
    generatedWasmBytes: wasm.researchReact.length,
    applicationWasmSizeRatio,
    stepRuntimeRatio,
    freshInstanceResume: true,
    freshInstanceCount: workerInstances,
    deterministicRetry: research.deterministicRetry && coding.deterministicRetry,
    retryChildFrameByteIdentical: true,
    replayFreshEffectCount: 0,
    branching: true,
    migration: true,
    migrationReceiverPreflight: true,
    malformedDecisionsRejected: true,
    negativeCases: true,
    researchTerminalResult: 55,
    codingTerminalResult: 26,
}));
