// Thin environmental driver: the Program owns reciprocal control and callers.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const [worldEntry, kernelPath, directory, consumer = 'single', peerPath, nativeTool,
  browserTools, browserEngine = 'chromium'] = process.argv.slice(2);
if (!worldEntry || !kernelPath || !directory || process.argv.length > 10 ||
    Boolean(peerPath) !== Boolean(nativeTool) ||
    !['single', 'double'].includes(consumer))
  throw new Error('usage: node test/agent4/recursive_participant.mjs WORLD_ENTRY KERNEL IMAGE_DIRECTORY [single|double [WASMTIME_PEER NATIVE_TOOL [BROWSER_TOOLS ENGINE]]]');
const contributions = consumer === 'double' ? 2 : 1;
const { Kernel, decodeOutcome, decodeRequest, encodeResult, encodeInput } =
  await import(pathToFileURL(resolve(worldEntry)));
const read = async name => new Uint8Array(await readFile(join(directory, name)));
const bytes = new Uint8Array(await readFile(kernelPath));
const image = await read(consumer === 'double' ? 'program-alt.bpi3' : 'program.bpi3');
const input = await read('input.bin');
const reply = await read('reply.bin');
const expectedSha256 = createHash('sha256').update(bytes).digest('hex');
const peer = peerPath ? await (await import(pathToFileURL(resolve(peerPath))))
  .wasmtimePeer(resolve(kernelPath), expectedSha256) : null;
