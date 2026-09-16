import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { verifyRuntime } from "../../tools/agent4/dependencies.mjs";
import { decodeSchema, decodeValue, encodeValue } from "../../runtime/values.mjs";
import { native, wasmtime } from "./independent/execute.mjs";

const [runtimePath, imagePath, nativePath, inspectorPath, ...extra] = process.argv.slice(2);
assert(runtimePath && imagePath && nativePath && inspectorPath && !extra.length);
const runtime = verifyRuntime(runtimePath);
const world = await import(pathToFileURL(runtime.entrypoint));
const kernel = await readFile(runtime.kernelPath);
const image = await readFile(imagePath);
const scratch = await mkdtemp(join(tmpdir(), "agent-inquiry-broker-"));
const initial = { root: 0, types: [
  { product: [1, 2, 1, 3, 1] }, "u64", { vector: { element: 4, maximum: 8 } }, "boolean",
  { product: [1, 1, 3, 1, 1, 3] },
] };
const resultSchema = { root: 0, types: [
  { product: [1, 2, 5, 4, 4, 4] }, "u8", { seq: 3 },
  { product: [4, 4] }, "u64", { seq: 6 },
  { product: [4, 7, 4, 8] }, { product: [4, 4] }, "boolean",
] };
const demand = (input = 7n, local = 10n, reusable = true, repeat = false) =>
  [input, local, reusable, 0n, 1n, repeat];
const ranked = (input, local, priority, cost) => [input, local, true, priority, cost, false];
const v = (tag, value = null) => ({ tag, value });
const summaries = [];

async function invoke(input, independent) {
  const fresh = await world.admitProcessKernel(kernel, { expectedSha256: runtime.kernelSha256 });
  const observed = await fresh.run(input);
  const filename = join(scratch, "input.pki2");
  await writeFile(filename, world.encodeInput({ ...input, mode: "run" }));
  const n = native(resolve(nativePath), filename);
  assert.equal(n.status, 0, n.stderr.toString());
  assert.deepEqual(n.stdout, Buffer.from(observed.bytes), "native/Node equality");
  if (!independent) return observed;
  const external = wasmtime(runtime, filename);
  assert.equal(external.status, 0, external.stderr.toString());
  assert.deepEqual(external.stdout, Buffer.from(observed.bytes), "Wasmtime/Node equality");
  return world.decodeOutcome(Uint8Array.from(external.stdout));
}

async function scenario(name, options, expected) {
  const ds = options.demands ?? [demand(), demand(7n, 20n)];
  let outcome = await invoke({ image,
    initialArgs: encodeValue(initial, [5n, ds, options.allowance ?? 20n,
      options.coalesce ?? true, options.policy ?? 0n]) }, options.independent);
  let acquisitions = 0, models = 0, maximumState = 0;
  const modelPayloads = [], observationIds = [], inputs = [], graphs = [];
  while (outcome.kind === "Requested") {
    assert(acquisitions + models < 40, `${name}: unexpected nontermination`);
    maximumState = Math.max(maximumState, outcome.state.length);
    const request = world.decodeRequest(outcome.request);
    const payload = decodeValue(decodeSchema(request.payloadSchema), request.payload);
    let reply;
    if (request.semanticIdentity === "agent.probe.broker.experiment.v1") {
      acquisitions++;
      const [subject, key, supplied, occurrence] = payload;
      assert.deepEqual(key, [subject, supplied[0]]);
      assert.equal(occurrence, BigInt(acquisitions));
      inputs.push(supplied[0]);
      // Actual numerical tool: the demand selects the measurement input.
      const measured = subject + supplied[0] * supplied[0];
      reply = [subject, key, occurrence, options.completion === undefined
        ? v(0, measured + (options.conflict ? BigInt(acquisitions - 1) : 0n))
        : v(options.completion)];
      if (options.mutate) options.mutate(reply);
    } else {
      assert.equal(request.semanticIdentity, "agent.probe.broker.model.v1");
      models++;
      modelPayloads.push(payload[0]);
      observationIds.push(payload[1]);
      reply = 1n;
    }
    if (options.inspect && graphs.length < 2) {
      const snapshot = join(scratch, "state.pst2");
      await writeFile(snapshot, outcome.state);
      const graph = JSON.parse(execFileSync(resolve(inspectorPath), ["inspect-state", snapshot]));
      graphs.push(graph);
      assert.equal(graph.packages, graphs.length === 1 ? ds.length : ds.length - 1);
    }
    const encoded = world.encodeResult(outcome.request,
      encodeValue(decodeSchema(request.resumeSchema), reply));
    outcome = await invoke({ image: Uint8Array.from(image), state: outcome.state, result: encoded },
      options.independent);
  }
  assert.equal(outcome.kind, "Completed", name);
  const [status, findings, records, spent, reused, recipients] = decodeValue(resultSchema, outcome.value);
  assert.equal(status, expected.status ?? 0, `${name}: status`);
  assert.deepEqual(findings, expected.findings, `${name}: findings`);
  assert.equal(acquisitions, expected.acquisitions, `${name}: physical tool operations`);
  assert.equal(spent, BigInt(acquisitions), `${name}: authored acquisition accounting`);
  assert.equal(reused, BigInt(expected.reuses ?? 0), `${name}: cache passes`);
  assert.equal(records.length, expected.records ?? acquisitions, `${name}: evidence records`);
  if (expected.modelPayloads) assert.deepEqual(modelPayloads, expected.modelPayloads);
  if (expected.observationIds) assert.deepEqual(observationIds, expected.observationIds);
  if (expected.inputs) assert.deepEqual(inputs, expected.inputs);
  if (expected.recipients !== undefined) assert.equal(recipients, BigInt(expected.recipients));
  summaries.push({ name, status, acquisitions, models, maximumState, graphs,
    records: records.length, reusePasses: Number(reused), recipients: Number(recipients),
    observationIds: observationIds.map(Number) });
}

