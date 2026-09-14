import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { verifyRuntime } from "../../tools/agent4/dependencies.mjs";
import { decodeSchema, decodeValue, encodeValue } from "../../runtime/values.mjs";
import { decodeModelInvocation, normalizeOpenAIResponses } from "../../runtime/model.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const images = process.env.AGENT4_REVIEW_IMAGES ?? path.join(root, ".agent4/out/review");
const runtime = process.env.AGENT4_WORLD_RUNTIME ?? path.join(root, ".agent4/out/world-runtime");
const identity = verifyRuntime(runtime);
const world = await import(pathToFileURL(identity.entrypoint));
const kernelBytes = await readFile(identity.kernelPath);
const kernel = () => world.admitProcessKernel(kernelBytes,
  { expectedSha256: identity.kernelSha256 });

async function start(mode) {
  const image = await readFile(path.join(images, `${mode}.bpi2`));
  const initialArgs = await readFile(path.join(images, `${mode}.args`));
  return { image, outcome: await (await kernel()).run({ image, initialArgs }) };
}

function pending(session, expected) {
  assert.equal(session.outcome.kind, "Requested");
  const request = world.decodeRequest(session.outcome.request);
  assert.equal(request.semanticIdentity, expected);
  return request;
}

function payload(request) {
  return decodeValue(decodeSchema(request.payloadSchema), request.payload);
}

async function answer(session, value) {
  const request = world.decodeRequest(session.outcome.request);
  const encoded = encodeValue(decodeSchema(request.resumeSchema), value);
  await canonicalAnswer(session, encoded);
}

async function canonicalAnswer(session, encoded) {
  session.outcome = await (await kernel()).run({ image: session.image,
    state: session.outcome.state, result: world.encodeResult(session.outcome.request, encoded) });
}

// This supplies one provider result; it contains no application stage or branching policy.
function modelAnswer(request, answerValue) {
  const invocation = decodeModelInvocation(request.payload);
  const body = Buffer.from(JSON.stringify({ status: "completed", error: null, output: [{
    type: "function_call", status: "completed", call_id: "prescribed-answer",
    name: "answer", arguments: JSON.stringify({ value: answerValue }),
  }] }));
  return normalizeOpenAIResponses(body, invocation.normalizationLimits, invocation.tools);
}

async function modelReply(session, question, answerValue) {
  const request = pending(session, "agent.model.invoke.v3");
  const invocation = decodeModelInvocation(request.payload);
  assert.equal(invocation.model, "fixture-review-model");
  assert.deepEqual(invocation.messages, [{ role: "user", content: `Review question: ${question}` }]);
  await canonicalAnswer(session, modelAnswer(request, answerValue));
}

async function transfer(session) {
  const previous = Uint8Array.from(session.outcome.bytes);
  // The new instance receives only image + detached PST2. Pending operation is reconstructed.
  session.outcome = await (await kernel()).run({ image: Uint8Array.from(session.image),
    state: Uint8Array.from(session.outcome.state) });
  assert.deepEqual(session.outcome.bytes, previous);
}

test("same non-authority Ask body agrees under human, model, and rule responders", async () => {
  const human = await start("human");
  assert.equal(payload(pending(human, "agent.interaction.exchange.v1.review.answer"))[3], 7);
  await transfer(human);
  await answer(human, { tag: 0, value: 7 });
  const model = await start("model");
  await modelReply(model, 7, 7);
  const rule = await start("rule");
  for (const session of [human, model, rule]) {
    assert.equal(session.outcome.kind, "Completed");
    assert.equal(Buffer.from(session.outcome.value).readUInt32LE(), 8);
  }
  assert.deepEqual(human.outcome.value, model.outcome.value);
  assert.deepEqual(model.outcome.value, rule.outcome.value);
});

test("ReAct is an ordinary public composition with a returning headless root", async () => {
  const session = await start("react");
  assert.equal(session.outcome.kind, "Completed");
  assert.equal(Buffer.from(session.outcome.value).readUInt32LE(), 2);
});

