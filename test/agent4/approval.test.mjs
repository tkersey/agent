import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { decodeSchema, decodeValue, encodeValue } from "../../runtime/values.mjs";
import { verifyRuntime } from "../../tools/agent4/dependencies.mjs";

// This lane intentionally does not import Agent's convenience World bridge.
const runtimePath = resolve(process.env.AGENT4_WORLD_RUNTIME ?? ".agent4/out/world-runtime");
const before = verifyRuntime(runtimePath);
const world = await import(pathToFileURL(before.entrypoint));
const kernel = await world.admitProcessKernel(await readFile(before.kernelPath), {
  expectedSha256: before.kernelSha256,
});
const image = await readFile(resolve(process.env.AGENT4_APPROVAL_IMAGE ??
  ".agent4/out/approval/approval.bpi2"));
after(() => assert.deepEqual(verifyRuntime(runtimePath), before));

const proposalSchema = {root: 0, types: [
  {product: [1, 2, 3, 4]}, "u32", "u64", {bounded_text: 128}, "boolean",
]};
const resultSchema = {root: 0, types: [
  {sum: [1, 3, 4, 4]}, {sum: [2, 2, 5, 5]}, {product: [6, 7, 3, 8]},
  {bounded_text: 128}, "unit", "u8", "u32", "u64", "boolean",
]};
const base = () => [1, 42n, "A real replacement", true];
const value = (tag, payload) => ({tag, value: payload});

function request(outcome, identity) {
  assert.equal(outcome.kind, "Requested");
  const req = world.decodeRequest(outcome.request);
  assert.equal(req.semanticIdentity, identity);
  return {...req, decoded: decodeValue(decodeSchema(req.payloadSchema), req.payload)};
}
async function reply(outcome, response) {
  const req = world.decodeRequest(outcome.request);
  const bytes = encodeValue(decodeSchema(req.resumeSchema), response);
  const result = world.encodeResult(outcome.request, bytes);
  return kernel.run({image, state: outcome.state, result});
}
async function begin(proposal = base(), occurrence = 100n) {
  const initialArgs = encodeValue(proposalSchema, proposal);
  const issued = await kernel.run({image, initialArgs});
  assert.deepEqual(request(issued, "agent.approval.issue.v1.probe.document").decoded, proposal);
  const approval = await reply(issued, occurrence);
  const req = request(approval, "agent.interaction.exchange.v1.probe.document");
  assert.deepEqual(req.decoded, ["document-owner", "approval", null, [occurrence, proposal]]);
  return {approval, challenge: req.decoded[3], initialArgs};
}
async function decide(approval, challenge, decision, principal = 7) {
  return reply(approval, value(0, [challenge, principal, decision]));
}
function completed(outcome, expected) {
  assert.equal(outcome.kind, "Completed");
  assert.deepEqual(decodeValue(resultSchema, outcome.value), expected);
}

test("approve consumes authority once and preserves all environmental delivery outcomes", async () => {
  for (const tag of [0, 1, 2, 3]) {
    const {approval, challenge} = await begin();
    const commit = await decide(approval, challenge, value(0, null));
    assert.deepEqual(request(commit, "agent.tool.document.replace.v1").decoded, base());
    const delivered = value(tag, tag < 2 ? base() : 9);
    const outcome = await reply(commit, delivered);
    completed(outcome, value(0, delivered));
    // In particular an uncertain delivery returns to the caller, with no new
    // issuer, approval, or automatic commit request.
    assert.equal(outcome.request, undefined);
  }
});

test("exact proposal and occurrence comparison happens inside the image", async () => {
  for (const changed of [
    ([occurrence, proposal]) => [occurrence + 1n, proposal],
    ([occurrence, proposal]) => [occurrence, [2, ...proposal.slice(1)]],
    ([occurrence, proposal]) => [occurrence, [proposal[0], 43n, ...proposal.slice(2)]],
    ([occurrence, proposal]) => [occurrence, [...proposal.slice(0, 2), "Changed", true]],
    ([occurrence, proposal]) => [occurrence, [...proposal.slice(0, 3), false]],
  ]) {
    const {approval, challenge} = await begin();
    completed(await decide(approval, changed(challenge), value(0, null)), value(2, null));
  }
});

test("amendment retires the old challenge and requires another trusted occurrence", async () => {
  const {approval, challenge} = await begin();
  const amended = [1, 42n, "Another valid replacement", true];
  const issuance = await decide(approval, challenge, value(2, amended));
  assert.deepEqual(request(issuance, "agent.approval.issue.v1.probe.document").decoded, amended);
  const next = await reply(issuance, 101n);
  const current = request(next, "agent.interaction.exchange.v1.probe.document").decoded[3];
  assert.deepEqual(current, [101n, amended]);
  completed(await decide(next, challenge, value(0, null)), value(2, null));
  // A copy of the same parked occurrence can be given its actual current answer.
  // This proves local binding, not replay-proof external authority.
  const commit = await decide(next, current, value(0, null));
  assert.deepEqual(request(commit, "agent.tool.document.replace.v1").decoded, amended);
});

test("same-content amendment still invalidates a stale re-encoded decision", async () => {
  const {approval, challenge} = await begin();
  const issued = await decide(approval, challenge, value(2, base()));
  const next = await reply(issued, 102n);
  completed(await decide(next, challenge, value(0, null)), value(2, null));
});

