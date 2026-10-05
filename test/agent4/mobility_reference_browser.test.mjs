import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserSessions } from '../../runtime/mobility/sessions.mjs';
import { serveBrowser } from '../../runtime/mobility/browser.mjs';
import { encodeValue } from '../../runtime/values.mjs';
import { hostFixture } from './mobility_host_fixture.mjs';
import { certificates } from './mobility_tls_fixture.mjs';
assert.ok(process.env.AGENT_MOBILITY_BROWSER_TOOLS, 'AGENT_MOBILITY_BROWSER_TOOLS required');
const { chromium, firefox } = await import(pathToFileURL(join(resolve(process.env.AGENT_MOBILITY_BROWSER_TOOLS), 'node_modules/playwright-core/index.mjs')));

for (const [name, engine] of [['chromium', chromium], ['firefox', firefox]]) for (const presentation of ['generic', 'repository-clarification']) test(`${name}: ${presentation} login and deferred answer survive origin restart`, async t => {
  const f = await hostFixture(t, { localData: true }), tls = await certificates(f.area);
  const binding = f.bindings.A.find(value => value.operation.endsWith('.task.v1'));
  binding.deferredRevision = 'fixture-human-v1';
  binding.defer = () => ({ audience: 'human-A', question: presentation === 'generic'
    ? { title: 'Inspect the admitted repository?', source: '<img src=x onerror="window.injected=true">', generation: '1' }
    : { kind: 'repository-clarification', goal: 'Inspect the admitted repository.', question: 'Which part should be inspected?', evidence: ['manifest', 'story.txt', 'digest', '<img src=x onerror="window.injected=true">', true] },
    alternatives: ['respond'], maximum_text_bytes: 256 });
  binding.answer = ({ answer }) => { assert.equal(answer.text, 'Inspect this exact snapshot.'); return encodeValue(f.schemas.task, f.taskValue); };
  const sessions = new BrowserSessions({ directory: join(f.area, 'sessions'), create: true,
    authorize: value => value.principal === 'user' && value.tenant === 'tenant' && value.audiences[0] === 'human-A' });
  const issued = sessions.issue({ principal: 'user', tenant: 'tenant', audience: 'human-A' });
  const open = () => serveBrowser(f.hosts.A, { ...tls.A, audience: 'human-A', runtimePath: resolve(process.env.AGENT_MOBILITY_RUNTIME),
    kernelBytes: awaitKernel, authenticate: req => sessions.authenticate(req), redeem: (credential, audience) => sessions.redeem(credential, audience) });
  const awaitKernel = await readFile(join(process.env.AGENT_MOBILITY_RUNTIME, 'world-kernel.wasm'));
  let origin = await open(); const browser = await engine.launch({ headless: true });
  t.after(async () => { await browser.close(); await origin.close(); sessions.close(); });
  const context = await browser.newContext({ ignoreHTTPSErrors: true }), page = await context.newPage();
  await page.goto(origin.url + '/login');
  await page.locator('#credential').fill(issued.credential);
  await page.locator('#login button').click();
  await page.waitForURL(origin.url + '/');
  assert.equal(await page.evaluate(() => document.cookie), '');
  await page.locator('#run').fill(f.id); await page.locator('#connect').click();
  await page.locator('#status').filter({ hasText: 'Connected' }).waitFor();
  await page.locator('#continue').click(); await page.locator('#answer').waitFor({ state: 'visible' });
  assert.match(await page.locator('#question').textContent(), /<img/);
  assert.equal(await page.locator('#question img').count(), 0);
  assert.equal(await page.evaluate(() => window.injected === true), false);
  const before = f.hosts.A.pendingQuestion(f.id, { principal: 'user', tenant: 'tenant', audiences: ['human-A'] });
  await page.goto('about:blank'); await origin.close(); f.restart('A'); origin = await open();
  await page.goto(origin.url); await page.locator('#run').fill(f.id); await page.locator('#connect').click();
  await page.locator('#answer').waitFor({ state: 'visible' });
  const after = f.hosts.A.pendingQuestion(f.id, { principal: 'user', tenant: 'tenant', audiences: ['human-A'] });
  assert.equal(after.pending_digest, before.pending_digest); assert.equal(after.occurrence_id, before.occurrence_id);
  assert.notEqual(after.version.executor_incarnation, before.version.executor_incarnation);
  await page.locator('#answer-text').fill('Inspect this exact snapshot.'); await page.locator('#answer button').click();
  await page.locator('#status').filter({ hasText: 'Response saved' }).waitFor();
  for (let step = 0; step < 24 && f.hosts.A.status(f.id).custody !== 'TERMINAL'; step++) {
    await page.locator('#continue').click();
    await page.waitForFunction(() => !document.querySelector('#continue').disabled);
  }
  assert.equal(f.hosts.A.status(f.id).custody, 'TERMINAL');
  assert.equal(f.counters.A.task, 0); assert.equal(f.counters.A.present, 1);
  assert.equal(await page.evaluate(() => document.cookie), '');
});

for (const [name, engine] of [['chromium', chromium], ['firefox', firefox]]) test(`${name}: unknown effect remains visibly paused without repeating it`, async t => {
  const f = await hostFixture(t, { localData: true }), tls = await certificates(f.area);
  let attempts = 0;
  f.bindings.A.find(value => value.operation.endsWith('.task.v1')).handle = () => {
    attempts++; throw new Error('FixtureReplyLost');
  };
  const sessions = new BrowserSessions({ directory: join(f.area, 'sessions'), create: true, authorize: () => true });
  const issued = sessions.issue({ principal: 'user', tenant: 'tenant', audience: 'human-A' });
  const origin = await serveBrowser(f.hosts.A, { ...tls.A, audience: 'human-A', runtimePath: resolve(process.env.AGENT_MOBILITY_RUNTIME),
    kernelBytes: await readFile(join(process.env.AGENT_MOBILITY_RUNTIME, 'world-kernel.wasm')),
    authenticate: req => sessions.authenticate(req), redeem: (credential, audience) => sessions.redeem(credential, audience) });
  const browser = await engine.launch({ headless: true });
  t.after(async () => { await browser.close(); await origin.close(); sessions.close(); });
  const context = await browser.newContext({ ignoreHTTPSErrors: true }), page = await context.newPage();
  await page.goto(origin.url + '/login');
  await page.locator('#credential').fill(issued.credential); await page.locator('#login button').click();
  await page.waitForURL(origin.url + '/');
  await page.locator('#run').fill(f.id); await page.locator('#connect').click();
  await page.locator('#status').filter({ hasText: 'Connected' }).waitFor();
  await page.locator('#continue').click();
  await page.waitForFunction(() => !document.querySelector('#continue').disabled);
  assert.equal(attempts, 1);
  for (let retry = 0; retry < 2; retry++) {
    await page.locator('#continue').click();
    await page.waitForFunction(() => !document.querySelector('#continue').disabled);
    assert.equal(await page.locator('#status').textContent(), 'Effect result unknown. The run remains paused.');
    assert.equal(attempts, 1);
  }
});
