import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, appendFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes, createPrivateKey } from 'node:crypto';
import { parse } from '../../runtime/mobility/protocol.mjs';
import { decodeValue } from '../../runtime/values.mjs';
import { packageFixture } from './mobility_package_fixture.mjs';
assert.ok(process.env.AGENT_MOBILITY_BROWSER_TOOLS, 'AGENT_MOBILITY_BROWSER_TOOLS required');
const { chromium, firefox } = await import(pathToFileURL(join(resolve(process.env.AGENT_MOBILITY_BROWSER_TOOLS), 'node_modules/playwright-core/index.mjs')));

for (const imageMode of ['ensure', 'yielding']) for (const [engine, type] of [['chromium', chromium], ['firefox', firefox]]) test(`${engine} ${imageMode}: source-free durable browser→separate mTLS Node process→fresh browser`, async t => {
  const f = await packageFixture(t, { imageMode }), { tls, serveBrowser } = f;
  const measure = process.env.AGENT_MOBILITY_BROWSER_MEASURE && imageMode === 'ensure';
  const timings = { mirror_publication_ms: 0, command_ms: 0 };
  if (measure) for (const [method, metric] of [['publishExecutor', 'mirror_publication_ms'], ['executorCommand', 'command_ms']]) {
    const original = f.hosts.A[method].bind(f.hosts.A);
    f.hosts.A[method] = async (...args) => { const begin = performance.now(); try { return await original(...args); } finally { timings[metric] += performance.now() - begin; } };
  }
  const sessionToken = randomBytes(32).toString('hex');
  const otherToken = randomBytes(32).toString('hex');
  const wrongAudienceToken = randomBytes(32).toString('hex');
  const sessions = new Map([
    [`mobility_session=${sessionToken}`, { sessionId: sessionToken, principal: 'user', tenant: 'tenant', audiences: ['human-A'] }],
    [`mobility_session=${otherToken}`, { sessionId: otherToken, principal: 'other', tenant: 'tenant', audiences: ['human-A'] }],
    [`mobility_session=${wrongAudienceToken}`, { sessionId: wrongAudienceToken, principal: 'user', tenant: 'tenant', audiences: ['different-human'] }],
  ]);
  const origin = await serveBrowser(f.hosts.A, { ...tls.A, audience: 'human-A', runtimePath: resolve(process.env.AGENT_MOBILITY_RUNTIME),
    kernelBytes: new Uint8Array(await readFile(join(process.env.AGENT_MOBILITY_RUNTIME, 'world-kernel.wasm'))),
    authenticate: req => sessions.get(req.headers.cookie) ?? null });
  const browser = await type.launch({ headless: true });
  t.after(async () => { await browser.close(); await origin.close(); });
  // Ephemeral self-signed test origin; peer mTLS certificate checks remain fully enabled.
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await context.addCookies([{ name: 'mobility_session', value: sessionToken, url: origin.url, httpOnly: true, secure: true, sameSite: 'Strict' }]);
  const page = await context.newPage(); await page.goto(origin.url);
  await page.evaluate(async ({ id }) => {
    const { BrowserExecutor } = await import('/client.mjs');
    window.presentations = []; window.snapshots = []; window.payloadLog = []; window.yields = 0;
    window.bridge = await new BrowserExecutor(id, value => {
      document.querySelector('#request').textContent = JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item);
      window.snapshots.push(Array.from(window.bridge.output)); window.payloadLog.push(document.querySelector('#request').textContent);
      if (value.kind === 'yielded') window.yields++;
      if (value.operation?.endsWith('.present.v1')) window.presentations.push(JSON.parse(document.querySelector('#request').textContent));
    }).initialize();
    window.api = (...args) => window.bridge.api(...args);
    window.attach = () => window.bridge.attach();
    window.advance = () => window.bridge.advance();
    window.retire = () => window.bridge.retire();
    window.encodeVersion = value => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value, Object.keys(value).sort())))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  }, { id: f.id });
  const begin = performance.now();
  await page.evaluate(() => window.attach());
  const oldAssignment = await page.evaluate(() => window.bridge.assignment);
  let departure;
  for (let i = 0; i < 16; i++) { const result = await page.evaluate(() => window.advance()); if (result.kind === 'offered') { departure = result; break; } }
  assert.ok(departure); await page.evaluate(() => window.retire());
  assert.equal((await page.evaluate(async () => (await window.api('retry')).json())).kind, 'accepted');
  assert.equal(f.hosts.A.status(f.id).custody, 'DEPARTED');
  await f.waitForReturn(); await f.stopB();
  const dataStatus = f.statusB(); assert.equal(dataStatus.custody, 'DEPARTED');
  await page.evaluate(() => window.attach());
  const fresh = await page.evaluate(() => window.bridge.assignment); assert.notEqual(fresh.nonce, oldAssignment.nonce); assert.equal(fresh.version.custody_epoch, '2');
  for (let i = 0; i < 16; i++) { const result = await page.evaluate(() => window.advance()); if (result.status?.custody === 'TERMINAL') break; }
  assert.equal(f.hosts.A.status(f.id).custody, 'TERMINAL'); await page.evaluate(() => window.retire());
  const totalMs = performance.now() - begin;
  const output = new Uint8Array(await page.evaluate(() => Array.from(window.bridge.output)));
  assert.deepEqual(decodeValue(f.schemas.report, f.world.decodeOutcome(output).value), [123n, 9001n, { tag: 0, value: [42n, 4n] }, 91n]);
  assert.equal(await page.evaluate(() => window.bridge.retired), 2);
  assert.equal(await page.evaluate(() => window.yields), imageMode === 'yielding' ? 3 : 0);
  assert.deepEqual(await page.evaluate(() => window.presentations), [{ kind: 'requested', operation: 'agent.mobility.fixture.present.v1', payload: { tag: 0, value: ['42', '4'] } }]);
  assert.deepEqual(f.dataStatistics()['agent.text.read-chunk.v1'], { calls: 3, reads: ['0', '16', '32'], releases: 0 });
  assert.equal(f.dataStatistics()['agent.text.close.v1'].calls, 1);
  assert.equal(f.deploymentA.statistics()['agent.mobility.fixture.child-cleanup.v1'].calls, 1);
  const privateSeeds = [...Object.values(f.pairs).map(pair => Buffer.from(pair.privateKey.export({ format: 'jwk' }).d, 'base64url')),
    ...['A', 'B'].map(host => Buffer.from(createPrivateKey(tls[host].key).export({ format: 'jwk' }).d, 'base64url')), Buffer.from(sessionToken)];
  const artifacts = [['image', f.image], ['use archive', f.archiveContents], ['process logs', Buffer.from(JSON.stringify(f.processLogs()))],
    ['payload log', Buffer.from(await page.evaluate(() => window.payloadLog.join('\n')))],
    ...await page.evaluate(() => window.snapshots).then(values => values.map((bytes, index) => [`browser outcome ${index}`, Buffer.from(bytes)]))];
  for (const id of [departure.transfer_id, dataStatus.transfer_id]) {
    const transfer = f.journals.A.transfer(id), offer = parse(transfer.offer);
    artifacts.push(['offer', transfer.offer], ['receipt', transfer.receipt], ['parked outcome', f.journals.A.artifact('tenant', offer.outcome_digest)]);
  }
  for (const [label, bytes] of artifacts) for (const secret of privateSeeds) assert.equal(Buffer.from(bytes).includes(secret), false, `credential sentinel leaked into ${label}`);
  assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie]), [0, 0, '']);
  if (measure) await appendFile(process.env.AGENT_MOBILITY_BROWSER_MEASURE, JSON.stringify({ engine, version: browser.version(), total_ms: totalMs, ...timings,
    method: 'Attach Worker A1 through terminal A2 including separate Node-process retirement; browser launch/provisioning excluded; test orchestration and bounded host polling included. Mirror publication includes durable journal commit.' }) + '\n');
  const replacementPid = await f.startB(); assert.notEqual(replacementPid, f.pid); await f.stopB();
  assert.equal(f.dataStatistics()['agent.text.read-chunk.v1'].calls, 0, 'departed custody must not restart application work');
  const csrfDenied = await page.evaluate(async () => (await fetch(window.bridge.base + 'attach', { method: 'POST' })).status);
  assert.equal(csrfDenied, 403);
  const csrf = await page.evaluate(() => window.bridge.session.csrf);
  assert.equal((await context.request.post(origin.url + `/v1/browser/runs/${encodeURIComponent(f.id)}/attach`, { headers: { origin: 'https://wrong.invalid', 'x-agent-csrf': csrf }, data: Buffer.alloc(0) })).status(), 403);
  const stale = await page.evaluate(async old => (await fetch(window.bridge.base + 'outcome', { headers: { 'x-agent-assignment': old.nonce, 'x-agent-version': window.encodeVersion(old.version) } })).status, oldAssignment);
  assert.equal(stale, 409);
  const staleCommand = await page.evaluate(async old => (await fetch(window.bridge.base + 'command', { method: 'POST', headers: { 'x-agent-csrf': window.bridge.session.csrf, 'x-agent-assignment': old.nonce, 'x-agent-version': window.encodeVersion(old.version) } })).status, oldAssignment);
  assert.equal(staleCommand, 409);
  const metrics = await page.evaluate(async () => (await window.api('metrics', 'GET')).json());
  assert.equal(metrics.stale_dispatch_rejections_since_open, 1); assert.equal(metrics.known_custodian, 'A');
  const unauthenticated = await browser.newContext({ ignoreHTTPSErrors: true });
  assert.equal((await unauthenticated.request.get(origin.url + '/v1/browser/session')).status(), 403); await unauthenticated.close();
  const other = await browser.newContext({ ignoreHTTPSErrors: true });
  await other.addCookies([{ name: 'mobility_session', value: otherToken, url: origin.url, httpOnly: true, secure: true, sameSite: 'Strict' }]);
  assert.equal((await other.request.get(origin.url + `/v1/browser/runs/${encodeURIComponent(f.id)}/status`)).status(), 403); await other.close();
  const wrongAudience = await browser.newContext({ ignoreHTTPSErrors: true });
  await wrongAudience.addCookies([{ name: 'mobility_session', value: wrongAudienceToken, url: origin.url, httpOnly: true, secure: true, sameSite: 'Strict' }]);
  assert.equal((await wrongAudience.request.get(origin.url + `/v1/browser/runs/${encodeURIComponent(f.id)}/status`)).status(), 403); await wrongAudience.close();
});