// Independent finite application protocol model. Input dimensions come from
// the contract (reply binding, authority, decision, evidence, current version),
// rather than the interpreter's current output or implementation dispatch.
function permitted({matches, principal, decision, live, current}) {
  if (!matches) return "invalid";
  if (!principal) return "denied";
  if (decision === 1) return "rejected";
  if (decision === 2) return "issue";
  if (!live || !current) return "denied";
  return "commit";
}

test("finite approval model agrees with actual image actions across adversarial replies", async () => {
  let compared = 0;
  for (const matches of [false, true]) for (const principal of [false, true])
    for (const decision of [0, 1, 2]) for (const live of [false, true])
      for (const current of [false, true]) {
        const proposal = [1, current ? 42n : 43n, "Finite model input", live];
        const {approval, challenge} = await begin(proposal);
        const echo = matches ? challenge : [99n, proposal];
        const payload = decision === 0 ? null : decision === 1 ? "declined" : base();
        const actual = await decide(approval, echo, value(decision, payload), principal ? 7 : 8);
        const expected = permitted({matches, principal, decision, live, current});
        if (expected === "commit") request(actual, "agent.tool.document.replace.v1");
        else if (expected === "issue") request(actual, "agent.approval.issue.v1.probe.document");
        else completed(actual, expected === "invalid" ? value(2, null) :
          expected === "denied" ? value(3, null) : value(1, "declined"));
        compared++;
      }
  assert.equal(compared, 48);
});

test("stale ERS2 and malformed typed input preserve the parked authoritative State", async () => {
  const first = await begin(base(), 100n);
  const other = await begin([1, 42n, "Other occurrence", true], 101n);
  const current = world.decodeRequest(first.approval.request);
  const canonical = encodeValue(decodeSchema(current.resumeSchema),
    value(0, [first.challenge, 7, value(0, null)]));
  const stale = world.encodeResult(first.approval.request, canonical);
  const saved = Buffer.from(other.approval.state);
  await assert.rejects(kernel.run({image, state: other.approval.state, result: stale}));
  assert.deepEqual(Buffer.from(other.approval.state), saved);
  assert.throws(() => world.encodeResult(other.approval.request, Uint8Array.of(255)));
  assert.deepEqual(Buffer.from(other.approval.state), saved);
  request(await decide(other.approval, other.challenge, value(0, null)),
    "agent.tool.document.replace.v1");
});

test("required live proof binds the base across approval and every amendment", async () => {
  const evidenceImage = await readFile(resolve(process.env.AGENT4_APPROVAL_EVIDENCE_IMAGE ??
    ".agent4/out/approval/approval-evidence.bpi2"));
  const respond = async (outcome, response) => {
    const req = world.decodeRequest(outcome.request);
    const canonical = encodeValue(decodeSchema(req.resumeSchema), response);
    return kernel.run({image: evidenceImage, state: outcome.state,
      result: world.encodeResult(outcome.request, canonical)});
  };
  async function live(version) {
    const read = await kernel.run({image: evidenceImage,
      initialArgs: encodeValue(proposalSchema, base())});
    request(read, "agent.tool.document.read.version.v1");
    return respond(read, version);
  }
  completed(await live(43n), value(3, null));
  const issued = await live(42n);
  request(issued, "agent.approval.issue.v1.probe.document");
  const pending = await respond(issued, 200n);
  const challenge = request(pending, "agent.interaction.exchange.v1.probe.document").decoded[3];
  const changedBase = [1, 43n, "Amended against a different base", true];
  completed(await respond(pending, value(0, [challenge, 7, value(2, changedBase)])), value(3, null));
  const retainedBase = [1, 42n, "Amended with the actual live base", true];
  const newIssued = await respond(pending, value(0, [challenge, 7, value(2, retainedBase)]));
  assert.deepEqual(request(newIssued, "agent.approval.issue.v1.probe.document").decoded, retainedBase);
  const next = await respond(newIssued, 201n);
  const nextChallenge = request(next, "agent.interaction.exchange.v1.probe.document").decoded[3];
  const commit = await respond(next, value(0, [nextChallenge, 7, value(0, null)]));
  assert.deepEqual(request(commit, "agent.tool.document.replace.v1").decoded, retainedBase);
});

test("scoped current-policy cells survive fresh-instance approval resumption", async () => {
  const scopedImage = await readFile(resolve(process.env.AGENT4_APPROVAL_SCOPED_IMAGE ??
    ".agent4/out/approval/approval-scoped.bpi2"));
  const respond = async (outcome, response) => {
    const req = world.decodeRequest(outcome.request);
    const canonical = encodeValue(decodeSchema(req.resumeSchema), response);
    return kernel.run({image: scopedImage, state: outcome.state,
      result: world.encodeResult(outcome.request, canonical)});
  };
  for (const allowed of [false, true]) {
    const issued = await kernel.run({image: scopedImage, initialArgs: Uint8Array.of(Number(allowed))});
    assert.equal(request(issued, "agent.approval.issue.v1.probe.scoped").decoded, 42n);
    const pending = await respond(issued, 100n);
    const challenge = request(pending, "agent.interaction.exchange.v1.probe.scoped").decoded[3];
    const outcome = await respond(pending, value(0, [challenge, 0n, value(0, null)]));
    if (allowed) assert.equal(request(outcome, "agent.tool.scoped.commit.v1").decoded, 42n);
    else {
      assert.equal(outcome.kind, "Completed");
      assert.deepEqual(outcome.value, Uint8Array.of(3));
    }
  }
});
