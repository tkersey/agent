// Additional externally driven cases. The unchanged image owns every decision.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { verifyRuntime } from "../../tools/agent4/dependencies.mjs";
import { decodeSchema, decodeValue, encodeValue } from "../../runtime/values.mjs";
import { decodeModelInvocation, normalizeOpenAIResponses, performModelInvocation,
  encodeOpenAIResponsesRequest } from "../../runtime/model.mjs";
import { createInquiryExecutor, acceptanceContract } from "../../runtime/inquiry.mjs";
import { createInquiryDelivery } from "../../runtime/inquiry_delivery.mjs";
import { executeInquiryRequest } from "../../runtime/inquiry_wire.mjs";
import { reset, monotonic, rebinding, tickets, bad } from "../consumers/inquiry/fixtures/cases.mjs";
import { native, wasmtime } from "./independent/execute.mjs";

const [runtimePath, fixturePath, nativePath, inspectorPath, ...extra] = process.argv.slice(2);
const comparisonOnly = extra.length === 1 && extra[0] === "--comparison-only";
assert(runtimePath && fixturePath && nativePath && inspectorPath && (!extra.length || comparisonOnly));
const runtime = verifyRuntime(runtimePath);
const world = await import(pathToFileURL(runtime.entrypoint));
const kernel = await readFile(runtime.kernelPath);
const image = await readFile(join(fixturePath, "repair.bpi2"));
const taskSchema = decodeSchema(await readFile(join(fixturePath, "task-schema.bin")));
const resultSchema = decodeSchema(await readFile(join(fixturePath, "outcome-schema.bin")));
const requirements = await readFile(new URL("../consumers/inquiry/contract.txt", import.meta.url), "utf8");
const executor = await createInquiryExecutor();
assert.equal(executor.kind, "qualified", JSON.stringify(executor));
const v = (tag, value = null) => ({ tag, value });
const call = (name, args) => ({ name, args });
const stop = (observation, reason = "The current explanations are inadequate.") =>
  [call("stop", { reason, observation })];
const hypotheses = count => Array.from({ length: count }, (_, i) =>
  call("hypothesis", { explanation: `Working explanation ${i + 1}; test it against real observations.` }));
function trace(expected, different = false) {
  const issue = text => call("issue", { text, choice0: 6, choice1: 17, choice2: 0,
    choice3: 0, count: 2, label: "reused-provider-label" });
  return [call("prediction", { mode: 1, step: 4, field: "accepted", expected, requirement: 1 }),
    issue("changing-values"), call("encode", { request: 0, choice: 6 }), call("submit", { reply: 1 }),
    issue(different ? "another-question" : "changing-values"), call("submit", { reply: 1 }),
    call("encode", { request: 3, choice: 17 }), call("submit", { reply: 5 })];
}
const summaries = [];

