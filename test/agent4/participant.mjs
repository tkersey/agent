// Actual generic-World execution. Synthetic provider bytes are proposal data;
// the checked responder inside the Program must admit their typed contribution.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [worldEntry, kernelPath, directory] = process.argv.slice(2);
if (!worldEntry || !kernelPath || !directory || process.argv.length !== 5)
  throw new Error('usage: node test/agent4/participant.mjs WORLD_ENTRY KERNEL IMAGE_DIRECTORY');
const { Kernel, decodeOutcome, decodeRequest, encodeResult } =
  await import(pathToFileURL(resolve(worldEntry)));
const read = async name => new Uint8Array(await readFile(join(directory, name)));
const bytes = new Uint8Array(await readFile(kernelPath));
const image = await read('program.bpi3');
const input = await read('input.bin');
const reply = await read('reply.bin');
const expected = await read('expected.bin');
const expectedSha256 = createHash('sha256').update(bytes).digest('hex');
let identity = 1n;
async function fresh() {
  const kernel = await Kernel.create({ bytes, expectedSha256, instanceId: identity++ });
  kernel.setLimits({ input: 4 << 20, working: 16 << 20, output: 4 << 20 });
  return kernel;
}
let kernel = await fresh();
let prepared = kernel.prepare(image);
let session = kernel.start(prepared, input);
kernel.releasePrepared(prepared);
let control = 'none', value = new Uint8Array(), requests = 0, transfers = 0;
for (let round = 0; ; round++) {
  assert.ok(round < 100, 'participant exceeded the fixture observation allowance');
  const outcome = decodeOutcome(kernel.drive(session, { control, value, quantum: 1000,
    checkpoint: true }));
  if (outcome.kind === 'completed') {
    assert.deepEqual(outcome.value, expected);
    assert.equal(requests, 1);
    kernel.close(session);
    assert.equal(kernel.usage().workingLive, 0n);
    break;
  }
  assert.ok(['requested', 'progressed'].includes(outcome.kind));
  if (outcome.kind === 'requested') {
    const request = await decodeRequest(outcome.request);
    assert.equal(request.semanticIdentity, 'agent.model.invoke.v3');
    requests++;
    assert.equal(requests, 1);
    value = await encodeResult(outcome.request, reply);
    control = 'reply';
  } else {
    control = 'none';
    value = new Uint8Array();
  }
  const state = kernel.checkpoint(session, { transfer: true });
  assert.deepEqual(state, outcome.state);
  assert.equal(kernel.usage().workingLive, 0n);
  assert.throws(() => kernel.drive(session), { code: 'WORLD_HANDLE_INVALID' });
  kernel = await fresh();
  prepared = kernel.prepare(image);
  session = kernel.restore(prepared, state);
  kernel.releasePrepared(prepared);
  transfers++;
}
console.log(JSON.stringify({ requests, transfers, imageBytes: image.length,
  kernelSha256: expectedSha256, model: 'synthetic response; no paid execution' }));
