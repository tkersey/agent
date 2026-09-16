// Prescribed provider/person inputs drive the actual image, never its policy.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadWorldRuntime } from "../../runtime/world.mjs";
import { decodeSchema, decodeValue, encodeValue } from "../../runtime/values.mjs";
import { decodeModelInvocation, normalizeOpenAIResponses, performModelInvocation } from "../../runtime/model.mjs";
import { createDocumentEnvironment } from "../../runtime/document.mjs";
import { wasmtime, native } from "./independent/execute.mjs";

const root = resolve(import.meta.dirname, "../..");
const [runtimeArg, imageArg, mode, ...extra] = process.argv.slice(2);
assert.equal(extra.length, 0);
assert([undefined, "--economy-only", "--application-only"].includes(mode));
const economyOnly = mode === "--economy-only";
const runtimePath = resolve(runtimeArg ?? join(root, ".agent4/out/world-runtime"));
const imagePath = resolve(imageArg ?? join(root, "zig-out/agent4/document/consequence.bpi3"));
const runtime = await loadWorldRuntime({ runtimePath });
const world = await import(pathToFileURL(runtime.identity.entrypoint));
const mainImage = await readFile(imagePath);
const kernelBytes = await readFile(runtime.identity.kernelPath);
const nativeBytes = process.env.AGENT4_NATIVE ? await readFile(process.env.AGENT4_NATIVE) : null;
const output = join(root, ".agent4/out/clarification");
await mkdir(output, { recursive: true });
const scratch = await mkdtemp(join(output, "transfer-"));
process.once("exit", () => rmSync(scratch, { recursive: true, force: true }));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const v = (tag, value = null) => ({ tag, value });
const effects = {
  read: "document.terminology.read.v1", model: "agent.model.invoke.v3",
  question: "agent.interaction.exchange.v1.document.terminology.choice",
  scopeFirst: "agent.interaction.exchange.v1.document.terminology.scope-first",
  issue: "agent.approval.issue.v1.document.terminology.change",
  approval: "agent.interaction.exchange.v1.document.terminology.change",
  replace: "document.terminology.replace.v1",
  turnCleanup: "document.terminology.turn.cleanup.v1",
  sessionCleanup: "document.terminology.conversation.cleanup.v1",
  message: "agent.interaction.exchange.v1.document.terminology.message",
};
const initialSchema = { root: 0, types: [
  { product: [1, 2, 2, 3, 3, 4] }, { bounded_text: 32 }, { bounded_text: 512 }, "boolean", "u64",
] };
const memorySchema = { root: 0, types: [
  { product: [1, 2] }, "u64", { sum: [3, 4] }, "unit", { product: [5, 6] },
  "boolean", { array: { element: 5, length: 2 } },
] };
const original = "Active policy:\nA customer may request a refund.\n\n" +
  "Archive:\nA customer filed a request in 2021.\n";
const convergent = "Active policy:\nA customer may request a refund.\n\nArchive:\nNo prior requests.\n";
const fresh = async input => (await world.admitProcessKernel(kernelBytes, {
  expectedSha256: runtime.identity.kernelSha256,
})).run(input);

// Independent fixture oracle: host strings determine expected bytes only.
// The executing application receives these as untrusted model proposals.
function oracle(content, old, replacement, scope) {
  const active = "Active policy:\n", archive = "Archive:\n";
  const a = content.indexOf(active), z = content.indexOf(archive);
  if (!old || a < 0 || z < a + active.length ||
      content.indexOf(active, a + 1) >= 0 || content.indexOf(archive, z + 1) >= 0) return null;
  const begin = scope === 1 ? a + active.length : 0;
  const end = scope === 1 ? z : content.length;
  const region = content.slice(begin, end);
  const changed = content.slice(0, begin) + region.split(old).join(replacement) + content.slice(end);
  if (Buffer.byteLength(changed) > 512) return null;
  return changed;
}

function encodeReply(request, reply) {
  const bytes = reply instanceof Uint8Array ? reply : encodeValue(decodeSchema(request.resumeSchema), reply);
  world.validateValue(request.resumeSchema, bytes);
  return world.encodeResult(request.bytes, bytes);
}