try {
  await scenario("shared", { independent: true, inspect: true }, {
    findings: [[1n, 65n], [2n, 75n]], acquisitions: 1, recipients: 2,
    modelPayloads: [64n, 74n], observationIds: [1n, 1n],
  });
  await scenario("coalescing-ablation", { coalesce: false, independent: true }, {
    findings: [[1n, 65n], [2n, 75n]], acquisitions: 2, recipients: 2,
    observationIds: [1n, 2n],
  });
  await scenario("fresh", { demands: [demand(7n, 10n, false), demand(7n, 20n, false)] }, {
    findings: [[1n, 65n], [2n, 75n]], acquisitions: 2, observationIds: [1n, 2n],
  });
  await scenario("different-input", { demands: [demand(), demand(9n, 20n)] }, {
    findings: [[1n, 65n], [2n, 107n]], acquisitions: 2, inputs: [7n, 9n],
  });
  await scenario("requirement-before-sharing", { demands: [
    ranked(9n, 10n, 0n, 10n), ranked(7n, 20n, 1n, 1n), ranked(7n, 30n, 1n, 1n),
  ] }, { findings: [[1n, 97n], [2n, 75n], [3n, 85n]], acquisitions: 2, inputs: [9n, 7n] });
  await scenario("discrimination-before-cost", { demands: [
    ranked(9n, 10n, 1n, 0n), ranked(7n, 20n, 1n, 50n), ranked(7n, 30n, 1n, 50n),
  ] }, { findings: [[2n, 75n], [3n, 85n], [1n, 97n]], acquisitions: 2, inputs: [7n, 9n] });
  await scenario("shared-count-is-not-discrimination", { demands: [
    ranked(9n, 10n, 1n, 0n), ranked(7n, 20n, 1n, 50n), ranked(7n, 20n, 1n, 50n),
  ] }, { findings: [[1n, 97n], [2n, 75n], [3n, 75n]], acquisitions: 2, inputs: [9n, 7n] });
  await scenario("cost-before-age", { demands: [
    ranked(9n, 10n, 1n, 10n), ranked(7n, 20n, 1n, 1n),
  ] }, { findings: [[2n, 75n], [1n, 97n]], acquisitions: 2, inputs: [7n, 9n] });
  await scenario("reuse-before-new-work", { independent: true,
    demands: [demand(7n, 10n, true, true), demand(9n, 20n)] }, {
    findings: [[1n, 130n], [2n, 107n]], acquisitions: 2, reuses: 1,
    recipients: 3, modelPayloads: [64n, 64n, 106n], observationIds: [1n, 1n, 2n],
  });
  await scenario("deny-without-execution", { demands: [demand(0n), demand()] }, {
    findings: [[1n, 900n], [2n, 65n]], acquisitions: 1,
  });
  await scenario("stale-selection", { policy: 999n }, {
    status: 3, findings: [], acquisitions: 0,
  });
  await scenario("allowance-stop", { allowance: 0n }, {
    status: 2, findings: [], acquisitions: 0,
  });
  await scenario("stop-after-new-offer", { allowance: 1n,
    demands: [demand(7n, 10n, true, true)] }, {
    status: 2, findings: [], acquisitions: 1,
  });
  for (const [name, mutate] of [
    ["wrong-subject", reply => { reply[0] = 6n; }],
    ["wrong-key", reply => { reply[1][1] = 9n; }],
    ["wrong-occurrence", reply => { reply[2] = 99n; }],
  ]) await scenario(name, { mutate }, { status: 4, findings: [], acquisitions: 1, records: 0 });
  await scenario("inconclusive", { completion: 1 }, {
    findings: [[1n, 901n], [2n, 901n]], acquisitions: 1, records: 0,
  });
  await scenario("transient-is-not-cached", { completion: 1,
    demands: [demand(7n, 10n, true, true)] }, {
    findings: [[1n, 1802n]], acquisitions: 2, records: 0,
  });
  await scenario("unavailable", { completion: 2 }, {
    status: 5, findings: [], acquisitions: 1, records: 0,
  });
  await scenario("conflict", { coalesce: false, conflict: true, independent: true }, {
    status: 6, findings: [[1n, 65n]], acquisitions: 2, records: 2,
  });
  for (const count of [1, 2, 4, 8]) {
    await scenario(`scale-${count}`, {
      demands: Array.from({ length: count }, (_, i) => demand(7n, BigInt(i * 10))),
    }, {
      findings: Array.from({ length: count }, (_, i) => [BigInt(i + 1), BigInt(i * 10 + 55)]),
      acquisitions: 1, recipients: count,
    });
  }
  assert.throws(() => encodeValue(initial, [5n,
    Array.from({ length: 9 }, () => demand()), 20n, true, 0n]));
  console.log(JSON.stringify({ imageBytes: image.length,
    imageSha256: createHash("sha256").update(image).digest("hex"),
    kernelSha256: runtime.kernelSha256, summaries }));
} finally {
  await rm(scratch, { recursive: true, force: true });
}
