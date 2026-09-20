import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { verifyRuntime } from "../../tools/agent4/dependencies.mjs";

const root = resolve(import.meta.dirname, "../..");
const runtimePath = resolve(process.env.AGENT4_WORLD_RUNTIME ??
  resolve(root, ".agent4/out/world-runtime"));
const fixtures = resolve(process.env.AGENT4_FIXTURES ?? resolve(root, ".agent4/out"));
const inspector = resolve(process.env.AGENT4_MULTI_INSPECTOR ??
  resolve(root, ".agent4/out/multi/bin/multi-probe"));
const identity = verifyRuntime(runtimePath);
const { Kernel, encodeInput, decodeOutcome, decodeRequest, encodeResult } = await import(pathToFileURL(
  identity.entrypoint,
));
const kernelBytes = await readFile(identity.kernelPath);
const expectedSha256 = identity.kernelSha256;
const image = await readFile(resolve(fixtures, "multi/multi.bpi3"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const fresh = async input => { const kernel = await Kernel.create({ bytes: kernelBytes, expectedSha256 }); kernel.setLimits({ input: 256 << 20, working: 256 << 20, output: 256 << 20 }); const bytes = kernel.invoke(encodeInput(input)); return { ...decodeOutcome(bytes), bytes }; };
await mkdir(resolve(root, ".agent4/out/multi"), { recursive: true });

try {
  await runProbes();
} finally {
  assert.deepEqual(verifyRuntime(runtimePath), identity,
    "World runtime changed during the multi-shot and cleanup probes");
}

function integer(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
}
function natural(value) {
  let n = BigInt(value);
  const bytes = [];
  do {
    const low = Number(n & 127n);
    n >>= 7n;
    bytes.push(low | (n ? 128 : 0));
  } while (n);
  return Buffer.from(bytes);
}
function sequence(values) {
  return Buffer.concat([natural(values.length), ...values.map(integer)]);
}
function readInteger(bytes, at = 0) {
  return Buffer.from(bytes).readBigUInt64LE(at);
}

async function runProbes() {
  const observations = [];
  for (const count of [0, 1, 2, 8, 64]) {
    const alternatives = Array.from({ length: count }, (_, i) => BigInt(i + 11));
    let outcome = await fresh({ image, initialArgs: sequence(alternatives) });
    const requests = [];
    const stateBytes = [];
    while (outcome.kind === "requested") {
      const request = (await decodeRequest(outcome.request));
      assert.equal(request.semanticIdentity, "agent4.probe.assess");
      assert.equal(request.payload.length, 16);
      const candidate = readInteger(request.payload);
      const before = readInteger(request.payload, 8);
      assert.equal(before, 10n, "each resumed branch must receive its own initial cell");
      requests.push(candidate);
      stateBytes.push(outcome.state.length);
      const transferred = await fresh({ image, state: Uint8Array.from(outcome.state) });
      assert.deepEqual(transferred.bytes, outcome.bytes,
        "fresh-instance restore must reconstruct the same pending request without reissuing it");
      if (count === 2 && requests.length === 1) {
        await writeFile(resolve(root, ".agent4/out/multi/retained-alternative.pst3"), outcome.state);
        await writeFile(resolve(root, ".agent4/out/multi/retained-alternative.erq2"), outcome.request);
      }
      if (count === 64 && (requests.length === 1 || requests.length === 64)) {
        await writeFile(resolve(root, `.agent4/out/multi/retained-64-${requests.length}.pst3`),
          outcome.state);
      }
      const result = (await encodeResult(transferred.request, integer(candidate * 3n)));
      outcome = await fresh({ image, state: transferred.state, control: "reply", value: result });
    }
    assert.equal(outcome.kind, "completed");
    assert.deepEqual(requests, alternatives);
    const expected = Buffer.concat([
      natural(count),
      ...alternatives.flatMap(candidate => [integer(10n), integer(candidate), integer(candidate * 3n)]),
    ]);
    assert.deepEqual(Buffer.from(outcome.value), expected);
    observations.push({ alternatives: count, requests: requests.length, stateBytes });
  }
  const retained = inspect("retained-alternative");
  assert.equal(retained.multiTemplates, 1);
  assert.equal(retained.cells, 2, "the template and active branch own distinct cells");
  assert.equal(retained.obligations, 0, "speculation captures no cleanup obligation");
  const detail = await inspectExecution("multi", "retained-alternative");
  assert.equal(detail.pending.identity, "agent4.probe.assess");
  assert.equal(detail.retained.multiTemplates, 1);
  assert.ok(detail.retained.activationViews > 0);
  assert.equal(detail.cleanupObligations.length, 0);
  const request = await decodeRequest(await readFile(resolve(root, ".agent4/out/multi/retained-alternative.erq2")));
  assert.deepEqual(Buffer.from(detail.pending.payloadSchemaHex, "hex"), Buffer.from(request.payloadSchema));
  assert.deepEqual(Buffer.from(detail.pending.resultSchemaHex, "hex"), Buffer.from(request.resumeSchema));
  const wrong = spawnSync(inspector, ["inspect-execution", resolve(fixtures, "multi/cleanup.bpi3"),
    resolve(root, ".agent4/out/multi/retained-alternative.pst3")]);
  assert.equal(wrong.error, undefined);
  assert.notEqual(wrong.status, 0, "inspection must reject a different Program");
  assert.equal(wrong.stdout.length, 0, "rejected inspection must not publish a report");
  const firstBranch = inspect("retained-64-1");
  const finalBranch = inspect("retained-64-64");
  assert.deepEqual(finalBranch, firstBranch,
    "completed branches release their control; retained result bytes alone grow");
  const cleanup = await testCleanup();
  const disposal = await testDisposal();
  console.log(JSON.stringify({
    kernelSha256: expectedSha256, imageSha256: hash(image), imageBytes: image.length,
    observations, retained, steadyBranchGraph: firstBranch, cleanup, disposal,
  }));
}

function inspect(name) {
  const output = execFileSync(inspector,
    ["inspect-state", resolve(root, `.agent4/out/multi/${name}.pst3`)], { encoding: "utf8" });
  return JSON.parse(output);
}

async function inspectExecution(imageName, stateName) {
  const imagePath = resolve(fixtures, `multi/${imageName}.bpi3`);
  const statePath = resolve(root, `.agent4/out/multi/${stateName}.pst3`);
  const before = await Promise.all([readFile(imagePath), readFile(statePath)]);
  const report = JSON.parse(execFileSync(inspector, ["inspect-execution", imagePath, statePath], { encoding: "utf8" }));
  assert.deepEqual(await Promise.all([readFile(imagePath), readFile(statePath)]), before,
    "read-only inspection must preserve both input files");
  assert.match(report.programIdentity, /^[a-f0-9]{64}$/);
  for (const value of Object.values(report.pending.location)) assert.ok(Number.isSafeInteger(value) && value >= 0);
  return report;
}

async function restore(image, outcome) {
  const restored = await fresh({ image, state: Uint8Array.from(outcome.state) });
  assert.deepEqual(restored.bytes, outcome.bytes);
  return restored;
}

async function testCleanup() {
  const image = await readFile(resolve(fixtures, "multi/cleanup.bpi3"));
  const parked = await fresh({ image, initialArgs: new Uint8Array() });
  assert.equal(parked.kind, "requested");
  const question = (await decodeRequest(parked.request));
  assert.equal(question.semanticIdentity, "agent4.probe.cleanup-question");
  assert.equal(readInteger(question.payload), 7n);
  await writeFile(resolve(root, ".agent4/out/multi/cleanup-pending.pst3"), parked.state);
  const waiting = await inspectExecution("cleanup", "cleanup-pending");
  assert.ok(waiting.cleanupObligations.some(owner => owner.required && owner.deferredCleanup &&
    owner.status === "pending" && owner.runningAt === null));
  const normal = await fresh({ image, state: parked.state,
    control: "reply", value: (await encodeResult(parked.request, integer(42))) });
  assert.equal(normal.kind, "requested");
  assert.equal((await decodeRequest(normal.request)).semanticIdentity, "agent4.probe.release");
  await writeFile(resolve(root, ".agent4/out/multi/cleanup.pst3"), normal.state);
  const detail = await inspectExecution("cleanup", "cleanup");
  assert.equal(detail.pending.identity, "agent4.probe.release");
  assert.ok(detail.cleanupObligations.some(owner => owner.required && !owner.deferredCleanup && owner.status === "running" && owner.runningAt !== null),
    "suspended cleanup remains an identified live obligation");
  assert.ok(detail.cleanupOwnership.some(edge => edge.kind === "cleanup_return" &&
    detail.cleanupObligations.some(owner => owner.node === edge.obligation && owner.required && owner.runningAt === edge.holder)),
  "the suspended cleanup return retains its obligation owner");
  await restore(image, normal);
  const done = await fresh({ image, state: normal.state,
    control: "reply", value: (await encodeResult(normal.request, new Uint8Array())) });
  assert.equal(done.kind, "completed");
  assert.equal(readInteger(done.value), 42n);

  const cancelling = await fresh({ image, state: parked.state, control: "cancel_text", value: "stop" });
  assert.equal(cancelling.kind, "requested");
  assert.equal((await decodeRequest(cancelling.request)).semanticIdentity, "agent4.probe.release");
  await restore(image, cancelling);
  const cancelled = await fresh({ image, state: cancelling.state,
    control: "reply", value: (await encodeResult(cancelling.request, new Uint8Array())) });
  assert.equal(cancelled.kind, "cancelled");
  assert.deepEqual(cancelled.reason, { kind: "text", value: "stop" });
  assert.deepEqual(cancelled.cleanupFailures, []);

  const oldResult = (await encodeResult(normal.request, new Uint8Array()));
  const rebound = await fresh({ image, state: normal.state, control: "cancel_text", value: "stop" });
  assert.equal(rebound.kind, "requested");
  assert.deepEqual((await decodeRequest(rebound.request)).payload, (await decodeRequest(normal.request)).payload);
  assert.notDeepEqual(rebound.request, normal.request);
  await assert.rejects(fresh({ image, state: rebound.state, control: "reply", value: oldResult }), error => error.details?.diagnostic === "InvalidResult");
  const repeated = await fresh({ image, state: rebound.state, control: "cancel_text", value: "ignored second reason" });
  assert.deepEqual(repeated.bytes, rebound.bytes);
  await restore(image, rebound);
  const reboundDone = await fresh({ image, state: rebound.state,
    control: "reply", value: (await encodeResult(rebound.request, new Uint8Array())) });
  assert.equal(reboundDone.kind, "cancelled");
  assert.deepEqual(reboundDone.reason, { kind: "text", value: "stop" });
  assert.deepEqual(reboundDone.cleanupFailures, []);
  return { normal: done.kind, cancel: cancelled.kind, rebound: reboundDone.kind,
    imageSha256: hash(image), graph: inspect("cleanup") };
}

async function testDisposal() {
  const image = await readFile(resolve(fixtures, "multi/dispose.bpi3"));
  const parked = await fresh({ image, initialArgs: new Uint8Array() });
  assert.equal(parked.kind, "requested");
  const parent = (await decodeRequest(parked.request));
  assert.equal(parent.semanticIdentity, "agent4.probe.disposal-parent");
  assert.equal(readInteger(parent.payload), 42n);
  await writeFile(resolve(root, ".agent4/out/multi/disposal-owned.pst3"), parked.state);
  const graph = inspect("disposal-owned");
  assert.equal(graph.packages, 1);
  assert.equal(graph.obligations, 1);
  await restore(image, parked);
  const disposing = await fresh({ image, state: parked.state,
    control: "reply", value: (await encodeResult(parked.request, new Uint8Array())) });
  assert.equal(disposing.kind, "requested");
  const release = (await decodeRequest(disposing.request));
  assert.equal(release.semanticIdentity, "agent4.probe.disposal-release");
  assert.equal(readInteger(release.payload), 99n);
  await restore(image, disposing);
  const done = await fresh({ image, state: disposing.state,
    control: "reply", value: (await encodeResult(disposing.request, new Uint8Array())) });
  assert.equal(done.kind, "completed");
  assert.equal(readInteger(done.value), 42n);
  const cancelling = await fresh({ image, state: parked.state, control: "cancel_text", value: "abandon child" });
  assert.equal(cancelling.kind, "requested");
  assert.equal((await decodeRequest(cancelling.request)).semanticIdentity, "agent4.probe.disposal-release");
  assert.equal(readInteger((await decodeRequest(cancelling.request)).payload), 99n);
  await restore(image, cancelling);
  const cancelled = await fresh({ image, state: cancelling.state,
    control: "reply", value: (await encodeResult(cancelling.request, new Uint8Array())) });
  assert.equal(cancelled.kind, "cancelled");
  assert.deepEqual(cancelled.reason, { kind: "text", value: "abandon child" });
  assert.deepEqual(cancelled.cleanupFailures, []);
  return { normal: done.kind, cancel: cancelled.kind, imageSha256: hash(image), graph };
}
