// Test-only data host. Dispatch leaf contracts; stop at any authored move.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { verifyRuntime } from '../../tools/agent4/dependencies.mjs';
import { fileBinding } from '../../runtime/text_file.mjs';
import { READ, CLOSE } from '../../runtime/text_inspection.mjs';
const [runtimePath, inputPath, outputPath] = process.argv.slice(2);
const identity = verifyRuntime(runtimePath), world = await import(pathToFileURL(identity.entrypoint));
const input = JSON.parse(await readFile(inputPath, 'utf8'));
const k = await world.Kernel.create({ bytes: new Uint8Array(await readFile(identity.kernelPath)), expectedSha256: identity.kernelSha256 });
k.setLimits({ input: input.limit, working: input.limit, output: input.limit });
const image = new Uint8Array(input.image), parked = world.decodeOutcome(new Uint8Array(input.outcome));
const prepared = k.prepare(image), session = k.restore(prepared, parked.state);
assert.deepEqual(k.drive(session, { checkpoint: true }), new Uint8Array(input.outcome));
const binding = await fileBinding(input.subject, { root: input.root, path: 'story.txt' });
let output = k.drive(session, { control: 'reply', value: await world.encodeResult(parked.request, new Uint8Array(input.arrival)), checkpoint: true });
for (let step = 0; step < 32; step++) {
  const outcome = world.decodeOutcome(output);
  assert.equal(outcome.kind, 'requested');
  const request = await world.decodeRequest(outcome.request);
  if (request.semanticIdentity === 'agent.mobility.relocate.v1') {
    assert.deepEqual(k.checkpoint(session, { transfer: true }), outcome.state);
    k.releasePrepared(prepared); assert.equal(k.usage().workingLive, 0n);
    await writeFile(outputPath, JSON.stringify({ output: Array.from(output), reads: binding.counts().reads.map(String), releases: binding.counts().releases, pid: process.pid, kernelSha256: identity.kernelSha256 }));
    process.exit(0);
  }
  assert.ok([READ, CLOSE].includes(request.semanticIdentity), 'data host has only configured fixture bindings');
  output = k.drive(session, { control: 'reply', value: await world.encodeResult(outcome.request, await binding.handle(request)), checkpoint: true });
}
throw new Error('Data executor did not reach relocation within test bound');
