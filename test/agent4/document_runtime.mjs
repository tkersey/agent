// Actual compiled application execution. Queues below are prescribed external
// inputs, never a runtime implementation of the application's control flow.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadWorldRuntime } from "../../runtime/world.mjs";
import { decodeSchema, decodeValue, encodeValue } from "../../runtime/values.mjs";
import { decodeModelInvocation, normalizeOpenAIResponses } from "../../runtime/model.mjs";
import { createDocumentEnvironment } from "../../runtime/document.mjs";

const root = resolve(import.meta.dirname, "../..");
const [runtimeArgument, imageArgument, ...extra] = process.argv.slice(2);
assert.equal(extra.length, 0, "usage: document_runtime.mjs [WORLD_RUNTIME [DOCUMENT_IMAGE]]");
const runtimePath = resolve(runtimeArgument ?? join(root, ".agent4/out/world-runtime"));
const imagePath = resolve(imageArgument ?? join(root, ".agent4/out/document/document.bpi2"));
const runtime = await loadWorldRuntime({ runtimePath });
const world = await import(pathToFileURL(runtime.identity.entrypoint).href);
const kernelBytes = await readFile(runtime.identity.kernelPath);
const image = await readFile(imagePath);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const scalar = { root: 0, types: ["u64"] };
const memory = { root: 0, types: [{ sum: [1, 2] }, "unit", "u64"] };
const variant = (tag, value = null) => ({ tag, value });
const value = item => variant(0, item);
const observation = content => [content, hash(Buffer.from(content))];
const original = "Original document.\n";
const amended = "Revision: amended.\n";
const alternative = "A distinct accepted revision: evidence matters.\n";
const scopedInstruction = "Assess the revision under the clarified document policy.";
const effects = Object.freeze({
  clarify: "agent.interaction.exchange.v1.document.clarification",
  read: "document.read.v1",
  model: "agent.model.invoke.v3",
  critic: "agent.interaction.exchange.v1.document.critic",
  issue: "agent.approval.issue.v1.document.change",
  approve: "agent.interaction.exchange.v1.document.change",
  replace: "document.replace.v1",
  cleanup: "document.turn.cleanup.v1",
  message: "agent.interaction.exchange.v1.document.message",
});
const initial = encodeValue(scalar, 7);
const fresh = async input => (await world.admitProcessKernel(kernelBytes, {
  expectedSha256: runtime.identity.kernelSha256,
})).run(input);

function interaction(payload, purpose) {
  assert(Array.isArray(payload) && payload.length === 4);
  assert.equal(payload[1], purpose);
  assert.equal(payload[2], null);
  return payload[3];
}

function modelReply(candidate, replacement, score, requirement) {
  return ({ request }) => {
    const invocation = decodeModelInvocation(request.payload);
    assert.equal(invocation.protocol, "agent.model.protocol.openai-responses-v2");
    assert.equal(invocation.model, "fixture-model");
    assert.deepEqual(invocation.messages, [
      { role: "system", content: scopedInstruction },
      { role: "user", content: String(candidate) },
      { role: "user", content: String(requirement) },
      { role: "user", content: original },
    ], "captured scope, resumed helper data, and the actual document enter ordered model context");
    assert.deepEqual(invocation.tools.map(tool => tool.name), ["proposal"]);
    const provider = Buffer.from(JSON.stringify({
      status: "completed", error: null,
      output: [{ type: "function_call", status: "completed",
        call_id: `proposal-${candidate}`, name: "proposal",
        arguments: JSON.stringify({ replacement, score }) }],
    }));
    return normalizeOpenAIResponses(provider, invocation.normalizationLimits, invocation.tools);
  };
}

function readReply(environment) {
  return async ({ payload }) => {
    assert.equal(payload, "document.txt");
    const read = await environment.read({ path: payload });
    return read.kind === "success"
      ? variant(0, [read.observation.content, read.observation.digest])
      : variant(1, read.code);
  };
}

function operationReply(result) {
  if (result.kind === "success" || result.kind === "conflict")
    return variant(result.kind === "success" ? 0 : 1,
      [result.observation.content, result.observation.digest]);
  assert(["failure", "uncertain"].includes(result.kind));
  return variant(result.kind === "failure" ? 2 : 3, result.code);
}

function proposalInput(payload) {
  assert.equal(payload.length, 6);
  const [path, base, replacement, provenance, principal] = payload;
  assert.equal(path, "document.txt");
  assert.equal(provenance, 1n, "only live read evidence reaches commitment");
  assert.equal(principal, 7n);
  assert.equal(base.length, 2);
  return { path, base: { content: base[0], digest: base[1] }, replacement };
}

function replyMessage(expected, next) {
  return ({ payload }) => {
    assert.deepEqual(interaction(payload, "message"), expected);
    return next;
  };
}

