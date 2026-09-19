import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, copyFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { verifyRuntime, readDependencyLock } from "../../tools/agent4/dependencies.mjs";
import { encodeValue, decodeValue, decodeSchema } from "../../runtime/values.mjs";
import { subject, memoryBinding, bindSubject, READ, CLOSE } from "../../runtime/text_inspection.mjs";
import { fileBinding } from "../../runtime/text_file.mjs";
import { MODEL_EFFECT, decodeModelInvocation, normalizeOpenAIResponses } from "../../runtime/model.mjs";

const [emitter, linker, runtimePath] = process.argv.slice(2).map(value => resolve(value));
const identity = verifyRuntime(runtimePath), lock = readDependencyLock();
const world = await import(pathToFileURL(identity.entrypoint));
const kernelBytes = new Uint8Array(await readFile(identity.kernelPath));
const area = await mkdtemp(join(tmpdir(), "agent-compiled-text-"));
const content = new TextEncoder().encode("alpha\nbeta gamma\ndelta epsilon zeta\nomega\n");
const declared = await subject("fixture/story", content);
const SIDE = "agent.text.side-resumed.v1";
const HUMAN = "agent.interaction.exchange.v1.text-continue";
const challenge = request => decodeValue(decodeSchema(request.payloadSchema), request.payload)[3];
const humanReply = (request, value = challenge(request)) => encodeValue(decodeSchema(request.resumeSchema), { tag: 0, value });
function modelReply(request) {
  const invocation = decodeModelInvocation(request.payload);
  assert.equal(invocation.tools.length, 1);
  assert.equal(invocation.tools[0].name, "inspect_text");
  assert.equal(invocation.tools[0].description, "Count bytes and LF newlines in a declared immutable text subject");
  assert.deepEqual(invocation.messages, [{ role: "user", content: "Inspect current subject: fixture/story" }]);
  return normalizeOpenAIResponses(new TextEncoder().encode(JSON.stringify({ status: "completed", error: null, output: [{
    type: "function_call", status: "completed", call_id: "text-fixture", name: "inspect_text", arguments: "{}",
  }] })), invocation.normalizationLimits, invocation.tools);
}
let links = 0, transfers = 0;
try {
  const object = execFileSync(emitter);
  const objectSha256 = createHash("sha256").update(object).digest("hex");
  await writeFile(join(area, "text.bmo1"), object);
  await copyFile(linker, join(area, "link"));
  // No emitter, authoring source, or compiler driver is transported here.
  assert.deepEqual((await readdir(area)).sort(), ["link", "text.bmo1"]);
  const schema = name => decodeSchema(execFileSync(join(area, "link"), [`${name}-schema`], { cwd: area }));
  const subjects = schema("subject"), tasks = schema("task"), results = schema("result"), reports = schema("report");
  const images = {};
  for (const mode of ["standalone", "agent"]) { images[mode] = new Uint8Array(execFileSync(join(area, "link"), [mode, "text.bmo1"], { cwd: area })); links++; }
  assert.notDeepEqual(images.standalone, images.agent);
  const path = join(area, "story.txt"); await writeFile(path, content);
  const kernel = async () => {
    const k = await world.Kernel.create({ bytes: kernelBytes, expectedSha256: identity.kernelSha256 });
    const ceiling = lock.world.runtime.physicalProfile.maximumMemoryBytes;
    k.setLimits({ input: ceiling, working: ceiling, output: ceiling });
    return k;
  };
  async function run(mode, mutation = null) {
    const image = images[mode], binding = await fileBinding(declared, { root: area, path: "story.txt" });
    let input = { image, initialArgs: encodeValue(mode === "agent" ? tasks : subjects, mode === "agent" ? [declared, 123n] : declared) };
    let models = 0, side = 0, humans = 0;
    const questions = [];
    for (let round = 0; round < 32; round++) {
      const k = await kernel();
      const outcome = world.decodeOutcome(k.invoke(world.encodeInput(input)));
      if (outcome.kind === "completed") {
        const value = decodeValue(mode === "agent" ? reports : results, outcome.value);
        if (mode === "agent") assert.equal(value[0], 123n);
        assert.equal(models, mode === "agent" ? 1 : 0);
        assert.equal(side, mode === "agent" ? 1 : 0);
        assert.equal(humans, mode === "agent" ? 2 : 0);
        return { result: mode === "agent" ? value[1] : value, counts: binding.counts(), questions };
      }
      assert.equal(outcome.kind, "requested");
      const request = await world.decodeRequest(outcome.request);
      assert.ok([READ, CLOSE, MODEL_EFFECT, SIDE, HUMAN].includes(request.semanticIdentity));
      if (request.semanticIdentity === HUMAN) questions.push(challenge(request)[1]);
      const overridden = mutation ? await mutation(request, round) : undefined;
      let reply;
      if (overridden !== undefined) reply = overridden;
      else if (request.semanticIdentity === MODEL_EFFECT) { models++; reply = modelReply(request); }
      else if (request.semanticIdentity === HUMAN) { humans++; reply = humanReply(request); }
      else if (request.semanticIdentity === SIDE) {
        assert.equal(decodeValue(decodeSchema(request.payloadSchema), request.payload), 77n);
        side++; reply = new Uint8Array();
      } else reply = await binding.handle(request);
      input = { image, state: outcome.state, control: "reply", value: await world.encodeResult(outcome.request, reply) };
      transfers++;
    }
    throw new Error("tool did not terminate");
  }
  for (const mode of ["standalone", "agent"]) {
    const result = await run(mode);
    assert.deepEqual(result.result, { tag: 0, value: [BigInt(content.length), 4n] });
    assert.deepEqual(result.counts, { reads: [0n, 16n, 32n], releases: 1 });
  }
  const changed = await run("agent", async (request, round) => {
    if (request.semanticIdentity === READ && decodeValue(decodeSchema(request.payloadSchema), request.payload)[1] === 16n) await writeFile(path, "changed subject\n");
  });
  assert.equal(changed.result.tag, 2); assert.equal(changed.counts.releases, 1);
  await writeFile(path, content);
  const interrupted = await run("agent", request => request.semanticIdentity === READ
    ? encodeValue(decodeSchema(request.resumeSchema), { tag: 3, value: null }) : undefined);
  assert.equal(interrupted.result.tag, 3);
  assert.equal(interrupted.counts.releases, 1);
  assert.deepEqual(interrupted.counts.reads, []);
  let oldQuestion, staleSupplied = false;
  const staleHuman = await run("agent", request => {
    if (request.semanticIdentity !== HUMAN) return;
    const q = challenge(request);
    if (q[1] === 1n) oldQuestion = structuredClone(q);
    else if (!staleSupplied) { staleSupplied = true; return humanReply(request, oldQuestion); }
  });
  assert.deepEqual(staleHuman.questions, [1n, 2n, 2n]);
  assert.equal(staleHuman.result.tag, 0);
  const k = await kernel();
  let first = world.decodeOutcome(k.invoke(world.encodeInput({ image: images.agent, initialArgs: encodeValue(tasks, [declared, 123n]) })));
  for (let step = 0; step < 2; step++) {
    const pending = await world.decodeRequest(first.request);
    const reply = pending.semanticIdentity === MODEL_EFFECT ? modelReply(pending) : humanReply(pending);
    first = world.decodeOutcome(k.invoke(world.encodeInput({ image: images.agent, state: first.state, control: "reply", value: await world.encodeResult(first.request, reply) })));
  }
  const request = await world.decodeRequest(first.request);
  const memory = memoryBinding(declared, content);
  assert.deepEqual(await memory.handle(request), await (await fileBinding(declared, { root: area, path: "story.txt" })).handle(request));
  await assert.rejects(memoryBinding(["other", declared[1], declared[2]], content).handle(request), { code: "TEXT_SUBJECT_MISSING" });
  await assert.rejects(memory.handle({ ...request, resumeSchema: new Uint8Array() }), { code: "TEXT_SCHEMA_MISMATCH" });
  await assert.rejects(bindSubject(declared, null).handle(request), { code: "TEXT_OPERATION_MISSING" });
  const wrongVersion = structuredClone(declared); wrongVersion[1][0] ^= 1;
  const changedVersion = await memoryBinding(wrongVersion, content).handle(request);
  assert.equal(decodeValue(decodeSchema(request.resumeSchema), changedVersion).tag, 2);
  assert.throws(() => k.invoke(world.encodeInput({ image: images.standalone, state: first.state })), error => error.details?.diagnostic === "InvalidState");
  const oldReply = await world.encodeResult(first.request, await memory.handle(request));
  const second = world.decodeOutcome(k.invoke(world.encodeInput({ image: images.agent, state: first.state, control: "reply", value: oldReply })));
  const retained = Uint8Array.from(second.state);
  assert.throws(() => k.invoke(world.encodeInput({ image: images.agent, state: second.state, control: "reply", value: oldReply })), error => error.details?.diagnostic === "InvalidResult");
  assert.deepEqual(second.state, retained);
  const cancelled = world.decodeOutcome(k.invoke(world.encodeInput({ image: images.agent, state: first.state, control: "cancel_text", value: "cancel tool read" })));
  assert.equal((await world.decodeRequest(cancelled.request)).semanticIdentity, CLOSE);
  const complete = world.decodeOutcome(k.invoke(world.encodeInput({ image: images.agent, state: cancelled.state, control: "reply", value: await world.encodeResult(cancelled.request, await memory.handle(await world.decodeRequest(cancelled.request))) })));
  assert.equal(complete.kind, "cancelled");
  assert.equal(memory.counts().releases, 1);
  assert.deepEqual(await readFile(join(area, "text.bmo1")), object);
  console.log(JSON.stringify({ check: "compiled text tool in standalone and Agent programs", objectSha256, objectBytes: object.length, imageBytes: Object.fromEntries(Object.entries(images).map(([name, bytes]) => [name, bytes.length])), componentEmissions: 1, links, transfers }));
} finally { await rm(area, { recursive: true, force: true }); }
