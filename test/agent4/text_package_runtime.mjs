// Execute packaged images with packaged leaf bindings; no source or emitter.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyRuntime, readDependencyLock } from "../../tools/agent4/dependencies.mjs";
import { decodeSchema, decodeValue, encodeValue } from "../../runtime/values.mjs";
import { subjectSchema, READ, CLOSE } from "../../runtime/text_inspection.mjs";
import { fileBinding } from "../../runtime/text_file.mjs";

const [runtime, examples] = process.argv.slice(2).map(path => resolve(path));
const identity = verifyRuntime(runtime), lock = readDependencyLock();
const world = await import(pathToFileURL(identity.entrypoint));
const kernelBytes = await readFile(identity.kernelPath);
const reports = [];
for (const mode of ["standalone", "agent"]) {
  const image = await readFile(join(examples, `${mode}.bpi3`));
  const initialArgs = await readFile(join(examples, `${mode}.args`));
  const initial = decodeValue(decodeSchema(await readFile(join(examples, `${mode === "agent" ? "task" : "subject"}-schema.bin`))), initialArgs);
  const declared = mode === "agent" ? initial[0] : initial;
  const binding = await fileBinding(declared, { root: examples, path: "story.txt" });
  let input = { image, initialArgs }, models = 0, humans = 0, side = 0, finished = false;
  for (let round = 0; round < 32; round++) {
    const kernel = await world.Kernel.create({ bytes: kernelBytes, expectedSha256: identity.kernelSha256 });
    const ceiling = lock.world.runtime.physicalProfile.maximumMemoryBytes;
    kernel.setLimits({ input: ceiling, working: ceiling, output: ceiling });
    const outcome = world.decodeOutcome(kernel.invoke(world.encodeInput(input)));
    if (outcome.kind === "completed") {
      const resultSchema = decodeSchema(await readFile(join(examples, `${mode === "agent" ? "report" : "result"}-schema.bin`)));
      const value = decodeValue(resultSchema, outcome.value);
      if (mode === "agent") assert.equal(value[0], 123n);
      assert.deepEqual(mode === "agent" ? value[1] : value, { tag: 0, value: [declared[2], 4n] });
      assert.deepEqual(binding.counts(), { reads: [0n, 16n, 32n], releases: 1 });
      assert.equal(models, mode === "agent" ? 1 : 0);
      assert.equal(humans, mode === "agent" ? 2 : 0);
      assert.equal(side, mode === "agent" ? 1 : 0);
      reports.push({ mode, reads: 3, cleanup: 1, models, humans, sideResumed: side });
      finished = true; break;
    }
    assert.equal(outcome.kind, "requested");
    const request = await world.decodeRequest(outcome.request);
    let reply;
    if (request.semanticIdentity === "agent.model.invoke.v3") {
      models++; reply = await readFile(join(examples, "model-reply.bin"));
    } else if (request.semanticIdentity === "agent.interaction.exchange.v1.text-continue") {
      humans++;
      reply = encodeValue(decodeSchema(request.resumeSchema), { tag: 0, value: decodeValue(decodeSchema(request.payloadSchema), request.payload)[3] });
    } else if (request.semanticIdentity === "agent.text.side-resumed.v1") {
      assert.equal(decodeValue(decodeSchema(request.payloadSchema), request.payload), 77n);
      side++; reply = new Uint8Array();
    } else {
      assert.ok([READ, CLOSE].includes(request.semanticIdentity));
      reply = await binding.handle(request);
    }
    input = { image, state: outcome.state, control: "reply", value: await world.encodeResult(outcome.request, reply) };
  }
  assert.ok(finished, "packaged text tool did not terminate");
}
console.log(JSON.stringify({ check: "packaged compiled text tool", reports }));