function baseQueues(environment, clarificationReply = 3) {
  const requirement = 1007n + BigInt(clarificationReply);
  return new Map([
    [effects.clarify, [({ payload }) => {
      assert.equal(interaction(payload, "clarification"), 1007n);
      return value(clarificationReply);
    }]],
    [effects.read, [readReply(environment)]],
    [effects.model, [modelReply(1, "Revision: clear.\n", 10, requirement),
      modelReply(2, "Revision: concise.\n", 20, requirement)]],
    [effects.critic, [({ payload }) => {
      assert.equal(interaction(payload, "clarification"), 102n);
      return value(5);
    }]],
    [effects.issue, [100, 101]],
    [effects.cleanup, [({ payload }) => { assert.equal(payload, 7n); return null; }]],
  ]);
}

function approvalReplies(replacement, stale = false) {
  let firstChallenge;
  let oldResult;
  return [
    ({ payload, request }) => {
      firstChallenge = structuredClone(interaction(payload, "approval"));
      assert.equal(firstChallenge[0], 100n);
      assert.equal(firstChallenge[1][2], "Revision: concise.\n");
      assert.deepEqual(firstChallenge[1][1], observation(original));
      const changed = structuredClone(firstChallenge[1]);
      changed[2] = replacement;
      const reply = value([firstChallenge, 7, variant(2, changed)]);
      oldResult = world.encodeResult(request.bytes,
        encodeValue(decodeSchema(request.resumeSchema), reply));
      return reply;
    },
    async ({ payload, state }) => {
      const current = interaction(payload, "approval");
      assert.equal(current[0], 101n);
      assert.equal(current[1][2], replacement);
      assert.notDeepEqual(current, firstChallenge, "amendment requires a fresh challenge");
      const saved = Uint8Array.from(state);
      await assert.rejects(fresh({ image, state, result: oldResult }), /InvalidResult/);
      assert.deepEqual(state, saved, "a stale bound ERS2 leaves the current State unchanged");
      return value([stale ? firstChallenge : current, 7, variant(0)]);
    },
  ];
}

async function execute(name, queues, expectedResult) {
  const pending = new Map([...queues].map(([identity, replies]) => [identity, [...replies]]));
  const trace = [];
  const states = [];
  let outcome = await runtime.start(Uint8Array.from(image), Uint8Array.from(initial));
  const initialRaw = await fresh({ image, initialArgs: initial });
  assert.deepEqual(outcome.bytes, initialRaw.bytes, "raw World starts the same compiled image");
  while (outcome.kind === "Requested") {
    const savedBytes = Uint8Array.from(outcome.bytes);
    const savedState = Uint8Array.from(outcome.state);
    const savedRequest = Uint8Array.from(outcome.request);
    const detached = world.decodeOutcome(savedBytes);
    const restored = await fresh({ image: Uint8Array.from(image), state: detached.state });
    assert.deepEqual(restored.bytes, savedBytes,
      "a fresh instance reconstructs a pending request without reissuing its I/O");
    const decoded = world.decodeRequest(detached.request);
    const request = Object.freeze({ ...decoded, bytes: detached.request });
    const payload = decodeValue(decodeSchema(request.payloadSchema), request.payload);
    const replies = pending.get(request.semanticIdentity);
    assert(replies?.length, `${name}: unexpected request ${request.semanticIdentity}`);
    trace.push(request.semanticIdentity);
    states.push({ effect: request.semanticIdentity, bytes: savedState.length,
      sha256: hash(savedState) });
    const next = replies.shift();
    const answer = typeof next === "function"
      ? await next({ payload, request, state: detached.state }) : next;
    const reply = answer instanceof Uint8Array ? answer
      : encodeValue(decodeSchema(request.resumeSchema), answer);
    world.validateValue(request.resumeSchema, reply);
    const result = world.encodeResult(detached.request, reply);
    const bridge = await loadWorldRuntime({ runtimePath });
    const bridged = await bridge.resume(Uint8Array.from(image), detached.state,
      detached.request, reply);
    const raw = await fresh({ image: Uint8Array.from(image),
      state: Uint8Array.from(detached.state), result: Uint8Array.from(result) });
    assert.deepEqual(bridged.bytes, raw.bytes,
      "raw World and the optional bridge agree for the same image, State, and ERS2");
    assert.deepEqual(outcome.bytes, savedBytes);
    assert.deepEqual(outcome.state, savedState);
    assert.deepEqual(outcome.request, savedRequest);
    assert.deepEqual(detached.state, savedState, "resumption never mutates its input State");
    outcome = raw;
  }
  assert.equal(outcome.kind, "Completed", `${name} did not reach its authored root result`);
  assert.deepEqual(decodeValue(memory, outcome.value), expectedResult);
  for (const [identity, remaining] of pending)
    assert.equal(remaining.length, 0, `${name}: prescribed ${identity} inputs were not consumed`);
  return { name, result: expectedResult, trace, transferBoundaries: states,
    relation: "independent expected application result; fresh-instance transfer; raw World parity" };
}

