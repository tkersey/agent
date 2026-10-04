import { artifactRoot } from "./artifacts.mjs";
// Early physical continuation witness. Not the durable custody acceptance lane.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyRuntime, readDependencyLock } from '../../tools/agent4/dependencies.mjs';
import { decodeSchema, decodeValue, encodeValue } from '../../runtime/values.mjs';
import { subject } from '../../runtime/text_inspection.mjs';
import { placement, resolution } from './mobility_fixture.mjs';
const [runtimePath, browserTools] = process.argv.slice(2).map(value => resolve(value));
const { chromium, firefox } = await import(pathToFileURL(join(browserTools, 'node_modules/playwright-core/index.mjs')));
const identity = verifyRuntime(runtimePath), world = await import(pathToFileURL(identity.entrypoint));
const image = await readFile((artifactRoot + '/agent4/mobility/program.bpi3')), kernel = await readFile(identity.kernelPath);
const reports = decodeSchema(await readFile((artifactRoot + '/agent4/mobility/report.schema')));
const area = await mkdtemp(join(tmpdir(), 'agent-mobility-browser-'));
const content = new TextEncoder().encode('alpha\nbeta gamma\ndelta epsilon zeta\nomega\n');
const declared = await subject('fixture/story', content), zeros = Array(32).fill(0);
await writeFile(join(area, 'story.txt'), content);
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/') { response.end('<!doctype html><title>Mobility continuation witness</title>'); return; }
    if (path === '/kernel.wasm') { response.setHeader('Content-Type', 'application/wasm'); response.end(kernel); return; }
    const file = path === '/worker.mjs' ? join(import.meta.dirname, 'mobility_worker.mjs') :
      /^\/world\/[a-z-]+\.mjs$/.test(path) ? join(runtimePath, 'src/embedding', path.split('/').at(-1)) : null;
    if (!file) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(file));
  } catch { response.writeHead(500); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const observed = [];
try {
  for (const [name, type] of [['chromium', chromium], ['firefox', firefox]]) {
    const browser = await type.launch({ headless: true });
    try {
      const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/`);
      const spawn = () => page.evaluate(() => { if (window.executor) throw new Error('OldWorkerStillPresent'); window.executor = new Worker('/worker.mjs', { type: 'module' }); });
      const send = data => page.evaluate(data => new Promise((resolve, reject) => {
        window.executor.onmessage = event => resolve(event.data);
        window.executor.onerror = event => reject(new Error(event.message));
        window.executor.postMessage(data);
      }), data);
      const terminate = () => page.evaluate(() => { window.executor.terminate(); window.executor = null; });
      const initial = { image: Array.from(image), sha256: identity.kernelSha256, limit: readDependencyLock().world.runtime.physicalProfile.maximumMemoryBytes };
      const decode = answer => { assert.equal(answer.error, undefined); return world.decodeOutcome(new Uint8Array(answer.output)); };
      const reply = async (outcome, value) => send({ kind: 'reply', value: Array.from(encodeValue(decodeSchema((await world.decodeRequest(outcome.request)).resumeSchema), value)) });
      const arrival = async (outcome, host, epoch) => encodeValue(decodeSchema((await world.decodeRequest(outcome.request)).resumeSchema), { tag: 0, value: [host, epoch, `transfer-${epoch}`, zeros, [host, zeros, zeros, 'fixture-policy', Array.from(Buffer.from(identity.kernelSha256, 'hex'))]] });
      await spawn();
      let answer = await send({ ...initial, kind: 'start', args: Array.from(encodeValue({ root: 0, types: ['u64'] }, 123n)) });
      let outcome = decode(answer);
      assert.equal((await world.decodeRequest(outcome.request)).semanticIdentity, 'agent.mobility.fixture.task.v1');
      answer = await reply(outcome, [123n, 9001n, declared, placement('B', 2, 'inspect'), placement('A', 1, 'present')]);
      outcome = decode(answer);
      const resolveRequest = await world.decodeRequest(outcome.request);
      assert.equal(resolveRequest.semanticIdentity, 'agent.mobility.resolve.v1');
      answer = await reply(outcome, resolution(decodeValue(decodeSchema(resolveRequest.payloadSchema), resolveRequest.payload), 'A', identity.kernelSha256));
      outcome = decode(answer);
      assert.equal((await world.decodeRequest(outcome.request)).semanticIdentity, 'agent.mobility.relocate.v1');
      const retired = await send({ kind: 'retire' });
      assert.equal(retired.error, undefined); assert.equal(retired.live, '0');
      assert.deepEqual(new Uint8Array(retired.state), outcome.state);
      await terminate(); // A1 is physically gone before B restores.
      const inputPath = join(area, `${name}-input.json`), outputPath = join(area, `${name}-output.json`);
      await writeFile(inputPath, JSON.stringify({ ...initial, outcome: answer.output, arrival: Array.from(await arrival(outcome, 'B', 1n)), subject: declared, root: area }, (_, value) => typeof value === 'bigint' ? value.toString() : value));
      execFileSync(process.execPath, [join(import.meta.dirname, 'mobility_file_peer.mjs'), runtimePath, inputPath, outputPath]);
      const peer = JSON.parse(await readFile(outputPath, 'utf8'));
      assert.equal(peer.kernelSha256, identity.kernelSha256);
      assert.deepEqual(peer.reads, ['0', '16', '32']); assert.equal(peer.releases, 1);
      assert.throws(() => process.kill(peer.pid, 0), { code: 'ESRCH' }, 'data executor exited before A2 attaches');
      const returning = world.decodeOutcome(new Uint8Array(peer.output));
      assert.equal((await world.decodeRequest(returning.request)).semanticIdentity, 'agent.mobility.relocate.v1');
      await spawn(); // A2 is a new Worker with no prior resident handles.
      answer = await send({ ...initial, kind: 'restore', state: Array.from(returning.state) });
      assert.deepEqual(answer.output, peer.output);
      answer = await send({ kind: 'reply', value: Array.from(await arrival(returning, 'A', 2n)) });
      const trace = [];
      for (let step = 0; step < 8; step++) {
        outcome = decode(answer);
        if (outcome.kind === 'completed') break;
        assert.equal(outcome.kind, 'requested');
        const request = await world.decodeRequest(outcome.request);
        trace.push(request.semanticIdentity);
        assert.ok(['agent.mobility.fixture.present.v1', 'agent.mobility.fixture.child-resumed.v1', 'agent.mobility.fixture.child-cleanup.v1'].includes(request.semanticIdentity));
        answer = await reply(outcome, null);
      }
      assert.equal(outcome.kind, 'completed'); assert.equal(answer.live, '0');
      assert.deepEqual(decodeValue(reports, outcome.value), [123n, 9001n, { tag: 0, value: [BigInt(content.length), 4n] }, 91n]);
      assert.deepEqual(trace, ['agent.mobility.fixture.present.v1', 'agent.mobility.fixture.child-resumed.v1', 'agent.mobility.fixture.child-cleanup.v1']);
      await terminate();
      observed.push({ engine: name, version: browser.version(), retiredWorkers: 2, retiredDataProcesses: 1, readOffsets: peer.reads, trace });
    } finally { await browser.close(); }
  }
  console.log(JSON.stringify({ check: 'mobility-browser-continuation-scaffold', kernelSha256: identity.kernelSha256, imageBytes: image.length, observed }));
} finally { await new Promise(resolve => server.close(resolve)); await rm(area, { recursive: true, force: true }); }
