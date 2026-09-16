// Prescribed provider proposals test the authored computation. The production
// adapter neither imports this fixture nor tracks investigator progression.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { verifyRuntime } from "../../tools/agent4/dependencies.mjs";
import { decodeSchema, decodeValue, encodeValue } from "../../runtime/values.mjs";
import { decodeModelInvocation, normalizeOpenAIResponses } from "../../runtime/model.mjs";
import { createInquiryExecutor, acceptanceContract } from "../../runtime/inquiry.mjs";
import { createInquiryDelivery } from "../../runtime/inquiry_delivery.mjs";
import { executeInquiryRequest } from "../../runtime/inquiry_wire.mjs";
import { reset, monotonic, bad } from "../consumers/inquiry/fixtures/cases.mjs";

const [runtimePath, fixturePath, nativePath, inspectorPath, ...extra] = process.argv.slice(2);
assert(runtimePath && fixturePath && !extra.length);
const { native, wasmtime } = nativePath ? await import("./independent/execute.mjs") : {};
const runtime = verifyRuntime(runtimePath);
const world = await import(pathToFileURL(runtime.entrypoint));
const kernel = await readFile(runtime.kernelPath);
const image = await readFile(join(fixturePath, "repair.bpi2"));
const taskSchema = decodeSchema(await readFile(join(fixturePath, "task-schema.bin")));
const outcomeSchema = decodeSchema(await readFile(join(fixturePath, "outcome-schema.bin")));
const requirements = await readFile(new URL("../consumers/inquiry/contract.txt", import.meta.url), "utf8");
const executor = await createInquiryExecutor();
assert.equal(executor.kind, "qualified", JSON.stringify(executor));
const scratch = await mkdtemp(join(tmpdir(), "inquiry-world-"));
const filename = join(scratch, "session.mjs");
await writeFile(filename, reset);
const targetIdentity = "isolated-inquiry-fixture";
const target = await createInquiryDelivery({ root: scratch, target: targetIdentity });
const v = (tag, value = null) => ({ tag, value });
const action = (name, args) => ({ name, args });
const issue = text => action("issue", { text, choice0: 1, choice1: 4,
  choice2: 0, choice3: 0, count: 2, label: "same" });
const encode = (request, choice) => action("encode", { request, choice });
const submit = reply => action("submit", { reply });
function repeated(expected) {
  return [action("prediction", { mode: 0, step: 4, field: "accepted", expected, requirement: 1 }),
    issue("same"), encode(0, 1), submit(1), issue("same"), submit(1), encode(3, 4), submit(5)];
}
function different(expected) {
  return [action("prediction", { mode: 0, step: 3, field: "accepted", expected, requirement: 5 }),
    issue("first"), encode(0, 1), issue("second"), submit(1), encode(2, 4), submit(4)];
}

function proposals(invocation) {
  const context = invocation.messages[4].content.match(/^Investigation (\d+); version (\d+); current observation (\d+)$/u);
  assert(context, invocation.messages[4].content);
  const [, id, version, observation] = context.map(Number);
  assert.equal(invocation.messages[1].content, requirements);
  assert.equal(invocation.messages[2].content, reset);
  const summary = invocation.messages[5].content;
  if (id === 0) return ["Occurrence identity may be recreated for repeated tasks.",
    "Binding validation may be absent.", "The adapter may rewrite received replies."].map(explanation =>
    action("hypothesis", { explanation }));
  if (observation === 0) return id === 3 ? different(1) : repeated(id === 1 ? 1 : 0);
  if (id === 2) {
    assert(summary.includes("contradicted"));
    return [action("stop", { reason: "My stated prediction was contradicted; this explanation remains inadequate.", observation })];
  }
  if (id === 3) {
    assert(summary.includes("contradicted"));
    return [action("stop", { reason: "The changed-question trace rejected the old reply; adapter rebinding is unsupported here.", observation })];
  }
  if (observation === 1) {
    assert(summary.includes("matched"));
    return different(0);
  }
  if (observation === 2 && version === 1) return [action("revise", {
    explanation: "Binding checks work across different questions; repetition appears to recreate an occurrence.", observation,
  })];
  if (observation === 2 && version === 2) return [action("repair", { source: bad.rejectAll, observation })];
  if (observation === 3 && version === 2) {
    assert(summary.includes("current_reply_rejected"));
    assert.equal(invocation.messages[6].content, bad.rejectAll);
    return [action("repair", { source: monotonic, observation })];
  }
  throw new Error(`unexpected program progression: ${id}/${version}/${observation}`);
}

