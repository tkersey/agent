import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { serveBrowser } from '../../runtime/mobility/browser.mjs';
import { servePeers, PeerClient } from '../../runtime/mobility/transport.mjs';
import { decodeValue } from '../../runtime/values.mjs';
import { hostFixture } from './mobility_host_fixture.mjs';
import { certificates } from './mobility_tls_fixture.mjs';
assert.ok(process.env.AGENT_MOBILITY_BROWSER_TOOLS, 'AGENT_MOBILITY_BROWSER_TOOLS required');
const { chromium, firefox } = await import(pathToFileURL(join(resolve(process.env.AGENT_MOBILITY_BROWSER_TOOLS), 'node_modules/playwright-core/index.mjs')));

for (const [engine, type] of [['chromium', chromium], ['firefox', firefox]]) test(`${engine}: authenticated durable browser→mTLS data host→fresh browser`, async t => {
  const f = await hostFixture(t), tls = await certificates(f.area), services = {}, clients = [];
  for (const host of ['A', 'B']) {
    const other = host === 'A' ? 'B' : 'A';
    services[host] = await servePeers(f.hosts[host], { ...tls[host], ca: tls.ca, peerCertificates: new Map([[tls[other].fingerprint256, other]]) });
  }
  for (const [from, to] of [['A', 'B'], ['B', 'A']]) {
    const client = new PeerClient({ url: services[to].url, servername: 'localhost', fingerprint256: tls[to].fingerprint256, ca: tls.ca, key: tls[from].key, cert: tls[from].cert });
    clients.push(client); f.peerMaps[from].set(to, client);
  }
  const sessionToken = randomBytes(32).toString('hex');
  const otherToken = randomBytes(32).toString('hex');
  const sessions = new Map([
    [`mobility_session=${sessionToken}`, { sessionId: sessionToken, principal: 'user', tenant: 'tenant', audiences: ['human-A'] }],
    [`mobility_session=${otherToken}`, { sessionId: otherToken, principal: 'other', tenant: 'tenant', audiences: ['human-A'] }],
  ]);
  const origin = await serveBrowser(f.hosts.A, { ...tls.A, audience: 'human-A', runtimePath: resolve(process.env.AGENT_MOBILITY_RUNTIME),
    kernelBytes: new Uint8Array(await readFile(join(process.env.AGENT_MOBILITY_RUNTIME, 'world-kernel.wasm'))),
    authenticate: req => sessions.get(req.headers.cookie) ?? null });
  const browser = await type.launch({ headless: true });
  t.after(async () => { await browser.close(); clients.forEach(client => client.close()); await origin.close(); await Promise.all(Object.values(services).map(server => server.close())); });
  // Ephemeral self-signed test origin; peer mTLS certificate checks remain fully enabled.
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await context.addCookies([{ name: 'mobility_session', value: sessionToken, url: origin.url, httpOnly: true, secure: true, sameSite: 'Strict' }]);
  const page = await context.newPage(); await page.goto(origin.url);
  await page.evaluate(async ({ id }) => {
    const session = await (await fetch('/v1/browser/session')).json();
    const base = `/v1/browser/runs/${encodeURIComponent(id)}/`;
    window.bridge = { session, base, assignment: null, worker: null, retired: 0, output: null };
    window.encodeVersion = value => btoa(JSON.stringify(value, Object.keys(value).sort())).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
    window.api = async (name, method = 'POST', bytes = null, extra = {}) => {
      const b = window.bridge;
      const headers = { 'x-agent-csrf': b.session.csrf, ...extra };
      if (b.assignment) { headers['x-agent-assignment'] = b.assignment.nonce; headers['x-agent-version'] = window.encodeVersion(b.assignment.version); }
      const response = await fetch(base + name, { method, headers, body: bytes });
      if (!response.ok) throw new Error((await response.json()).error);
      return response;
    };
    window.workerCall = data => new Promise((resolve, reject) => {
      const worker = window.bridge.worker;
      worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data);
      worker.onerror = event => reject(new Error(event.message)); worker.postMessage(data);
    });
    window.attach = async () => {
      const b = window.bridge; if (b.worker) throw new Error('OldWorkerStillAlive');
      b.assignment = await (await window.api('attach')).json();
      const image = new Uint8Array(await (await window.api('image', 'GET')).arrayBuffer());
      const outcome = new Uint8Array(await (await window.api('outcome', 'GET')).arrayBuffer());
      b.worker = new Worker('/worker.mjs', { type: 'module' });
      b.output = (await window.workerCall({ kind: 'restore', image, outcome, runtime_profile: b.assignment.runtime_profile, origin: location.origin })).outcome;
    };
    window.advance = async () => {
      const b = window.bridge;
      const command = await (await window.api('command')).json();
      if (command.kind !== 'drive') return command;
      const reply = command.control === 'reply' ? new Uint8Array(await (await window.api('reply', 'GET')).arrayBuffer()) : [];
      b.output = (await window.workerCall({ kind: 'drive', control: command.control, reply, reason: command.reason })).outcome;
      const result = await (await window.api('report', 'POST', new Uint8Array(b.output))).json(); b.assignment.version = result.version;
      return result;
    };
    window.retire = async () => { const b = window.bridge; await window.workerCall({ kind: 'retire' }); b.worker.terminate(); b.worker = null; b.retired++; };
  }, { id: f.id });
  await page.evaluate(() => window.attach());
  const oldAssignment = await page.evaluate(() => window.bridge.assignment);
  let departure;
  for (let i = 0; i < 16; i++) { const result = await page.evaluate(() => window.advance()); if (result.kind === 'offered') { departure = result; break; } }
  assert.ok(departure); await page.evaluate(() => window.retire());
  assert.equal((await page.evaluate(async () => (await window.api('retry')).json())).kind, 'accepted');
  assert.equal(f.hosts.A.status(f.id).custody, 'DEPARTED');
  const back = await f.hosts.B.run(f.id); assert.equal(back.kind, 'offered');
  assert.equal((await f.hosts.B.retryTransfer(back.transfer_id)).kind, 'accepted');
  await page.evaluate(() => window.attach());
  const fresh = await page.evaluate(() => window.bridge.assignment); assert.notEqual(fresh.nonce, oldAssignment.nonce); assert.equal(fresh.version.custody_epoch, '2');
  for (let i = 0; i < 16; i++) { const result = await page.evaluate(() => window.advance()); if (result.status?.custody === 'TERMINAL') break; }
  assert.equal(f.hosts.A.status(f.id).custody, 'TERMINAL'); await page.evaluate(() => window.retire());
  const output = new Uint8Array(await page.evaluate(() => window.bridge.output));
  assert.deepEqual(decodeValue(f.schemas.report, f.world.decodeOutcome(output).value), [123n, 9001n, { tag: 0, value: [42n, 4n] }, 91n]);
  assert.equal(await page.evaluate(() => window.bridge.retired), 2);
  assert.deepEqual(f.file.counts(), { reads: [0n, 16n, 32n], releases: 1 }); assert.equal(f.counters.A.cleanup, 1);
  const csrfDenied = await page.evaluate(async () => (await fetch(window.bridge.base + 'attach', { method: 'POST' })).status);
  assert.equal(csrfDenied, 403);
  const csrf = await page.evaluate(() => window.bridge.session.csrf);
  assert.equal((await context.request.post(origin.url + `/v1/browser/runs/${encodeURIComponent(f.id)}/attach`, { headers: { origin: 'https://wrong.invalid', 'x-agent-csrf': csrf }, data: Buffer.alloc(0) })).status(), 403);
  const stale = await page.evaluate(async old => (await fetch(window.bridge.base + 'outcome', { headers: { 'x-agent-assignment': old.nonce, 'x-agent-version': window.encodeVersion(old.version) } })).status, oldAssignment);
  assert.equal(stale, 409);
  const unauthenticated = await browser.newContext({ ignoreHTTPSErrors: true });
  assert.equal((await unauthenticated.request.get(origin.url + '/v1/browser/session')).status(), 403); await unauthenticated.close();
  const other = await browser.newContext({ ignoreHTTPSErrors: true });
  await other.addCookies([{ name: 'mobility_session', value: otherToken, url: origin.url, httpOnly: true, secure: true, sameSite: 'Strict' }]);
  assert.equal((await other.request.get(origin.url + `/v1/browser/runs/${encodeURIComponent(f.id)}/status`)).status(), 403); await other.close();
});