async function fixture(run) {
  const directory = await mkdtemp(join(root, ".agent4/out/document-runtime-"));
  try {
    await writeFile(join(directory, "document.txt"), original);
    const environment = await createDocumentEnvironment({ root: directory });
    return await run(environment, directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function revisionScenario(name, replacement, mode = "success") {
  return fixture(async (environment, directory) => {
    const queues = baseQueues(environment);
    queues.set(effects.approve, approvalReplies(replacement, mode === "stale"));
    let commits = 0;
    let actual;
    if (mode !== "stale") queues.set(effects.replace, [async ({ payload }) => {
      const input = proposalInput(payload);
      assert.equal(input.replacement, replacement);
      commits++;
      if (mode === "conflict") {
        const competitor = await createDocumentEnvironment({ root: directory });
        const changed = await competitor.replace({ path: "document.txt",
          base: input.base, replacement: "Concurrent revision.\n" });
        assert.equal(changed.kind, "success");
      }
      actual = await environment.replace(input);
      if (mode === "uncertain") {
        assert.equal(actual.kind, "success");
        // Fault injection: the real replacement happened, but its delivery
        // acknowledgement was lost before the program learned the outcome.
        return operationReply({ kind: "uncertain", code: "acknowledgment_lost" });
      }
      return operationReply(actual);
    }]);
    const first = mode === "success" ? variant(0, 28n)
      : mode === "conflict" ? variant(3, observation("Concurrent revision.\n"))
      : mode === "uncertain" ? variant(5, "acknowledgment_lost") : variant(7);
    queues.set(effects.message, mode === "success"
      ? [replyMessage(first, value(4)), replyMessage(variant(1, 32n), variant(1))]
      : [replyMessage(first, variant(1))]);
    if (mode === "success") queues.get(effects.cleanup).push(({ payload }) => {
      assert.equal(payload, 4n); return null;
    });
    const expected = mode === "success" ? variant(1, 28n) : variant(0);
    const record = await execute(name, queues, expected);
    const expectedTrace = [effects.clarify, effects.read, effects.model, effects.model,
      effects.critic, effects.issue, effects.approve, effects.issue, effects.approve];
    if (mode !== "stale") expectedTrace.push(effects.replace);
    expectedTrace.push(effects.cleanup, effects.message);
    if (mode === "success") expectedTrace.push(effects.cleanup, effects.message);
    assert.deepEqual(record.trace, expectedTrace, "the authored application determines request order");
    assert.equal(commits, mode === "stale" ? 0 : 1,
      "stale approval never commits; uncertain delivery never retries automatically");
    const content = await readFile(join(directory, "document.txt"), "utf8");
    const expectedContent = mode === "stale" ? original
      : mode === "conflict" ? "Concurrent revision.\n" : replacement;
    assert.equal(content, expectedContent);
    if (actual?.kind === "success")
      assert.deepEqual([actual.observation.content, actual.observation.digest], observation(content));
    if (mode === "conflict") assert.equal(actual.kind, "conflict");
    return { ...record, commitRequests: commits, actualDocument: observation(content),
      reportedOperation: mode === "uncertain" ? "uncertain" : actual?.kind ?? "none" };
  });
}

async function directProposalScenario(name, clarificationReply) {
  return fixture(async (environment, directory) => {
    const queues = baseQueues(environment, clarificationReply);
    queues.set(effects.issue, [100]);
    queues.set(effects.approve, [({ payload }) => {
      const challenge = interaction(payload, "approval");
      assert.equal(challenge[0], 100n);
      assert.deepEqual(challenge[1][1], observation(original));
      assert.equal(challenge[1][2], "Revision: concise.\n");
      return value([challenge, 7, variant(0)]);
    }]);
    let commits = 0;
    let actual;
    queues.set(effects.replace, [async ({ payload }) => {
      const input = proposalInput(payload);
      assert.equal(input.replacement, "Revision: concise.\n",
        "the winning provider proposal supplies actual replacement content");
      commits++;
      actual = await environment.replace(input);
      return operationReply(actual);
    }]);
    queues.set(effects.message, [replyMessage(variant(0, 28n), variant(1))]);
    const record = await execute(name, queues, variant(1, 28n));
    assert.deepEqual(record.trace, [effects.clarify, effects.read, effects.model,
      effects.model, effects.critic, effects.issue, effects.approve, effects.replace,
      effects.cleanup, effects.message]);
    assert.equal(commits, 1);
    assert.equal(actual.kind, "success");
    const content = await readFile(join(directory, "document.txt"), "utf8");
    assert.equal(content, "Revision: concise.\n");
    assert.deepEqual([actual.observation.content, actual.observation.digest], observation(content));
    return { ...record, clarificationReply, clarifiedRequirement: 1007 + clarificationReply,
      commitRequests: commits, actualDocument: observation(content), reportedOperation: actual.kind };
  });
}

async function rejectedAmendmentScenario(name, change, { freshDecision = false, principal = 7 } = {}) {
  return fixture(async (environment, directory) => {
    const queues = baseQueues(environment);
    queues.set(effects.issue, freshDecision ? [100, 101] : [100]);
    let changedProposal;
    const approvals = [({ payload }) => {
      const challenge = interaction(payload, "approval");
      assert.equal(challenge[0], 100n);
      assert.deepEqual(challenge[1][1], observation(original));
      changedProposal = structuredClone(challenge[1]);
      change(changedProposal);
      assert.notDeepEqual(changedProposal, challenge[1]);
      return value([challenge, 7, variant(2, changedProposal)]);
    }];
    if (freshDecision) approvals.push(({ payload }) => {
      const challenge = interaction(payload, "approval");
      assert.equal(challenge[0], 101n);
      assert.deepEqual(challenge[1], changedProposal);
      // Section 11 requires another decision after amendment and a policy check
      // before commitment; it does not require rejection before challenge issuance.
      return value([challenge, principal, variant(0)]);
    });
    queues.set(effects.approve, approvals);
    queues.set(effects.message, [replyMessage(variant(8), variant(1))]);
    const record = await execute(name, queues, variant(0));
    const expectedTrace = [effects.clarify, effects.read, effects.model,
      effects.model, effects.critic, effects.issue, effects.approve];
    if (freshDecision) expectedTrace.push(effects.issue, effects.approve);
    expectedTrace.push(effects.cleanup, effects.message);
    assert.deepEqual(record.trace, expectedTrace,
      "the image denies the invalid amendment without emitting a commit request");
    const content = await readFile(join(directory, "document.txt"), "utf8");
    assert.equal(content, original);
    return { ...record, commitRequests: 0, actualDocument: observation(content),
      reportedOperation: "denied" };
  });
}

const records = [];
records.push(await revisionScenario("amendment-two-turn-conversation", amended));
records.push(await revisionScenario("alternate-real-non-golden-replacement", alternative));
assert.notDeepEqual(records[0].actualDocument, records[1].actualDocument);
records.push(await revisionScenario("atomic-base-conflict", amended, "conflict"));
records.push(await revisionScenario("stale-semantic-approval-rebound-to-new-request", amended, "stale"));
records.push(await revisionScenario("unknown-delivery-does-not-retry", amended, "uncertain"));
records.push(await rejectedAmendmentScenario("amendment-cannot-replace-retained-live-evidence",
  proposal => { proposal[1] = observation("Forged current document.\n"); }));
records.push(await rejectedAmendmentScenario("amendment-cannot-change-approver-scope",
  proposal => { proposal[4] = 9n; }, { freshDecision: true }));
records.push(await rejectedAmendmentScenario("amendment-cannot-authenticate-a-new-approver",
  proposal => { proposal[4] = 9n; }, { freshDecision: true, principal: 9 }));
records.push(await rejectedAmendmentScenario("amendment-cannot-change-read-evidence-path",
  proposal => { proposal[0] = "other.txt"; }, { freshDecision: true }));
records.push(await directProposalScenario("provider-selected-content-without-amendment", 3));
records.push(await directProposalScenario("changed-clarification-changes-compiled-context", 11));
records.push(await fixture(async (environment, directory) => {
  const queues = new Map([
    [effects.clarify, [({ payload }) => {
      assert.equal(interaction(payload, "clarification"), 1007n);
      return variant(1);
    }]],
    [effects.cleanup, [null]],
    [effects.message, [replyMessage(variant(2), variant(1))]],
  ]);
  const record = await execute("clarification-abort-cleans-turn", queues, variant(0));
  assert.deepEqual(record.trace, [effects.clarify, effects.cleanup, effects.message]);
  assert.equal(await readFile(join(directory, "document.txt"), "utf8"), original);
  assert.equal((await environment.read({ path: "document.txt" })).kind, "success");
  return { ...record, commitRequests: 0 };
}));
await loadWorldRuntime({ runtimePath });
console.log(JSON.stringify({ imageSha256: hash(image), imageBytes: image.length,
  kernelSha256: runtime.identity.kernelSha256, provider: "prescribed generic simulated responses",
  liveModel: false, records }, (_key, item) => typeof item === "bigint" ? item.toString() : item));
