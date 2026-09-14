import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { verifyRuntime } from "../../tools/agent4/dependencies.mjs";

const root = resolve(import.meta.dirname, "../..");
const runtimePath = resolve(process.env.AGENT4_WORLD_RUNTIME ??
  resolve(root, ".agent4/out/world-runtime"));
const fixtures = resolve(process.env.AGENT4_FIXTURES ?? resolve(root, ".agent4/out"));
const inspector = resolve(process.env.AGENT4_MULTI_INSPECTOR ??
  resolve(root, ".agent4/out/multi/bin/multi-probe"));
const identity = verifyRuntime(runtimePath);
const { admitProcessKernel, decodeRequest, encodeResult } = await import(pathToFileURL(
  identity.entrypoint,
));
const kernelBytes = await readFile(identity.kernelPath);
const expectedSha256 = identity.kernelSha256;
const image = await readFile(resolve(fixtures, "multi/multi.bpi2"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const fresh = async input => (await admitProcessKernel(kernelBytes, { expectedSha256 })).run(input);
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
    while (outcome.kind === "Requested") {
      const request = decodeRequest(outcome.request);
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
        await writeFile(resolve(root, ".agent4/out/multi/retained-alternative.pst2"), outcome.state);
        await writeFile(resolve(root, ".agent4/out/multi/retained-alternative.erq2"), outcome.request);
      }
      if (count === 64 && (requests.length === 1 || requests.length === 64)) {
        await writeFile(resolve(root, `.agent4/out/multi/retained-64-${requests.length}.pst2`),
          outcome.state);
      }
      const result = encodeResult(transferred.request, integer(candidate * 3n));
      outcome = await fresh({ image, state: transferred.state, result });
    }
    assert.equal(outcome.kind, "Completed");
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
    ["inspect-state", resolve(root, `.agent4/out/multi/${name}.pst2`)], { encoding: "utf8" });
  return JSON.parse(output);
}

async function restore(image, outcome) {
  const restored = await fresh({ image, state: Uint8Array.from(outcome.state) });
  assert.deepEqual(restored.bytes, outcome.bytes);
  return restored;
}

async function testCleanup() {
  const image = await readFile(resolve(fixtures, "multi/cleanup.bpi2"));
  const parked = await fresh({ image, initialArgs: new Uint8Array() });
  assert.equal(parked.kind, "Requested");
  const question = decodeRequest(parked.request);
  assert.equal(question.semanticIdentity, "agent4.probe.cleanup-question");
  assert.equal(readInteger(question.payload), 7n);
  const normal = await fresh({ image, state: parked.state,
    result: encodeResult(parked.request, integer(42)) });
  assert.equal(normal.kind, "Requested");
  assert.equal(decodeRequest(normal.request).semanticIdentity, "agent4.probe.release");
  await writeFile(resolve(root, ".agent4/out/multi/cleanup.pst2"), normal.state);
  await restore(image, normal);
  const done = await fresh({ image, state: normal.state,
    result: encodeResult(normal.request, new Uint8Array()) });
  assert.equal(done.kind, "Completed");
  assert.equal(readInteger(done.value), 42n);

  const cancelling = await fresh({ image, state: parked.state, cancel: "stop" });
  assert.equal(cancelling.kind, "Requested");
  assert.equal(decodeRequest(cancelling.request).semanticIdentity, "agent4.probe.release");
  await restore(image, cancelling);
  const cancelled = await fresh({ image, state: cancelling.state,
    result: encodeResult(cancelling.request, new Uint8Array()) });
  assert.equal(cancelled.kind, "Cancelled");
  assert.equal(cancelled.reason, "stop");
  assert.deepEqual(cancelled.cleanupFailures, []);

  const oldResult = encodeResult(normal.request, new Uint8Array());
  const rebound = await fresh({ image, state: normal.state, cancel: "stop" });
  assert.equal(rebound.kind, "Requested");
  assert.deepEqual(decodeRequest(rebound.request).payload, decodeRequest(normal.request).payload);
  assert.notDeepEqual(rebound.request, normal.request);
  await assert.rejects(fresh({ image, state: rebound.state, result: oldResult }), /InvalidResult/);
  const repeated = await fresh({ image, state: rebound.state, cancel: "ignored second reason" });
  assert.deepEqual(repeated.bytes, rebound.bytes);
  await restore(image, rebound);
  const reboundDone = await fresh({ image, state: rebound.state,
    result: encodeResult(rebound.request, new Uint8Array()) });
  assert.equal(reboundDone.kind, "Cancelled");
  assert.equal(reboundDone.reason, "stop");
  assert.deepEqual(reboundDone.cleanupFailures, []);
  return { normal: done.kind, cancel: cancelled.kind, rebound: reboundDone.kind,
    imageSha256: hash(image), graph: inspect("cleanup") };
}

async function testDisposal() {
  const image = await readFile(resolve(fixtures, "multi/dispose.bpi2"));
  const parked = await fresh({ image, initialArgs: new Uint8Array() });
  assert.equal(parked.kind, "Requested");
  const parent = decodeRequest(parked.request);
  assert.equal(parent.semanticIdentity, "agent4.probe.disposal-parent");
  assert.equal(readInteger(parent.payload), 42n);
  await writeFile(resolve(root, ".agent4/out/multi/disposal-owned.pst2"), parked.state);
  const graph = inspect("disposal-owned");
  assert.equal(graph.packages, 1);
  assert.equal(graph.obligations, 1);
  await restore(image, parked);
  const disposing = await fresh({ image, state: parked.state,
    result: encodeResult(parked.request, new Uint8Array()) });
  assert.equal(disposing.kind, "Requested");
  const release = decodeRequest(disposing.request);
  assert.equal(release.semanticIdentity, "agent4.probe.disposal-release");
  assert.equal(readInteger(release.payload), 99n);
  await restore(image, disposing);
  const done = await fresh({ image, state: disposing.state,
    result: encodeResult(disposing.request, new Uint8Array()) });
  assert.equal(done.kind, "Completed");
  assert.equal(readInteger(done.value), 42n);
  const cancelling = await fresh({ image, state: parked.state, cancel: "abandon child" });
  assert.equal(cancelling.kind, "Requested");
  assert.equal(decodeRequest(cancelling.request).semanticIdentity, "agent4.probe.disposal-release");
  assert.equal(readInteger(decodeRequest(cancelling.request).payload), 99n);
  await restore(image, cancelling);
  const cancelled = await fresh({ image, state: cancelling.state,
    result: encodeResult(cancelling.request, new Uint8Array()) });
  assert.equal(cancelled.kind, "Cancelled");
  assert.equal(cancelled.reason, "abandon child");
  assert.deepEqual(cancelled.cleanupFailures, []);
  return { normal: done.kind, cancel: cancelled.kind, imageSha256: hash(image), graph };
}