async function scenario(name, options, expected) {
  const selectedImage = options.strategy === "react" ? await readFile(join(fixturePath, "react.bpi2")) : image;
  const scratch = await mkdtemp(join(tmpdir(), "inquiry-case-"));
  const filename = join(scratch, "session.mjs");
  const source = options.source ?? reset;
  const targetId = options.target ?? `fixture-${name}`;
  const delivery = await createInquiryDelivery({ root: scratch, target: targetId });
  await writeFile(filename, source);
  const initial = [["session.mjs", source, executor.runner, requirements, acceptanceContract, true, targetId, 0n],
    "fixture-model", options.count ?? 1, options.passes ?? 24n, options.turns ?? 12n,
    options.coalesce ?? true, 7n, 1n, options.explore ?? false, options.intent ?? 0];
  options.changeTask?.(initial);
  const observed = [], cleanup = [], graphs = [], checks = [];
  const pendingPlans = new Map(), recipients = [], seenEvidence = new Set();
  let demands = 0, reuseHits = 0, revisions = 0;
  const statistics = { multiTemplates: 0, branchActivations: 0, transitions: 0 };
  let models = 0, experiments = 0, approvals = 0, questions = 0, writes = 0, maximumState = 0;
  let semanticRequestBytes = 0, semanticResponseBytes = 0, providerRequestBytes = 0, providerResponseBytes = 0;
  let cancelled = false, peakWorkingBytes = 0, addedNodes = 0, copiedBlobBytes = 0;
  let completedValueBytes = 0;
  const before = executor.metrics();
  async function invoke(input) {
    input = { ...input, image: selectedImage };
    const output = await (await world.admitProcessKernel(kernel,
      { expectedSha256: runtime.kernelSha256 })).run(input);
    const file = join(scratch, "input.pki2");
    await writeFile(file, world.encodeInput({ ...input, mode: "run" }));
    const n = native(resolve(nativePath), file, true);
    assert.equal(n.status, 0, n.stderr.toString());
    assert.deepEqual(n.stdout, Buffer.from(output.bytes), `${name}: native equality`);
    const counts = JSON.parse(n.stderr);
    peakWorkingBytes = Math.max(peakWorkingBytes, counts.peakWorkingBytes);
    addedNodes += counts.addedNodes; copiedBlobBytes += counts.copiedBlobBytes;
    for (const key of Object.keys(statistics)) statistics[key] += counts[key];
    if (!options.independent) return output;
    const w = wasmtime(runtime, file);
    assert.equal(w.status, 0, w.stderr.toString());
    assert.deepEqual(w.stdout, Buffer.from(output.bytes), `${name}: independent equality`);
    return world.decodeOutcome(Uint8Array.from(w.stdout));
  }
  try {
    let outcome = await invoke({ image, initialArgs: encodeValue(taskSchema, initial) });
    while (outcome.kind === "Requested") {
      assert(models + experiments + cleanup.length < 80, `${name}: resource stop missing`);
      maximumState = Math.max(maximumState, outcome.state.length);
      const request = world.decodeRequest(outcome.request);
      const payload = decodeValue(decodeSchema(request.payloadSchema), request.payload);
      if (!cancelled && options.cancelAt === request.semanticIdentity) {
        cancelled = true;
        outcome = await invoke({ image, state: outcome.state, cancel: "operator cancellation" });
        continue;
      }
      let reply;
      if (request.semanticIdentity === "agent.model.invoke.v3") {
        models++; semanticRequestBytes += request.payload.length;
        const invocation = decodeModelInvocation(request.payload);
        providerRequestBytes += encodeOpenAIResponsesRequest(invocation).length;
        const match = invocation.messages[4].content.match(/Investigation (\d+); version (\d+); current observation (\d+)/u);
        assert(match);
        const [, id, version, observation] = match.map(Number);
        assert.equal(invocation.messages[2].content, source);
        const context = { id, version, observation, summary: invocation.messages[5].content, invocation, models };
        if (observation && ["prediction", "repair"].includes(pendingPlans.get(id))) {
          const occurrence = `${id}:${observation}`;
          if (seenEvidence.has(occurrence)) reuseHits++;
          seenEvidence.add(occurrence);
          recipients.push({ investigation: id, observation });
        }
        if (options.explore && observation > 0) {
          const file = join(scratch, "model.pst2"); await writeFile(file, outcome.state);
          const graph = JSON.parse(execFileSync(resolve(inspectorPath), ["inspect-state", file]));
          assert.equal(graph.multiTemplates, 1); assert.equal(graph.packages, 1);
          graphs.push({ pendingModel: true, ...graph });
        }
        let proposals = id === 0 ? hypotheses(options.count ?? 1) : options.provider(context);
        const nextPlan = proposals?.[0]?.name;
        if (["prediction", "repair"].includes(nextPlan)) demands++;
        if (nextPlan === "revise") revisions++;
        pendingPlans.set(id, nextPlan);
        observed.push({ id, version, observation, proposals: proposals?.map(x => x.name) ?? [] });
        if (options.interrupted && id !== 0) {
          reply = await performModelInvocation(request.payload, {
            endpoint: "http://127.0.0.1:1/v1/responses", signal: AbortSignal.abort(),
          });
        } else {
          const envelope = options.envelope?.(context, proposals) ?? {
            status: "completed", error: null,
            output: proposals.map(({ name, args }, i) => ({ type: "function_call", status: "completed",
              call_id: `same-provider-${i}`, name, arguments: JSON.stringify(args) })),
          };
          const bytes = Buffer.from(JSON.stringify(envelope));
          providerResponseBytes += bytes.length;
          reply = normalizeOpenAIResponses(bytes, invocation.normalizationLimits, invocation.tools);
        }
        semanticResponseBytes += reply.length;
        if (id !== 0 && options.normalized) {
          const normalized = decodeValue(decodeSchema(request.resumeSchema), reply);
          assert.equal(normalized.tag, options.normalized.tag, `${name}: normalization lane`);
          if (options.normalized.argumentFailure !== undefined) {
            const decoded = normalized.value[0][0].value[4];
            assert.deepEqual(decoded, v(1, options.normalized.argumentFailure), `${name}: argument failure`);
          }
          if (options.normalized.transport !== undefined)
            assert.equal(normalized.value, options.normalized.transport);
        }
      } else {
        if (request.semanticIdentity === "agent.interaction.exchange.v1.inquiry.repair.intent") {
          questions++;
          const question = payload[3];
          const normalized = structuredClone(initial); normalized[0][7] = 1n; normalized[7] = 1n;
          assert.deepEqual(question[0], normalized); assert.equal(question[1], 1n);
          assert.deepEqual(question[3], [1, 2]); assert.equal(approvals, 0);
          if (options.intentReply === "abort") reply = v(1);
          else if (options.intentReply === "close") reply = v(2);
          else {
            const echoed = structuredClone(question);
            if (options.intentReply === "wrong-context") echoed[1] = 99n;
            const choice = options.intentReply === "other" ? v(1) : options.intentReply === "unsure"
              ? v(2) : v(0, options.intentReply === "unoffered" ? 99 : options.intentChoice ?? 2);
            reply = v(0, [echoed, choice]);
          }
        } else if (request.semanticIdentity === "inquiry.repair.experiment.v1") {
          experiments++;
          if (options.scaling) {
            const file = join(scratch, "parked.pst2"); await writeFile(file, outcome.state);
            const graph = JSON.parse(execFileSync(resolve(inspectorPath), ["inspect-state", file]));
            assert.equal(graph.packages, options.count);
            graphs.push({ pendingExperiment: true, ...graph });
          }
          observed.push({ experiment: experiments, kind: payload[2].tag, occurrence: Number(payload[3]) });
          reply = options.experiment ? await options.experiment(payload) : await executeInquiryRequest(executor, payload);
          if (reply[3].tag === 0 && reply[3].value.tag === 1) checks.push({
            passed: reply[3].value.value[0], completed: Number(reply[3].value.value[1]),
            failed: Number(reply[3].value.value[2]),
          });
        } else if (request.semanticIdentity === "inquiry.repair.cleanup.v1") {
          cleanup.push(Number(payload)); reply = null;
          if (options.inspect) {
            const file = join(scratch, "state.pst2"); await writeFile(file, outcome.state);
            graphs.push(JSON.parse(execFileSync(resolve(inspectorPath), ["inspect-state", file])));
          }
        } else if (request.semanticIdentity === "inquiry.repair.read.v1") {
          if (options.changeBeforeRead) await writeFile(filename, "external change\n");
          const read = await delivery.read(payload);
          assert.equal(read.kind, "success"); reply = v(0, read.proposal);
        } else if (request.semanticIdentity === "agent.approval.issue.v1.inquiry.repair.change") {
          reply = BigInt(approvals + 1);
        } else if (request.semanticIdentity === "agent.interaction.exchange.v1.inquiry.repair.change") {
          approvals++; reply = v(0, [payload[3], 7n, v(0)]);
        } else {
          assert.equal(request.semanticIdentity, "inquiry.repair.replace.v1");
          writes++;
          const delivered = await delivery.replace(payload);
          assert.equal(delivered.kind, "success");
          reply = v(0, [delivered.observation.content, delivered.observation.digest]);
        }
        reply = encodeValue(decodeSchema(request.resumeSchema), reply);
      }
      outcome = await invoke({ image, state: outcome.state, result: world.encodeResult(outcome.request, reply) });
    }
    if (options.cancelAt) {
      assert.equal(outcome.kind, "Cancelled"); assert.equal(outcome.reason, "operator cancellation");
      assert.deepEqual(outcome.cleanupFailures, []);
    } else {
      assert.equal(outcome.kind, "Completed", name);
      completedValueBytes = outcome.value.length;
      const result = decodeValue(resultSchema, outcome.value);
      assert.equal(result.tag, expected.tag, `${name}: result`);
      if (expected.replacement) {
        assert.equal(result.value[1][2][0], expected.replacement);
        assert.equal(result.value[0][0], expected.tag === 9 ? source : expected.replacement);
        const candidate = result.value[1][2];
        recipients.push({ investigation: Number(candidate[2]), observation: Number(candidate[1]), accepted: true });
      }
    }
    assert.equal(outcome.state, undefined, "terminal outcomes retain no continuation State");
    assert.equal(models, expected.models, `${name}: model requests`);
    assert.equal(experiments, expected.experiments, `${name}: experiments`);
    assert.equal(approvals, expected.approvals ?? 0); assert.equal(writes, expected.writes ?? 0);
    assert.equal(questions, expected.questions ?? 0);
    assert.deepEqual([...cleanup].sort((a, b) => a - b), expected.cleanup ?? [1]);
    assert.equal(statistics.multiTemplates, expected.templates ?? 0);
    assert.equal(statistics.branchActivations, expected.activations ?? 0);
    if (options.explore) for (const graph of graphs.filter(g => !g.pendingModel)) {
      assert.equal(graph.multiTemplates, 0); assert.equal(graph.cells, 0);
    }
    assert.equal(await readFile(filename, "utf8"), options.changeBeforeRead ? "external change\n"
      : expected.writes ? expected.replacement : source);
    const summary = { name, imageSha256: createHash("sha256").update(selectedImage).digest("hex"), strategy: options.strategy ?? "inquiry", imageBytes: selectedImage.length,
      completedValueBytes, retainedStateBytes: 0, peakWorkingBytes, addedNodes, copiedBlobBytes,
      demands, reuseHits, recipients, revisions, checks,
      investigationStarts: new Set(observed.filter(x => x.id > 0 && x.observation === 0).map(x => x.id)).size,
      cleanupCompletions: cleanup.length,
      explicitRetirements: options.strategy === "react" ? 0
        : observed.filter(x => x.proposals?.[0] === "stop").length,
      result: options.cancelAt ? "Cancelled" : expected.tag, models, experiments,
      approvals, questions, writes, maximumState, cleanup, graphs, observed, semanticRequestBytes, semanticResponseBytes,
      providerRequestBytes, providerResponseBytes,
      physicalExecutions: executor.metrics().physicalExecutions - before.physicalExecutions, statistics };
    summaries.push(summary);
    return summary;
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

if (!comparisonOnly) {
await scenario("rebinding-sibling", { source: rebinding, independent: true, provider: c => {
  if (!c.observation) return trace(1);
  if (c.observation === 1) return trace(0, true);
  if (c.observation === 2 && c.version === 1) {
    assert(c.summary.includes("contradicted"));
    return [call("revise", { explanation: "The different-question probe also accepts stale data; adapter association is suspect.", observation: 2 })];
  }
  if (c.observation === 2) return [call("prediction", { mode: 1, step: 0, field: "issued", expected: 0, requirement: 5 }), call("inspect", { value: "now" })];
  return [call("repair", { source: tickets, observation: c.observation })];
} }, { tag: 0, models: 6, experiments: 4, approvals: 1, writes: 1, replacement: tickets });

await scenario("already-satisfied", { source: monotonic, independent: true, provider: c =>
  !c.observation ? trace(1) : [call("repair", { source: monotonic, observation: c.observation })],
}, { tag: 7, models: 3, experiments: 2, replacement: monotonic });

await scenario("inadequate-initial-set", { count: 3, inspect: true, provider: c =>
  !c.observation ? trace(0) : stop(c.observation),
}, { tag: 1, models: 7, experiments: 1, cleanup: [1, 2, 3] });

const closedProbe = expected => [call("prediction", { mode: 0, step: 1,
  field: "issue_returned_null", expected, requirement: 7 }), call("close", { value: "now" }),
  call("issue", { text: "closed", choice0: 1, choice1: 0, choice2: 0, choice3: 0, count: 1, label: "sentinel" })];
await scenario("closed-null-observation", { independent: true, provider: c => {
  if (!c.observation) return closedProbe(1);
  assert(c.summary.includes("matched")); assert(c.summary.includes("\n1 null "));
  return stop(c.observation);
} }, { tag: 1, models: 3, experiments: 1 });
await scenario("invalid-null-prediction", { provider: () => closedProbe(2) },
  { tag: 1, models: 2, experiments: 0 });
await scenario("reject-nonnull-after-close", { independent: true, provider: c => {
  if (!c.observation) return [call("repair", { source: bad.closedZeroObject, observation: 0 })];
  assert(c.summary.includes("issue_after_close"));
  return stop(c.observation);
} }, { tag: 1, models: 3, experiments: 1 });

await scenario("multi-with-retained-futures", { count: 2, explore: true, independent: true, inspect: true,
  provider: c => {
    if (!c.observation) return trace(c.id - 1);
    const branch = c.summary.match(/alternative (\d+); private before=(\d+); private after=(\d+)/u);
    assert(branch); assert.equal(Number(branch[2]), 10);
    assert.equal(Number(branch[3]), 10 + Number(branch[1]));
    if (c.observation === 1) return trace(0, true);
    return stop(c.observation, `Alternative ${branch[1]} remains qualified and inconclusive.`);
  },
}, { tag: 1, models: 11, experiments: 2, cleanup: [1, 2], templates: 4, activations: 8 });

for (const coalesce of [true, false]) await scenario(`application-coalescing-${coalesce}`, {
  count: 2, coalesce, provider: c => !c.observation ? trace(c.id - 1) : stop(c.observation),
}, { tag: 1, models: 5, experiments: coalesce ? 1 : 2, cleanup: [1, 2] });

for (const count of [1, 2, 4, 8]) await scenario(`application-scaling-${count}`, {
  count, scaling: true, provider: c => !c.observation ? trace(c.id % 2) : stop(c.observation),
}, { tag: 1, models: 1 + 2 * count, experiments: 1,
  cleanup: Array.from({ length: count }, (_, i) => i + 1) });

for (const name of ["foreign-observation", "invalid-reference", "invalid-boolean-prediction", "mixed-plan"]) {
  await scenario(name, { provider: () => name === "foreign-observation"
    ? [call("repair", { source: monotonic, observation: 99 })]
    : name === "invalid-reference" ? [trace(0)[0], call("submit", { reply: 23 })]
      : name === "invalid-boolean-prediction" ? trace(2)
        : [call("repair", { source: monotonic, observation: 0 }), call("inspect", { value: "now" })],
  }, { tag: 1, models: 2, experiments: 0 });
}
for (const name of ["refusal", "unknown-action", "wrong-argument-type", "malformed-json", "interrupted"]) {
  await scenario(name, { provider: () => trace(0), interrupted: name === "interrupted",
    normalized: name === "refusal" ? { tag: 1 } : name === "interrupted" ? { tag: 2, transport: 2 }
      : { tag: 0, argumentFailure: name === "unknown-action" ? 2 : name === "wrong-argument-type" ? 4 : 0 },
    envelope: (c, calls) => c.id === 0 ? null : name === "refusal"
      ? { status: "completed", error: null, output: [{ type: "message", status: "completed", role: "assistant", content: [{ type: "refusal", refusal: "declined" }] }] }
      : { status: "completed", error: null, output: [{ type: "function_call", status: "completed", call_id: "same-provider-0",
        name: name === "unknown-action" ? "unknown" : "repair",
        arguments: name === "malformed-json" ? "{" : JSON.stringify({ source: 42, observation: 0 }) }] },
  }, { tag: 1, models: 2, experiments: 0 });
}

await scenario("wrong-observation-kind", { independent: true, provider: () => trace(0),
  experiment: ([subject, key, , occurrence]) => [subject, key, occurrence, v(0, v(1, [true, 16n, 0n, ""]))],
}, { tag: 1, models: 2, experiments: 1 });
await scenario("incomplete-acceptance", { provider: () => [call("repair", { source: monotonic, observation: 0 })],
  experiment: ([subject, key, , occurrence]) => [subject, key, occurrence, v(0, v(1, [true, 15n, 0n, ""]))],
}, { tag: 1, models: 2, experiments: 1 });

await scenario("budget-stop", { passes: 1n, provider: c => !c.observation ? trace(1) : trace(0, true) },
  { tag: 8, models: 3, experiments: 1 });
await scenario("changed-before-read", { changeBeforeRead: true,
  provider: () => [call("repair", { source: monotonic, observation: 0 })],
}, { tag: 2, models: 2, experiments: 1 });
await scenario("global-cancel", { count: 3, independent: true, inspect: true,
  cancelAt: "inquiry.repair.experiment.v1", provider: () => trace(0),
}, { models: 4, experiments: 0, cleanup: [1, 2, 3] });
await scenario("unsupported-requirements", { changeTask: task => { task[0][3] += " Extra obligations."; },
  provider: () => { throw new Error("unexpected model call"); },
}, { tag: 1, models: 0, experiments: 0, cleanup: [] });

for (const intentChoice of [1, 2]) await scenario(`clarify-delivery-${intentChoice}`, {
  intent: 2, intentChoice, independent: true,
  provider: () => [call("repair", { source: monotonic, observation: 0 })],
}, { tag: intentChoice === 1 ? 9 : 0, models: 2, experiments: 1, questions: 1,
  approvals: intentChoice === 1 ? 0 : 1, writes: intentChoice === 1 ? 0 : 1, replacement: monotonic });
for (const [intentReply, tag] of [["other", 10], ["unsure", 11], ["unoffered", 12],
  ["abort", 13], ["close", 14], ["wrong-context", 15]]) {
  await scenario(`intent-${intentReply}`, { intent: 2, intentReply,
    provider: () => { throw new Error("unresolved intent cannot authorize model/tool work"); },
  }, { tag, models: 0, experiments: 0, questions: 1, cleanup: [] });
}

}

// Same task and environment per pair. Prescribed provider choices are test inputs;
// all model parsing, cache admission, validation and delivery remain authored.
const pairs = [];
for (const [name, source, replacement] of [["reset", reset, monotonic], ["rebinding", rebinding, tickets],
  ["already-correct", monotonic, monotonic], ["inadequate", reset, null]]) {
  const rows = [];
  for (const strategy of ["inquiry", "react"]) {
    let cachedProbe = false;
    const simple = name === "already-correct" || name === "inadequate";
    const provider = c => {
      if (!c.observation) return trace(c.id === 1 ? 1 : 0);
      if (c.id !== 1 || name === "inadequate") return stop(c.observation);
      if (name === "already-correct") return [call("repair", { source: replacement, observation: c.observation })];
      if (c.observation === 1 && !cachedProbe) { cachedProbe = true; return trace(1); }
      if (c.observation === 1) return trace(0, true);
      if (c.observation === 2 && c.version === 1) {
        assert(c.summary.includes(name === "rebinding" ? "contradicted" : "matched"));
        return [call("revise", { explanation: "Changed-question evidence revises the account; test candidate bytes independently.", observation: 2 })];
      }
      if (c.observation === 2) return [call("repair", { source: bad.rejectAll, observation: 2 })];
      assert(c.summary.includes("current_reply_rejected"));
      return [call("repair", { source: replacement, observation: c.observation })];
    };
    const baseModels = name === "inadequate" ? 2 : name === "already-correct" ? 2 : 6;
    rows.push(await scenario(`paired-${name}-${strategy}`, {
      source, strategy, target: `paired-${name}`, count: 3, provider, independent: true,
    }, { tag: name === "inadequate" ? 1 : name === "already-correct" ? 7 : 0,
      models: baseModels + (strategy === "inquiry" ? 5 : 0),
      experiments: name === "inadequate" ? 1 : name === "already-correct" ? 2 : 4,
      cleanup: strategy === "inquiry" ? [1, 2, 3] : [],
      approvals: simple ? 0 : 1, writes: simple ? 0 : 1,
      ...(replacement ? { replacement } : {}),
    }));
    if (!simple) {
      assert(cachedProbe, "each strategy must exercise its reusable observation cache");
      assert.equal(rows.at(-1).reuseHits, 1);
      assert.deepEqual(rows.at(-1).checks.map(x => x.passed), [false, true]);
    }
  }
  pairs.push({ name, results: rows });
}
for (const binding of ["subject", "key", "occurrence", "acceptance"]) {
  await scenario(`react-rejects-${binding}`, {
    strategy: "react", provider: () => binding === "acceptance"
      ? [call("repair", { source: monotonic, observation: 0 })] : trace(1),
    experiment: async payload => {
      const reply = await executeInquiryRequest(executor, payload);
      if (binding === "subject") reply[0] = [...reply[0].slice(0, 6), "foreign-target", reply[0][7]];
      if (binding === "key") reply[1] = [reply[1][0], [1, "foreign-candidate", [0, []]]];
      if (binding === "occurrence") reply[2] += 1n;
      if (binding === "acceptance") reply[3] = v(0, v(1, [true, 15n, 0n, ""]));
      return reply;
    },
  }, { tag: 1, models: 1, experiments: 1, cleanup: [] });
}
await scenario("react-inconclusive-candidate", {
  strategy: "react", provider: c => {
    if (c.models === 1) return [call("repair", { source: bad.rejectAll, observation: 0 })];
    assert.equal(c.invocation.messages[6].content, bad.rejectAll);
    assert(c.summary.includes("inconclusive"));
    return stop(0);
  },
  experiment: ([subject, key, , occurrence]) => [subject, key, occurrence, v(1)],
}, { tag: 1, models: 2, experiments: 1, cleanup: [] });
console.log(JSON.stringify({ imageBytes: image.length, scenarios: summaries, pairs }));