let identity = 1n;
async function fresh() {
  const kernel = await Kernel.create({ bytes, expectedSha256, instanceId: identity++ });
  kernel.setLimits({ input: 4 << 20, working: 16 << 20, output: 4 << 20 });
  return kernel;
}
const integer = value => {
  const result = new Uint8Array(8);
  new DataView(result.buffer).setBigUint64(0, BigInt(value), true);
  return result;
};
let browser;
try {
if (browserTools) browser = await (await import('./recursive_browser.mjs')).browserPeer({
  worldEntry, kernelPath, tools: browserTools, engine: browserEngine, sha256: expectedSha256,
});
let kernel = await fresh(), prepared = kernel.prepare(image);
let session = kernel.start(prepared, input);
kernel.releasePrepared(prepared);
let control = 'none', value = new Uint8Array(), transfers = 0, referenceBytes;
let firstModelReply, staleRepliesRejected = 0;
const requests = [];
const offsets = [];
const occurrences = new Set();
const checkpoints = [];
const engines = [];
for (let round = 0; ; round++) {
  assert.ok(round < 256, 'nested interaction exceeded the observation allowance');
  const invocation = { image, state: kernel.checkpoint(session), control, value, quantum: 100 };
  const command = encodeInput(invocation);
  const nodeBytes = kernel.drive(session, { control, value, quantum: 100, checkpoint: true });
  let returned = nodeBytes;
  let engine = 'Node';
  if (peer) {
    const native = new Uint8Array(execFileSync(nativeTool, ['invoke'],
      { input: command, maxBuffer: 16 << 20 }));
    const independent = (await peer.call('invoke', { bytes: command })).bytes;
    assert.deepEqual(nodeBytes, native, 'native/Node observation disagreement');
    assert.deepEqual(independent, native, 'Wasmtime/native observation disagreement');
    const alternatives = [[native, 'native'], [independent, 'Wasmtime'], [nodeBytes, 'Node']];
    if (browser) {
      const actual = await browser.invoke(invocation);
      assert.deepEqual(actual, native, 'browser/native observation disagreement');
      alternatives.unshift([actual, `${browserEngine} Worker`]);
    }
    [returned, engine] = alternatives[round % alternatives.length];
  }
  engines.push(engine);
  const outcome = decodeOutcome(returned);
  if (outcome.kind === 'completed') {
    assert.deepEqual(requests, [...Array.from({ length: contributions }, () =>
      ['fixture.recursive.reference-bytes', 'agent.model.invoke.v3']).flat(),
    'fixture.recursive.reference-bytes']);
    assert.deepEqual(offsets, [...Array(contributions).fill(0), 1]);
    assert.deepEqual(outcome.value, integer(contributions * (referenceBytes.length + 42 + 10) + 13));
    assert.equal(staleRepliesRejected, contributions - 1);
    kernel.close(session);
    assert.equal(kernel.usage().workingLive, 0n);
    break;
  }
  assert.ok(['requested', 'progressed'].includes(outcome.kind));
  if (outcome.kind === 'requested') {
    const request = await decodeRequest(outcome.request);
    const occurrence = Buffer.from(outcome.request).toString('hex');
    assert.ok(!occurrences.has(occurrence), 'fresh request reused a completed occurrence');
    occurrences.add(occurrence);
    requests.push(request.semanticIdentity);
    let response;
    switch (request.semanticIdentity) {
      case 'fixture.recursive.reference-bytes': {
        assert.equal(request.payload.length, 8);
        const offset = Number(new DataView(request.payload.buffer, request.payload.byteOffset,
          request.payload.byteLength).getBigUint64(0, true));
        offsets.push(offset);
        const actual = await readFile(new URL('./recursive-reference.txt', import.meta.url));
        assert.ok(actual.length <= 4096 && offset <= actual.length, 'reference fixture capacity');
        if (referenceBytes) assert.deepEqual(actual, referenceBytes, 'frozen reference changed');
        referenceBytes = actual;
        response = integer(actual.length - offset);
        break;
      }
      case 'agent.model.invoke.v3': {
        if (firstModelReply) {
          assert.throws(() => kernel.drive(session, { control: 'reply', value: firstModelReply,
            quantum: 100, checkpoint: true }), { code: 'WORLD_KERNEL_REJECTED' });
          assert.deepEqual(kernel.checkpoint(session), outcome.state);
          staleRepliesRejected++;
        }
        response = reply;
        break;
      }
      default: throw new Error('undeclared environmental operation');
    }
    value = await encodeResult(outcome.request, response);
    if (request.semanticIdentity === 'agent.model.invoke.v3' && !firstModelReply)
      firstModelReply = value;
    control = 'reply';
  } else {
    control = 'none';
    value = new Uint8Array();
  }
  const state = outcome.state; // Continue from the selected engine's actual returned bytes.
  assert.deepEqual(kernel.checkpoint(session, { transfer: true }), state);
  checkpoints.push(state.length);
  assert.equal(kernel.usage().workingLive, 0n);
  assert.throws(() => kernel.drive(session), { code: 'WORLD_HANDLE_INVALID' });
  kernel = await fresh();
  prepared = kernel.prepare(image);
  session = kernel.restore(prepared, state);
  kernel.releasePrepared(prepared);
  transfers++;
}
// Separate execution: enclosing cancellation must not resume the idle sibling.
let cancelling = await fresh();
let cancelPrepared = cancelling.prepare(image);
let cancelSession = cancelling.start(cancelPrepared, input);
cancelling.releasePrepared(cancelPrepared);
const pending = decodeOutcome(cancelling.drive(cancelSession, { quantum: 100, checkpoint: true }));
assert.equal(pending.kind, 'requested');
assert.equal((await decodeRequest(pending.request)).semanticIdentity, 'fixture.recursive.reference-bytes');
const cancelState = cancelling.checkpoint(cancelSession, { transfer: true });
assert.deepEqual(cancelState, pending.state);
assert.equal(cancelling.usage().workingLive, 0n);
cancelling = await fresh();
cancelPrepared = cancelling.prepare(image);
cancelSession = cancelling.restore(cancelPrepared, cancelState);
cancelling.releasePrepared(cancelPrepared);
const cancellation = { image, state: cancelState, control: 'cancel_text',
  value: new TextEncoder().encode('stop'), quantum: 100 };
let cancelledBytes = cancelling.drive(cancelSession, { ...cancellation, checkpoint: true });
if (peer) {
  const command = encodeInput(cancellation);
  const native = new Uint8Array(execFileSync(nativeTool, ['invoke'], { input: command, maxBuffer: 16 << 20 }));
  const independent = (await peer.call('invoke', { bytes: command })).bytes;
  assert.deepEqual(cancelledBytes, native);
  assert.deepEqual(independent, native);
  cancelledBytes = independent;
}
if (browser) {
  const actual = await browser.invoke(cancellation);
  assert.deepEqual(actual, cancelledBytes);
  cancelledBytes = actual;
}
const cancelled = decodeOutcome(cancelledBytes);
assert.equal(cancelled.kind, 'cancelled');
assert.deepEqual(cancelled.reason, { kind: 'text', value: 'stop' });
assert.deepEqual(cancelled.cleanupFailures, []);
cancelling.close(cancelSession);
assert.equal(cancelling.usage().workingLive, 0n);
console.log(JSON.stringify({ consumer, requests, offsets, transfers, staleRepliesRejected,
  enclosingCancellation: 'cancelled without ordinary model or sibling work',
  engines, wasmtime: peer?.identity, browser: browser?.identity,
  workersDestroyed: browser?.workersDestroyed, imageBytes: image.length,
  checkpointBytes: checkpoints, referenceBytes: referenceBytes.length,
  referenceSha256: createHash('sha256').update(referenceBytes).digest('hex'),
  kernelSha256: expectedSha256, model: 'synthetic provider response; no paid execution' }));
} finally {
  if (browser) await browser.close();
  if (peer) await peer.close();
}
