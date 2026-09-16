import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { verifyRuntime } from "../../tools/agent4/dependencies.mjs";
import { decodeSchema, decodeValue, encodeValue } from "../../runtime/values.mjs";
import { decodeModelInvocation, normalizeOpenAIResponses } from "../../runtime/model.mjs";
import { createInquiryExecutor, acceptanceContract } from "../../runtime/inquiry.mjs";
import { executeInquiryRequest } from "../../runtime/inquiry_wire.mjs";
import { reset } from "../consumers/inquiry/fixtures/cases.mjs";
import { native, wasmtime } from "./independent/execute.mjs";

const [runtimePath, fixtures, nativePath, inspectorPath, ...extra] = process.argv.slice(2);
assert(runtimePath && fixtures && nativePath && inspectorPath && !extra.length);
const runtime = verifyRuntime(runtimePath), world = await import(pathToFileURL(runtime.entrypoint));
const kernel = await readFile(runtime.kernelPath), image = await readFile(join(fixtures, "repeated.bpi3"));
const schema = decodeSchema(await readFile(join(fixtures, "task-schema.bin")));
const requirements = await readFile(new URL("../consumers/inquiry/contract.txt", import.meta.url), "utf8");
const executor = await createInquiryExecutor(); assert.equal(executor.kind, "qualified");
const task = [["session.mjs", reset, executor.runner, requirements, acceptanceContract, true, "repeat-target", 0n],
  "fixture-model", 2, 12n, 4n, true, 7n, 0n, true, 2];
const scratch = await mkdtemp(join(tmpdir(), "inquiry-repeat-"));
const v = (tag, value = null) => ({ tag, value });
const statistics = { multiTemplates: 0, branchActivations: 0, transitions: 0 };
const boundaries = [], epochs = [], oldQuestions = [];
let turn = 1, models = 0, experiments = 0, cleanups = 0;

async function invoke(input) {
  const output = await (await world.admitProcessKernel(kernel, { expectedSha256: runtime.kernelSha256 })).run(input);
  const file = join(scratch, "input.pki2"); await writeFile(file, world.encodeInput({ ...input, mode: "run" }));
  const n = native(resolve(nativePath), file, true); assert.equal(n.status, 0, n.stderr.toString());
  assert.deepEqual(n.stdout, Buffer.from(output.bytes));
  const measured = JSON.parse(n.stderr);
  for (const key of Object.keys(statistics)) statistics[key] += measured[key];
  const w = wasmtime(runtime, file); assert.equal(w.status, 0, w.stderr.toString());
  assert.deepEqual(w.stdout, Buffer.from(output.bytes));
  return world.decodeOutcome(Uint8Array.from(w.stdout));
}