const records = [], cleanup = [];
let models = 0, experiments = 0, maximumState = 0, providerBytes = 0, approvals = 0, writes = 0;
let approvalPending, approvalChallenge, oldResult;
async function invoke(input, transfer) {
  const outcome = await (await world.admitProcessKernel(kernel, { expectedSha256: runtime.kernelSha256 })).run(input);
  if (nativePath) {
    const file = join(scratch, "input.pki2");
    await writeFile(file, world.encodeInput({ ...input, mode: "run" }));
    const n = native(resolve(nativePath), file);
    assert.equal(n.status, 0, n.stderr.toString());
    assert.deepEqual(n.stdout, Buffer.from(outcome.bytes), "native/Node equality");
    if (transfer) {
      const w = wasmtime(runtime, file);
      assert.equal(w.status, 0, w.stderr.toString());
      assert.deepEqual(w.stdout, Buffer.from(outcome.bytes), "Wasmtime/Node equality");
      return world.decodeOutcome(Uint8Array.from(w.stdout));
    }
  }
  return outcome;
}
try {
  const task = [["session.mjs", reset, executor.runner, requirements, acceptanceContract, true, targetIdentity, 0n],
    "fixture-model", 3, 24n, 12n, true, 7n, 1n, false, 0];
  let outcome = await invoke({ image, initialArgs: encodeValue(taskSchema, task) }, true);
  while (outcome.kind === "Requested") {
    assert(models + experiments + cleanup.length < 30);
    maximumState = Math.max(maximumState, outcome.state.length);
    const request = world.decodeRequest(outcome.request);
    let reply;
    if (request.semanticIdentity === "agent.model.invoke.v3") {
      models++;
      const invocation = decodeModelInvocation(request.payload);
      const calls = proposals(invocation);
      const bytes = Buffer.from(JSON.stringify({ status: "completed", error: null,
        output: calls.map(({ name, args }, index) => ({ type: "function_call", status: "completed",
          call_id: `repeated-provider-${index}`, name, arguments: JSON.stringify(args) })) }));
      providerBytes += bytes.length;
      reply = normalizeOpenAIResponses(bytes, invocation.normalizationLimits, invocation.tools);
      records.push({ model: models, context: invocation.messages[4].content,
        proposals: calls.map(x => x.name), stateBytes: outcome.state.length });
    } else {
      const payload = decodeValue(decodeSchema(request.payloadSchema), request.payload);
      if (request.semanticIdentity === "inquiry.repair.experiment.v1") {
        experiments++;
        reply = await executeInquiryRequest(executor, payload);
        records.push({ experiment: experiments, kind: payload[2].tag, occurrence: Number(payload[3]),
          stateBytes: outcome.state.length });
      } else if (request.semanticIdentity === "inquiry.repair.read.v1") {
        assert.equal(payload[0], "session.mjs"); assert.equal(payload[5], targetIdentity);
        const current = await target.read(payload);
        assert.equal(current.kind, "success");
        reply = v(0, current.proposal);
      } else if (request.semanticIdentity === "agent.approval.issue.v1.inquiry.repair.change") {
        assert.equal(payload[2][0], monotonic);
        assert.deepEqual(payload[2].slice(1, 4), [4n, 1n, 2n]);
        assert.deepEqual(payload[2][4], [true, 16n, 0n, ""]);
        assert.equal(payload[2][5], acceptanceContract);
        assert.equal(payload[2][6], executor.runner);
        reply = 1n;
      } else if (request.semanticIdentity === "agent.interaction.exchange.v1.inquiry.repair.change") {
        approvals++;
        const challenge = payload[3];
        assert.equal(challenge[1][2][0], monotonic);
        assert.equal(challenge[1][1][0], reset);
        approvalPending = { state: Uint8Array.from(outcome.state), request: Uint8Array.from(outcome.request) };
        approvalChallenge = structuredClone(challenge);
        reply = v(0, [challenge, 7n, v(0)]);
      } else if (request.semanticIdentity === "inquiry.repair.replace.v1") {
        writes++;
        const [path, base, candidate, principal, attempt] = payload;
        assert.equal(principal, 7n); assert.equal(attempt, 1n);
        assert.equal(candidate[0], monotonic);
        assert.equal(payload[5], targetIdentity);
        const delivered = await target.replace(payload);
        assert.equal(delivered.kind, "success");
        reply = v(0, [delivered.observation.content, delivered.observation.digest]);
      } else {
        assert.equal(request.semanticIdentity, "inquiry.repair.cleanup.v1");
        cleanup.push(Number(payload));
        if (inspectorPath) {
          const file = join(scratch, "cleanup.pst2"); await writeFile(file, outcome.state);
          const graph = JSON.parse(execFileSync(resolve(inspectorPath), ["inspect-state", file]));
          assert.equal(graph.packages, payload === 2n ? 2 : payload === 3n ? 1 : 0);
        }
        reply = null;
      }
      reply = encodeValue(decodeSchema(request.resumeSchema), reply);
    }
    if (inspectorPath && experiments === 1 && records.at(-1)?.experiment === 1) {
      const file = join(scratch, "shared.pst2"); await writeFile(file, outcome.state);
      const graph = JSON.parse(execFileSync(resolve(inspectorPath), ["inspect-state", file]));
      assert.equal(graph.packages, 3);
    }
    const encoded = world.encodeResult(outcome.request, reply);
    oldResult ??= Uint8Array.from(encoded);
    outcome = await invoke({ image, state: outcome.state, result: encoded }, true);
  }
  assert.equal(outcome.kind, "Completed", JSON.stringify(outcome));
  const result = decodeValue(outcomeSchema, outcome.value);
  assert.equal(result.tag, 0);
  assert.equal(result.value[0][0], monotonic);
  assert.equal(result.value[1][2][0], monotonic);
  assert.deepEqual(result.value[1][2][4], [true, 16n, 0n, ""]);
  assert.equal(await readFile(filename, "utf8"), monotonic);
  assert.equal(models, 10); assert.equal(experiments, 4);
  assert.deepEqual(cleanup, [2, 3, 1]);
  assert.equal(approvals, 1); assert.equal(writes, 1);
  // These independent negative tests branch a saved, pre-grant approval fixture.
  // The production inquiry never clones a grant or an external execution.
  const rejectedApprovals = [];
  const stale = structuredClone(approvalChallenge); stale[0] += 1n;
  const foreign = structuredClone(approvalChallenge); foreign[1][5] = "foreign-target";
  const amended = structuredClone(approvalChallenge[1]); amended[2][0] = bad.acceptAll;
  for (const [name, answer, tag] of [
    ["declined", v(0, [approvalChallenge, 7n, v(1, "declined")]), 3],
    ["wrong-principal", v(0, [approvalChallenge, 9n, v(0)]), 1],
    ["stale-challenge", v(0, [stale, 7n, v(0)]), 4],
    ["foreign-target", v(0, [foreign, 7n, v(0)]), 4],
    ["unvalidated-amendment", v(0, [approvalChallenge, 7n, v(2, amended)]), 1],
  ]) {
    await writeFile(filename, reset);
    const schema = world.decodeRequest(approvalPending.request).resumeSchema;
    const checked = await invoke({ image, state: approvalPending.state,
      result: world.encodeResult(approvalPending.request, encodeValue(decodeSchema(schema), answer)) }, true);
    assert.equal(checked.kind, "Completed", `${name}: no new challenge or commit for invalid authority/evidence`);
    assert.equal(decodeValue(outcomeSchema, checked.value).tag, tag, name);
    assert.equal(await readFile(filename, "utf8"), reset, name);
    rejectedApprovals.push(name);
  }
  await assert.rejects(invoke({ image, state: approvalPending.state, result: oldResult }, false), /InvalidResult/);
  const context = world.decodeRequest(approvalPending.request);
  const allowed = world.encodeResult(approvalPending.request,
    encodeValue(decodeSchema(context.resumeSchema), v(0, [approvalChallenge, 7n, v(0)])));
  const changed = "External edit while approval was pending.\n";
  await writeFile(filename, changed);
  const pendingCommit = await invoke({ image, state: approvalPending.state, result: allowed }, true);
  assert.equal(pendingCommit.kind, "Requested");
  const commit = world.decodeRequest(pendingCommit.request);
  assert.equal(commit.semanticIdentity, "inquiry.repair.replace.v1");
  const proposal = decodeValue(decodeSchema(commit.payloadSchema), commit.payload);
  const conflict = await target.replace(proposal);
  assert.equal(conflict.kind, "conflict");
  const conflicted = await invoke({ image, state: pendingCommit.state,
    result: world.encodeResult(pendingCommit.request, encodeValue(decodeSchema(commit.resumeSchema),
      v(1, [conflict.observation.content, conflict.observation.digest]))) }, true);
  assert.equal(decodeValue(outcomeSchema, conflicted.value).tag, 2);
  assert.equal(await readFile(filename, "utf8"), changed);
  await assert.rejects(target.replace([...proposal.slice(0, 5), "other-scope"]), /foreign delivery scope/);
  console.log(JSON.stringify({ imageBytes: image.length,
    imageSha256: createHash("sha256").update(image).digest("hex"), maximumState,
    models, experiments, cleanup, approvals, writes, rejectedApprovals,
    changedDuringApproval: "conflict", providerBytes, executor: executor.metrics(), records }));
} finally { await rm(scratch, { recursive: true, force: true }); }