async function reviewTurn(session, mode, input, evidence, rawScore, clarified, previous) {
  const traces = [];
  const read = pending(session, "review.evidence.read.v1");
  traces.push(read.semanticIdentity);
  assert.equal(payload(read), input);
  await answer(session, evidence);
  const question = evidence + 9;
  const clarification = async (outgoing) => {
    const request = pending(session, "agent.interaction.exchange.v1.review.clarification");
    traces.push(request.semanticIdentity);
    assert.equal(payload(request)[3], outgoing);
    await transfer(session);
    await answer(session, { tag: 0, value: clarified });
  };
  const reviewer = async (wanted) => {
    traces.push("agent.model.invoke.v3");
    await modelReply(session, wanted, rawScore);
  };
  if (mode === "mid_review") {
    await reviewer(question);
    await clarification(question + rawScore + 1);
  } else {
    await clarification(question);
    await reviewer(question + clarified);
  }
  const next = pending(session, "agent.interaction.exchange.v1.review.next");
  traces.push(next.semanticIdentity);
  assert.deepEqual(payload(next), ["review-reader", "message", null,
    [evidence, clarified, [[0, rawScore + 1], [1, clarified]], 9, previous]]);
  return traces;
}

test("independent review orders differ and a returned turn keeps the conversation alive", async () => {
  const observed = [];
  for (const mode of ["mid_review", "clarify_first"]) {
    const session = await start(mode);
    observed.push(await reviewTurn(session, mode, 7, 12, 4, 3, 0));
    await answer(session, { tag: 0, value: 2 });
    await reviewTurn(session, mode, 2, 17, 6, 2, 12);
    await answer(session, { tag: 1, value: null });
    assert.equal(session.outcome.kind, "Completed");
    const result = Buffer.from(session.outcome.value);
    assert.equal(result.readUInt32LE(0), 17);
    assert.equal(result.readUInt32LE(4), 7);
  }
  assert.deepEqual(observed[0], ["review.evidence.read.v1", "agent.model.invoke.v3",
    "agent.interaction.exchange.v1.review.clarification", "agent.interaction.exchange.v1.review.next"]);
  assert.deepEqual(observed[1], ["review.evidence.read.v1",
    "agent.interaction.exchange.v1.review.clarification", "agent.model.invoke.v3",
    "agent.interaction.exchange.v1.review.next"]);
});

test("malformed interaction replies preserve the parked continuation", async () => {
  const session = await start("human");
  const original = Uint8Array.from(session.outcome.state);
  assert.throws(() => world.encodeResult(session.outcome.request, Uint8Array.of(2)));
  assert.deepEqual(session.outcome.state, original);
  await transfer(session);
  await answer(session, { tag: 0, value: 7 });
  assert.equal(session.outcome.kind, "Completed");
  assert.equal(Buffer.from(session.outcome.value).readUInt32LE(), 8);
});

test("the image rejects unknown answers and multiple calls as authored failures", async () => {
  for (const [name, count] of [["other", 1], ["answer", 2]]) {
    const session = await start("model");
    const request = pending(session, "agent.model.invoke.v3");
    const invocation = decodeModelInvocation(request.payload);
    const output = Array.from({ length: count }, (_, index) => ({
      type: "function_call", status: "completed", call_id: `call-${index}`,
      name, arguments: '{"value":7}',
    }));
    const result = normalizeOpenAIResponses(Buffer.from(JSON.stringify({
      status: "completed", error: null, output,
    })), invocation.normalizationLimits, invocation.tools);
    await canonicalAnswer(session, result);
    assert.equal(session.outcome.kind, "Failed");
  }
});

test("every normalized model failure exits before the post-answer computation", async () => {
  const failures = [
    { tag: 1, value: "declined" },
    { tag: 2, value: 2 },
    { tag: 3, value: [0, 503] },
    { tag: 4, value: 3 },
  ];
  for (const failure of failures) {
    const session = await start("model");
    pending(session, "agent.model.invoke.v3");
    await answer(session, failure);
    assert.equal(session.outcome.kind, "Failed");
  }
});

test.after(() => verifyRuntime(runtime));