try {
  let outcome = await invoke({ image, initialArgs: encodeValue(schema, task) });
  while (outcome.kind === "Requested") {
    assert(turn <= 4);
    const request = world.decodeRequest(outcome.request);
    const payload = decodeValue(decodeSchema(request.payloadSchema), request.payload);
    let reply;
    if (request.semanticIdentity === "agent.interaction.exchange.v1.inquiry.repair.intent") {
      const q = payload[3];
      assert.equal(q[1], BigInt(turn)); assert.equal(q[0][7], BigInt(turn));
      assert.equal(q[0][0][7], BigInt(turn));
      if (oldQuestions.length) {
        const old = oldQuestions[0];
        await assert.rejects((await world.admitProcessKernel(kernel,
          { expectedSha256: runtime.kernelSha256 })).run({ image, state: outcome.state, result: old.encoded }), /InvalidResult/);
        const mismatched = await invoke({ image, state: outcome.state,
          result: world.encodeResult(outcome.request,
            encodeValue(decodeSchema(request.resumeSchema), v(0, [old.question, v(0, 1)]))) });
        assert.equal(mismatched.kind, "Requested");
        const next = world.decodeRequest(mismatched.request);
        assert.equal(next.semanticIdentity, "agent.interaction.exchange.v1.inquiry.repair.next-task");
        assert.equal(decodeValue(decodeSchema(next.payloadSchema), next.payload)[3].tag, 15);
      }
      reply = encodeValue(decodeSchema(request.resumeSchema), v(0, [q, v(0, 1)]));
      oldQuestions.push({ question: structuredClone(q), encoded: world.encodeResult(outcome.request, reply) });
    } else if (request.semanticIdentity === "agent.model.invoke.v3") {
      models++;
      const inv = decodeModelInvocation(request.payload);
      const match = inv.messages[4].content.match(/Investigation (\d+); version (\d+); current observation (\d+)/u);
      const [, id, , observation] = match.map(Number);
      const calls = id === 0 ? [1, 2].map(i => ["hypothesis", { explanation: `Repeated-task hypothesis ${i}` }])
        : observation === 0 ? [["prediction", { mode: 0, step: 0, field: "issued", expected: 0, requirement: 0 }],
          ["inspect", { value: "now" }]]
          : [["stop", { observation, reason: "This bounded inquiry remains unresolved." }]];
      if (observation) {
        const branch = inv.messages[5].content.match(/alternative (\d+); private before=(\d+); private after=(\d+)/u);
        assert(branch); assert.equal(Number(branch[2]), 10); assert.equal(Number(branch[3]), 10 + Number(branch[1]));
      }
      const provider = Buffer.from(JSON.stringify({ status: "completed", error: null, output: calls.map(([name, args], i) => ({
        type: "function_call", status: "completed", call_id: `same-provider-${i}`, name, arguments: JSON.stringify(args),
      })) }));
      reply = normalizeOpenAIResponses(provider, inv.normalizationLimits, inv.tools);
    } else if (request.semanticIdentity === "inquiry.repair.experiment.v1") {
      experiments++; epochs.push(Number(payload[0][7]));
      assert.equal(payload[0][7], BigInt(turn)); assert.equal(payload[3], 1n);
      reply = encodeValue(decodeSchema(request.resumeSchema), await executeInquiryRequest(executor, payload));
    } else if (request.semanticIdentity === "inquiry.repair.cleanup.v1") {
      cleanups++; reply = encodeValue(decodeSchema(request.resumeSchema), null);
    } else {
      assert.equal(request.semanticIdentity, "agent.interaction.exchange.v1.inquiry.repair.next-task");
      assert.equal(payload[3].tag, 1);
      const file = join(scratch, "boundary.pst2"); await writeFile(file, outcome.state);
      const graph = JSON.parse(execFileSync(resolve(inspectorPath), ["inspect-state", file]));
      for (const key of ["packages", "multiTemplates", "branches", "resources", "cells", "obligations"])
        assert.equal(graph[key], 0, `turn ${turn}: ${key}`);
      boundaries.push({ turn, stateBytes: outcome.state.length, ...graph });
      reply = encodeValue(decodeSchema(request.resumeSchema), turn === 4 ? v(1) : v(0, task));
      turn++;
    }
    outcome = await invoke({ image, state: outcome.state, result: world.encodeResult(outcome.request, reply) });
  }
  assert.equal(outcome.kind, "Completed"); assert.equal(Buffer.from(outcome.value).readBigUInt64LE(), 4n);
  assert.equal(models, 28); assert.equal(experiments, 4); assert.equal(cleanups, 8);
  assert.deepEqual(epochs, [1, 2, 3, 4]);
  assert.equal(statistics.multiTemplates, 8); assert.equal(statistics.branchActivations, 16);
  assert.equal(new Set(boundaries.map(x => x.nodes)).size, 1, "no retained graph growth between tasks");
  assert.equal(new Set(boundaries.map(x => x.stateBytes)).size, 1, "fixed retained state between identical tasks");
  console.log(JSON.stringify({ imageBytes: image.length, models, experiments, cleanups, epochs, statistics, boundaries }));
} finally { await rm(scratch, { recursive: true, force: true }); }
