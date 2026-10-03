import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { decodeValue } from '../../runtime/values.mjs';
import { packageFixture } from './mobility_package_fixture.mjs';
assert.ok(process.env.AGENT_MOBILITY_BROWSER_TOOLS, 'AGENT_MOBILITY_BROWSER_TOOLS required');
const { chromium, firefox } = await import(pathToFileURL(join(resolve(process.env.AGENT_MOBILITY_BROWSER_TOOLS), 'node_modules/playwright-core/index.mjs')));

for (const [engine, type] of [['chromium', chromium], ['firefox', firefox]]) test(`${engine}: source-free durable browser→separate mTLS Node process→fresh browser`, async t => {
  const f = await packageFixture(t), { tls, serveBrowser } = f;
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
  t.after(async () => { await browser.close(); await origin.close(); });
  // Ephemeral self-signed test origin; peer mTLS certificate checks remain fully enabled.
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await context.addCookies([{ name: 'mobility_session', value: sessionToken, url: origin.url, httpOnly: true, secure: true, sameSite: 'Strict' }]);
  const page = await context.newPage(); await page.goto(origin.url);
  await page.evaluate(async ({ id }) => {
    const { BrowserExecutor } = await import('/client.mjs');
    window.presentations = [];
    window.bridge = await new BrowserExecutor(id, value => {
      document.querySelector('#request').textContent = JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item);
      if (value.operation?.endsWith('.present.v1')) window.presentations.push(JSON.parse(document.querySelector('#request').textContent));
    }).initialize();
    window.api = (...args) => window.bridge.api(...args);
    window.attach = () => window.bridge.attach();
    window.advance = () => window.bridge.advance();
    window.retire = () => window.bridge.retire();
    window.encodeVersion = value => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value, Object.keys(value).sort())))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  }, { id: f.id });
  await page.evaluate(() => window.attach());
  const oldAssignment = await page.evaluate(() => window.bridge.assignment);
  let departure;
  for (let i = 0; i < 16; i++) { const result = await page.evaluate(() => window.advance()); if (result.kind === 'offered') { departure = result; break; } }
  assert.ok(departure); await page.evaluate(() => window.retire());
  assert.equal((await page.evaluate(async () => (await window.api('retry')).json())).kind, 'accepted');
  assert.equal(f.hosts.A.status(f.id).custody, 'DEPARTED');
  await f.waitForReturn(); await f.stopB();
  assert.equal(f.statusB().custody, 'DEPARTED');
  await page.evaluate(() => window.attach());
  const fresh = await page.evaluate(() => window.bridge.assignment); assert.notEqual(fresh.nonce, oldAssignment.nonce); assert.equal(fresh.version.custody_epoch, '2');
  for (let i = 0; i < 16; i++) { const result = await page.evaluate(() => window.advance()); if (result.status?.custody === 'TERMINAL') break; }
  assert.equal(f.hosts.A.status(f.id).custody, 'TERMINAL'); await page.evaluate(() => window.retire());
  const output = new Uint8Array(await page.evaluate(() => Array.from(window.bridge.output)));
  assert.deepEqual(decodeValue(f.schemas.report, f.world.decodeOutcome(output).value), [123n, 9001n, { tag: 0, value: [42n, 4n] }, 91n]);
  assert.equal(await page.evaluate(() => window.bridge.retired), 2);
  assert.deepEqual(await page.evaluate(() => window.presentations), [{ kind: 'requested', operation: 'agent.mobility.fixture.present.v1', payload: { tag: 0, value: ['42', '4'] } }]);
  assert.deepEqual(f.dataStatistics()['agent.text.read-chunk.v1'], { calls: 3, reads: ['0', '16', '32'], releases: 0 });
  assert.equal(f.dataStatistics()['agent.text.close.v1'].calls, 1);
  assert.equal(f.deploymentA.statistics()['agent.mobility.fixture.child-cleanup.v1'].calls, 1);
  const replacementPid = await f.startB(); assert.notEqual(replacementPid, f.pid); await f.stopB();
  assert.equal(f.dataStatistics()['agent.text.read-chunk.v1'].calls, 0, 'departed custody must not restart application work');
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