async function transferred(input, expected, name, independent, statistics) {
  const pki = world.encodeInput({ ...input, mode: "run" });
  const path = join(scratch, "transfer.pki2");
  await writeFile(path, pki);
  if (process.env.AGENT4_NATIVE) {
    const result = native(resolve(process.env.AGENT4_NATIVE), path, true);
    assert.equal(result.status, 0, result.stderr.toString());
    assert.equal(Buffer.compare(result.stdout, Buffer.from(expected.bytes)), 0,
      `${name}: native equality (${world.decodeOutcome(result.stdout).kind}/${expected.kind})`);
    const measured = JSON.parse(result.stderr);
    for (const key of Object.keys(statistics)) statistics[key] += measured[key];
  }
  if (!independent) return expected;
  const result = wasmtime(runtime.identity, path);
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(Buffer.compare(result.stdout, Buffer.from(expected.bytes)), 0,
    `${name}: Wasmtime equality (${world.decodeOutcome(result.stdout).kind}/${expected.kind})`);
  // Continue from the independent guest's actual result, not a host reconstruction.
  return { ...world.decodeOutcome(result.stdout), bytes: Uint8Array.from(result.stdout) };
}

async function scenario(name, options = {}) {
  const image = options.image ?? mainImage;
  const directory = await mkdtemp(join(output, "document-"));
  const filename = join(directory, "document.txt");
  const before = options.content ?? original;
  await writeFile(filename, options.raw ?? before);
  const environment = await createDocumentEnvironment({ root: directory, maximumContentBytes: 512 });
  const task = ["document.txt", options.old ?? "customer", options.term ?? "client",
    options.mandatory ?? false, options.archiveAllowed ?? true, 1n];
  const expected = oracle(before, task[1], task[2], options.choice ?? 1);
  const trace = [], messages = [], stateBytes = [], graphs = [], transfers = [], historyGraphs = [];
  const turns = options.repeat === true ? 2 : options.repeat || 1;
  const statistics = { multiTemplates: 0, branchActivations: 0, transitions: 0 };
  let modelCalls = 0, modelRequestBytes = 0, modelResponseBytes = 0, providerBytes = 0;
  let questionCount = 0, approvalCount = 0, replacements = 0, turnCleanup = 0, sessionCleanup = 0;
  let issue = 0n, oldChoiceResult, oldChoiceRequest, cancelled = false;
  let currentContent = before;
  let outcome = await fresh({ image, initialArgs: encodeValue(initialSchema, task) });
  try {
    while (outcome.kind === "Requested") {
      const restored = await fresh({ image, state: Uint8Array.from(outcome.state) });
      assert.deepEqual(restored.bytes, outcome.bytes, `${name}: lossless fresh restore`);
      const decoded = world.decodeRequest(outcome.request);
      const request = { ...decoded, bytes: Uint8Array.from(outcome.request) };
      const identity = request.semanticIdentity;
      const payload = decodeValue(decodeSchema(request.payloadSchema), request.payload);
      trace.push(identity); stateBytes.push(outcome.state.length);
      if (options.cancelAt === identity && !cancelled) {
        cancelled = true;
        const oldCleanupResult = identity === effects.turnCleanup ? encodeReply(request, null) : null;
        const input = { image, state: outcome.state, cancel: "fixture-cancel" };
        outcome = await transferred(input, await fresh(input), `${name}: cancel`, !!options.transfer,
          statistics);
        if (oldCleanupResult) {
          assert.equal(outcome.kind, "Requested");
          await assert.rejects(fresh({ image, state: outcome.state, result: oldCleanupResult }), /InvalidResult/);
        }
        continue;
      }
      let answer;
      if (identity === effects.read) {
        assert.equal(payload, task[0]);
        const read = await environment.read({ path: payload });
        answer = read.kind === "success" ? v(0, [read.observation.content, read.observation.digest])
          : v(1, read.code);
      } else if (identity === effects.model) {
        modelCalls += 1; modelRequestBytes += request.payload.length;
        const invocation = decodeModelInvocation(request.payload);
        assert.equal(invocation.model, "fixture-model");
        assert.deepEqual(invocation.tools.map(tool => tool.name), ["proposal"]);
        const scope = invocation.messages[1].content === "active_section" ? 1 : 2;
        assert.equal(invocation.messages[1].content, scope === 1 ? "active_section" : "whole_document");
        assert.equal(invocation.messages[2].content, currentContent);
        assert.equal(invocation.messages[3].content, task[1]);
        assert.equal(invocation.messages[4].content, task[2]);
        assert.equal(invocation.messages[5].content, task[0]);
        let replacement = oracle(currentContent, task[1], task[2], scope) ?? currentContent;
        if (options.wrongEdit && scope === 2) replacement = "An unsupported edit.";
        const args = { status: options.unavailable && scope === 2 ? "unavailable"
          : options.needsInformation && scope === 2 ? "needs_information" : "known", replacement };
        if (options.wrongArguments && scope === 2) args.replacement = 9;
        const provider = Buffer.from(JSON.stringify(options.refusal && scope === 2 ? {
          status: "completed", output: [{ type: "message", role: "assistant",
            content: [{ type: "refusal", refusal: "declined" }] }],
        } : {
          status: "completed", error: null, output: [{ type: "function_call", status: "completed",
            call_id: options.sameTask ? "fixture-proposal" : `proposal-${modelCalls}`,
            name: options.unknownAction && scope === 2 ? "unknown" : "proposal",
            arguments: JSON.stringify(args) }],
        }));
        if (options.interrupted && scope === 2) {
          const stop = new AbortController(); stop.abort();
          answer = await performModelInvocation(request.payload, {
            endpoint: "http://127.0.0.1:1/v1/responses", signal: stop.signal,
          });
        } else {
          providerBytes += provider.length;
          answer = normalizeOpenAIResponses(provider, invocation.normalizationLimits, invocation.tools);
        }
        modelResponseBytes += answer.length;
        if (options.staleAt === "revalidation" && modelCalls === 2)
          await writeFile(filename, "External edit while awaiting revalidation.\n");
        if (options.transfer) {
          const snapshot = join(scratch, "model.pst2");
          await writeFile(snapshot, outcome.state);
          const inspector = resolve(process.env.AGENT4_MULTI_INSPECTOR ?? join(root, "zig-out/bin/agent4-multi"));
          const graph = JSON.parse(execFileSync(inspector, ["inspect-state", snapshot], { encoding: "utf8" }));
          assert.equal(graph.multiTemplates, 1);
          // Activated branches execute as ordinary control. A parked graph need
          // not retain a branch node; native Statistics counts actual activations.
          assert.equal(graph.branches, 0);
          assert.equal(graph.resources, 0, "no live proof or grant enters the pending model future");
          graphs.push(graph);
        }
      } else if (identity === effects.scopeFirst) {
        questionCount += 1;
        assert.equal(modelCalls, 0, "clarify-first asks before performing an assessment");
        assert.deepEqual(payload[3][0], task);
        assert.equal(payload[3][1][0], currentContent);
        assert.equal(payload[3][2], BigInt(messages.length + 1));
        answer = v(0, v(0, options.choice ?? 1));
      } else if (identity === effects.question) {
        questionCount += 1;
        const question = payload[3];
        assert.equal(payload[1], "consequence-clarification");
        assert.deepEqual(question[0][0], task);
        assert.equal(question[0][1][0], currentContent);
        assert.equal(question[0][2], BigInt(messages.length + 1));
        assert(question[2].includes(options.mandatory ? "policy requires" : "archived text"));
        const offered = question[3];
        assert.deepEqual(offered.map(option => option[0]), [1n, 2n]);
        for (const option of offered) {
          const scope = Number(option[0]);
          assert.deepEqual(option[1], [option[0]]);
          assert.equal(option[2][1][2], oracle(currentContent, task[1], task[2], scope));
          const archive = text => text.slice(text.indexOf("Archive:\n") + 9);
          assert.equal(option[3], archive(currentContent) !== archive(option[2][1][2]));
        }
        if (options.staleAt === "question") await writeFile(filename, "External edit while awaiting scope.\n");
        if (oldChoiceResult) {
          await assert.rejects(async () => {
            const replay = await fresh({ image, state: outcome.state, result: oldChoiceResult });
            console.error(JSON.stringify({ unexpectedReplyAdmission: name, questionCount,
              sameRequestBytes: Buffer.from(request.bytes).equals(oldChoiceRequest),
              outcome: replay.kind, nextEffect: replay.kind === "Requested"
                ? world.decodeRequest(replay.request).semanticIdentity : null }));
            return replay;
          }, /InvalidResult/);
        }
        assert.throws(() => world.encodeResult(request.bytes, Uint8Array.of(255)),
          /Truncated|InvalidValue|InvalidTag/);
        answer = options.reply === "abort" ? v(1) : options.reply === "close" ? v(2)
          : v(0, options.reply === "other" ? v(1) : options.reply === "unsure" ? v(2)
            : v(0, options.reply === "unoffered" ? 99 : options.choice ?? 1));
        oldChoiceResult = encodeReply(request, answer);
        oldChoiceRequest = Buffer.from(request.bytes);
      } else if (identity === effects.issue) {
        answer = ++issue;
      } else if (identity === effects.approval) {
        approvalCount += 1;
        const challenge = payload[3];
        assert.equal(payload[1], "approval");
        const challengedReplacement = options.amend === "wrong" && approvalCount > 1
          ? "Outside this edit contract." : oracle(currentContent, task[1], task[2], options.choice ?? 1);
        assert.equal(challenge[1][1][2], challengedReplacement);
        if (options.staleAt === "approval") await writeFile(filename, "External edit while awaiting approval.\n");
        let decision = options.decline ? v(1, "declined") : v(0);
        if (options.amend && approvalCount === 1) {
          const amended = structuredClone(challenge[1]);
          if (options.amend === "wrong") amended[1][2] = "Outside this edit contract.";
          decision = v(2, amended);
        }
        answer = v(0, [challenge, options.wrongPrincipal ? 9 : 7, decision]);
      } else if (identity === effects.replace) {
        replacements += 1;
        assert.equal(payload[0], 1); // Replace, not NoChange.
        const [path, base, replacement, provenance, principal] = payload[1];
        assert.equal(provenance, 1n); assert.equal(principal, 7n);
        const result = await environment.replace({ path,
          base: { content: base[0], digest: base[1] }, replacement });
        answer = result.kind === "success" || result.kind === "conflict"
          ? v(result.kind === "success" ? 0 : 1, [result.observation.content, result.observation.digest])
          : v(result.kind === "failure" ? 2 : 3, result.code);
        if (options.uncertain) answer = v(3, "delivery uncertain after replacement");
      } else if (identity === effects.turnCleanup) {
        assert.equal(payload, task[5]); turnCleanup += 1; answer = null;
      } else if (identity === effects.sessionCleanup) {
        assert.equal(payload, null); sessionCleanup += 1; answer = null;
      } else if (identity === effects.message) {
        messages.push(payload[3]);
        if (turns > 2) {
          const snapshot = join(scratch, "history.pst2");
          await writeFile(snapshot, outcome.state);
          const inspector = resolve(process.env.AGENT4_MULTI_INSPECTOR ?? join(root, "zig-out/bin/agent4-multi"));
          const graph = JSON.parse(execFileSync(inspector, ["inspect-state", snapshot], { encoding: "utf8" }));
          assert.equal(graph.multiTemplates, 0); assert.equal(graph.branches, 0);
          assert.equal(graph.resources, 0); assert.equal(graph.packages, 0);
          assert.equal(graph.obligations, 1, "only the open conversation owns cleanup between turns");
          historyGraphs.push(graph);
        }
        if (messages.length < turns) {
          if (!options.sameTask) task[5] = BigInt(messages.length + 1);
          currentContent = original;
          await writeFile(filename, currentContent);
          answer = v(0, task);
        } else answer = v(1);
      } else assert.fail(`${name}: unexpected request ${identity}`);
      const result = encodeReply(request, answer);
      const input = { image, state: Uint8Array.from(outcome.state), result };
      const next = await fresh(input);
      const independent = !!options.transfer && [effects.model, effects.question, effects.approval,
        effects.turnCleanup, effects.sessionCleanup].includes(identity);
      outcome = await transferred(input, next, `${name}: ${identity}`, independent, statistics);
      if (independent) transfers.push(identity);
    }
    assert.equal(outcome.kind, cancelled ? "Cancelled" : "Completed", name);
    if (cancelled) {
      assert.equal(outcome.reason, "fixture-cancel");
      assert.deepEqual(outcome.cleanupFailures, []);
    }
    assert.equal(turnCleanup, turns, `${name}: turn cleanup exactly once`);
    assert.equal(sessionCleanup, 1, `${name}: conversation cleanup exactly once`);
    const final = await readFile(filename);
    const noWrite = cancelled || options.reply || options.decline || options.wrongPrincipal ||
      options.wrongEdit || options.unavailable || options.refusal || options.unknownAction ||
      options.wrongArguments || options.needsInformation || options.interrupted ||
      options.archiveAllowed === false || options.amend === "wrong" || options.invalid;
    const expectedFile = options.staleAt ? `External edit while awaiting ${options.staleAt === "question" ? "scope" : options.staleAt}.\n`
      : noWrite ? options.raw ?? before : options.repeat ? oracle(original, task[1], task[2], options.choice ?? 1) : expected;
    assert.deepEqual(final, Buffer.from(expectedFile), `${name}: independently expected file bytes`);
    if (noWrite || options.staleAt && options.staleAt !== "approval") assert.equal(replacements, 0);
    if (options.expectedQuestions !== undefined) assert.equal(questionCount, options.expectedQuestions, name);
    if (options.expectedApproval !== undefined) assert.equal(approvalCount, options.expectedApproval, name);
    if (options.expectedReply !== undefined) assert.equal(messages.at(-1)?.tag, options.expectedReply, name);
    if (options.reply === "close" || cancelled) assert.equal(messages.length, 0);
    if (options.repeat && before === convergent) {
      assert.deepEqual(messages[0], v(0, [false, [true, true]]));
      assert.equal(questionCount, 1, "an agreed edit must not invent a reusable scope preference");
    }
    const expectedModels = options.expectedModels ?? (options.raw || options.cancelAt === effects.model
      ? 0 : turns * 2);
    assert.equal(modelCalls, expectedModels, `${name}: completed assessments are never replayed`);
    if (process.env.AGENT4_NATIVE && !cancelled) {
      assert.equal(statistics.multiTemplates, options.expectedModels === 1 || options.raw ? 0 : turns);
      assert.equal(statistics.branchActivations, options.expectedModels === 1 || options.raw ? 0 : turns * 2);
    }
    for (const graph of historyGraphs.slice(2))
      assert.deepEqual(graph, historyGraphs[1], "repeated turns retain bounded reachable state");
    const memory = outcome.kind === "Completed" ? decodeValue(memorySchema, outcome.value) : null;
    if (memory) assert.equal(memory[0], BigInt(turns + 1));
    return { name, modelCalls, clarificationExchanges: questionCount, approvalExchanges: approvalCount,
      replacements, modelRequestBytes, modelResponseBytes, providerBytes,
      completedAssessments: options.raw ? 0 : modelCalls, peakStateBytes: Math.max(...stateBytes),
      stateBytes, graphs, historyGraphs, statistics, transfers, turnCleanup, sessionCleanup, messages, memory,
      fileSha256: hash(final), trace };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

const results = [];
if (economyOnly) {
  results.push(await scenario("divergent-active", { expectedQuestions: 1, expectedApproval: 1 }));
  results.push(await scenario("common", { content: convergent, expectedQuestions: 0, expectedApproval: 1 }));
} else {
results.push(await scenario("divergent-active", { transfer: true, expectedQuestions: 1, expectedApproval: 1, expectedReply: 0 }));
results.push(await scenario("divergent-whole", { choice: 2, expectedQuestions: 1, expectedApproval: 1, expectedReply: 0 }));
results.push(await scenario("common", { content: convergent, expectedQuestions: 0, expectedApproval: 1, expectedReply: 0 }));
results.push(await scenario("mandatory", { content: convergent, mandatory: true, expectedQuestions: 1, expectedApproval: 1 }));
results.push(await scenario("no-change", { old: "absent", expectedQuestions: 0, expectedApproval: 0, expectedReply: 1 }));
for (const reply of ["other", "unsure", "unoffered", "abort", "close"])
  results.push(await scenario(reply, { reply, expectedQuestions: 1, expectedApproval: 0,
    expectedReply: reply === "close" ? undefined : reply === "abort" ? 9 : 2 }));
for (const failure of ["wrongEdit", "unavailable", "refusal", "unknownAction", "wrongArguments", "needsInformation", "interrupted"])
  results.push(await scenario(failure, { [failure]: true, expectedQuestions: 0, expectedApproval: 0, expectedReply: 2 }));
results.push(await scenario("restricted-policy", { archiveAllowed: false, expectedQuestions: 0, expectedApproval: 0, expectedReply: 2 }));
for (const staleAt of ["question", "approval"])
  results.push(await scenario(`stale-${staleAt}`, { staleAt, expectedQuestions: 1,
    expectedApproval: staleAt === "question" ? 0 : 1, expectedReply: 3 }));
results.push(await scenario("no-change-stale", { old: "absent", staleAt: "revalidation",
  expectedQuestions: 0, expectedApproval: 0, expectedReply: 3 }));
results.push(await scenario("cleanup-cancel", { reply: "abort", cancelAt: effects.turnCleanup,
  transfer: true, expectedQuestions: 1, expectedApproval: 0 }));
results.push(await scenario("repeated-retention", { repeat: 8, expectedQuestions: 8, expectedApproval: 8 }));
results.push(await scenario("decline", { decline: true, expectedReply: 6 }));
results.push(await scenario("wrong-principal", { wrongPrincipal: true, expectedReply: 8 }));
results.push(await scenario("same-amendment", { amend: "same", expectedApproval: 2, expectedReply: 0 }));
results.push(await scenario("unsupported-amendment", { amend: "wrong", expectedReply: 8 }));
results.push(await scenario("uncertain-delivery", { uncertain: true, expectedReply: 5 }));
for (const cancelAt of [effects.model, effects.question, effects.approval])
  results.push(await scenario(`cancel-${cancelAt}`, { cancelAt, transfer: cancelAt === effects.question }));
results.push(await scenario("common-then-divergent", { content: convergent, repeat: true }));
results.push(await scenario("equal-looking-questions", {
  repeat: 3, sameTask: true, expectedQuestions: 3,
}));
results.push(await scenario("unicode", { content: "préface\nActive policy:\ncafé café\nArchive:\ncafé\n",
  old: "café", term: "thé", choice: 2, expectedQuestions: 1, expectedReply: 0 }));
results.push(await scenario("invalid-grammar", { content: "Active policy:\nx\n", old: "x", term: "y",
  invalid: true, expectedReply: 2, expectedApproval: 0 }));
results.push(await scenario("invalid-utf8", { raw: Buffer.from([0xff, 0xfe]), invalid: true,
  expectedReply: 4, expectedApproval: 0 }));
}
let ablation = null;
if (mode !== "--application-only") {
  const baseline = await readFile(join(dirname(imagePath), "clarify-first.bpi3"));
  results.push(await scenario("clarify-first-common", { image: baseline, content: convergent,
    expectedQuestions: 1, expectedApproval: 1, expectedModels: 1 }));
  results.push(await scenario("clarify-first-divergent", { image: baseline,
    expectedQuestions: 1, expectedApproval: 1, expectedModels: 1 }));
  ablation = { baselineImageSha256: hash(baseline), baselineImageBytes: baseline.length,
    timing: "UNMEASURED: no latency or cost improvement claim",
    pairs: [["common", "clarify-first-common"], ["divergent-active", "clarify-first-divergent"]]
      .map(names => names.map(name => {
        const r = results.find(result => result.name === name);
        return { name, clarificationExchanges: r.clarificationExchanges,
          approvalExchanges: r.approvalExchanges, modelCalls: r.modelCalls,
          modelRequestBytes: r.modelRequestBytes, modelResponseBytes: r.modelResponseBytes,
          providerBytes: r.providerBytes, peakStateBytes: r.peakStateBytes };
      })) };
}
const evidence = { imageSha256: hash(mainImage), imageBytes: mainImage.length, ablation,
  kernelSha256: runtime.identity.kernelSha256, nativeMatched: !!process.env.AGENT4_NATIVE,
  nativeExecutableSha256: nativeBytes ? hash(nativeBytes) : null, results };
if (nativeBytes) assert.deepEqual(await readFile(process.env.AGENT4_NATIVE), nativeBytes);
const json = JSON.stringify(evidence, (_, value) => typeof value === "bigint" ? value.toString() : value, 2);
const resultPath = join(output, economyOnly ? "economy-results.json"
  : mode === "--application-only" ? "application-results.json" : "results.json");
await writeFile(resultPath, `${json}\n`);
console.log(JSON.stringify({ cases: results.length, imageBytes: mainImage.length,
  nativeMatched: evidence.nativeMatched, output: resultPath }));
