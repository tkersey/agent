// Independent expected outcomes for the production repository application.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { certificates } from './mobility_tls_fixture.mjs';
import { repositoryFixture as fixture } from './repository_application_fixture.mjs';
const { BrowserSessions } = await import(pathToFileURL(resolve(process.env.AGENT_MOBILE_PACKAGE ?? new URL('../..', import.meta.url).pathname, 'runtime/mobility/sessions.mjs')));
const { serveBrowser } = await import(pathToFileURL(resolve(process.env.AGENT_MOBILE_PACKAGE ?? new URL('../..', import.meta.url).pathname, 'runtime/mobility/browser.mjs')));

test('actual private approval grants exactly the prepared managed publication', async t => {
  const f = await fixture(t); assert.equal((await f.run()).kind, 'terminal');
  const result = f.result(); assert.equal(result.tag, 0); assert.equal(result.value.tag, 0);
  const receipt = JSON.parse(result.value.value); assert.equal(receipt.commit, await f.store.current());
  assert.equal(receipt.verification.status, 'PublishedVerified');
  assert.deepEqual(f.moves, [['W', 'U'], ['U', 'W']]);
  assert.notEqual(receipt.commit, f.base); assert.deepEqual(f.counts, { check: 1, publish: 1, human: 1 });
  assert.equal(f.checkAllowance().used.attempts, 1);
});
for (const option of ['staleAnswer', 'wrongPrincipal']) test(`actual approval rejects ${option} without reaching publisher`, async t => {
  const f = await fixture(t, { [option]: true }); assert.equal((await f.run()).kind, 'terminal');
  assert.notEqual(f.result().tag, 0); assert.equal(f.counts.publish, 0); assert.equal(await f.store.current(), f.base);
});
test('lost publication reply resumes its actual checkpoint and recovers without repeating the protected leaf', async t => {
  const f = await fixture(t, { lostReply: true });
  await assert.rejects(f.run(), { code: 'FixtureLostReply' });
  const commit = await f.store.current(); assert.notEqual(commit, f.base);
  f.journal.collectArtifacts('tenant'); f.restart();
  assert.equal((await f.run()).kind, 'terminal');
  assert.deepEqual(f.moves, [['W', 'U'], ['U', 'W']]);
  const result = f.result(), receipt = JSON.parse(result.value.value);
  assert.equal(result.tag, 0); assert.equal(result.value.tag, 0); assert.equal(receipt.commit, commit); assert.equal(receipt.recovered, true);
  assert.equal(f.status().delivery.status, "published"); assert.equal(f.status().delivery.receipt.commit, commit);
  assert.deepEqual(f.counts, { check: 1, publish: 1, human: 1 });
  assert.equal(f.checkAllowance().used.attempts, 1);
});

if (process.env.AGENT_MOBILITY_BROWSER_TOOLS) {
  const { chromium, firefox } = await import(pathToFileURL(join(resolve(process.env.AGENT_MOBILITY_BROWSER_TOOLS), 'node_modules/playwright-core/index.mjs')));
  for (const [name, engine] of [['chromium', chromium], ['firefox', firefox]]) test(`${name}: authenticated exact-change approval is inert and resumes the protected program`, async t => {
    const content = '<img src=x onerror="window.injected=true">\n' + 'x'.repeat(32000) + '\n';
    const f = await fixture(t, { content, onQuestion: async ({ root, host, id, kernelBytes, pending, content }) => {
      assert(Buffer.byteLength(JSON.stringify(pending)) > 65536, 'exercise a complete large proposal');
      const tls = await certificates(root), sessions = new BrowserSessions({ directory: join(root, 'sessions'), create: true,
        authorize: identity => identity.principal === 'user' && identity.tenant === 'tenant' && identity.audiences[0] === 'human' });
      const issued = sessions.issue({ principal: 'user', tenant: 'tenant', audience: 'human' });
      const origin = await serveBrowser(host, { ...tls.A, audience: 'human', runtimePath: resolve(process.env.AGENT_MOBILITY_RUNTIME), kernelBytes,
        authenticate: request => sessions.authenticate(request), redeem: (credential, audience) => sessions.redeem(credential, audience) });
      const browser = await engine.launch({ headless: true });
      try {
        const context = await browser.newContext({ ignoreHTTPSErrors: true }), page = await context.newPage();
        await page.goto(origin.url + '/login'); await page.locator('#credential').fill(issued.credential); await page.locator('#login button').click();
        await page.waitForURL(origin.url + '/'); await page.locator('#run').fill(id); await page.locator('#connect').click();
        await page.locator('#answer').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#question details').count(), 1);
        assert.equal(await page.locator('#question details pre').nth(1).textContent(), content);
        assert.equal(await page.locator('#question img').count(), 0); assert.equal(await page.evaluate(() => window.injected === true), false);
        assert.equal(await page.locator('#choice').inputValue(), '');
        await page.locator('#choice').selectOption('approve'); await page.locator('#answer button').click();
        await page.locator('#status').filter({ hasText: 'Response saved' }).waitFor();
      } finally { await browser.close(); await origin.close(); sessions.close(); }
    } });
    assert.equal((await f.run()).kind, 'terminal'); assert.equal(f.result().tag, 0);
    assert.deepEqual(f.moves, [['W', 'U'], ['U', 'W']]); assert.deepEqual(f.counts, { check: 1, publish: 1, human: 1 });
  });
}

for (const [index, status] of ['Failed', 'Unavailable', 'TimedOut', 'Cancelled', 'InvalidOutput', 'Incomplete'].entries()) test(`authored ${status} check stops before proposal or approval`, async t => {
  const f = await fixture(t, { checkStatus: status });
  assert.equal((await f.run()).kind, 'terminal');
  const outcome = f.outcome(); assert.equal(outcome.tag, 1); assert.equal(outcome.value[0], index + 1);
  assert.equal(JSON.parse(outcome.value[1]).status, status);
  assert.equal(await f.store.current(), f.base); assert.deepEqual(f.moves, []);
  assert.deepEqual(f.counts, { check: 1, publish: 0, human: 0 });
});

for (const mode of [0, 1, 2]) test(`complete mobile application mode ${mode} uses real repository, durable model/check leaves and private approval`, async t => {
  const f = await fixture(t, { mobile: true, mode });
  assert.equal((await f.run()).kind, 'terminal');
  const report = f.outcome();
  assert.equal(report[0], 1n); assert.equal(report[1], 1n); assert.equal(report[2], mode);
  assert.equal(report[3], mode === 2 ? 0 : 2);
  assert.equal(f.cleanupCalls, 1);
  assert.equal(f.modelCalls, mode === 0 ? 1 : 3);
  assert.equal(f.modelAllowance().used.attempts, f.modelCalls);
  assert.deepEqual(f.moves, mode === 2 ? [['U', 'W'], ['W', 'U'], ['U', 'W'], ['W', 'U']] : [['U', 'W'], ['W', 'U']]);
  if (mode === 0) { assert.equal(report[5], ''); assert.equal(f.counts.check, 0); }
  else { assert.equal(JSON.parse(report[5]).core.validation[0].status, 'Passed'); assert.equal(f.checkAllowance().used.attempts, 1); }
  if (mode === 2) {
    assert.equal(report[6].tag, 1); assert.equal(report[6].value.tag, 0); assert.equal(report[6].value.value.tag, 0);
    const receipt = JSON.parse(report[6].value.value.value);
    assert.equal(receipt.commit, await f.store.current()); assert.notEqual(receipt.commit, f.base);
    assert.deepEqual(f.counts, { check: 1, publish: 1, human: 1 });
  } else { assert.deepEqual(report[6], { tag: 0, value: null }); assert.equal(await f.store.current(), f.base); assert.equal(f.counts.publish, 0); assert.equal(f.counts.human, 1); }
});

for (const reviewFollowup of ['question', 'amend']) test(`retained mobile review ${reviewFollowup} preserves the original investigator and remaining budgets`, async t => {
  const f = await fixture(t, { mobile: true, reviewFollowup });
  assert.equal((await f.run()).kind, 'terminal');
  assert.equal(f.outcome()[3], 0); assert.equal(f.cleanupCalls, 1);
  assert.equal(f.modelCalls, reviewFollowup === 'amend' ? 6 : 5);
  assert.equal(f.modelAllowance().used.attempts, f.modelCalls);
  assert.equal(f.counts.check, reviewFollowup === 'amend' ? 2 : 1);
  assert.equal(f.checkAllowance().used.attempts, f.counts.check);
  assert.equal(f.counts.publish, 1); assert.equal(f.counts.human, 2);
  assert.deepEqual(f.moves, [['U', 'W'], ['W', 'U'], ['U', 'W'], ['W', 'U'], ['U', 'W'], ['W', 'U']]);
  const proposal = JSON.parse(f.outcome()[5]);
  assert.equal(proposal.core.candidate.edits[0].content, 'independently checked\n' + (reviewFollowup === 'amend' ? 'revised\n' : ''));
});
for (const option of [{ logicalSteps: 3 }, { misuse: true }]) test(`review cannot reset logical work or authorize a view-only edit: ${JSON.stringify(option)}`, async t => {
  const f = await fixture(t, { mobile: true, reviewFollowup: 'question', ...option });
  assert.equal((await f.run()).kind, 'terminal');
  assert.equal(f.outcomeKind(), 'failed'); assert.equal(f.cleanupCalls, 1);
  assert.equal(f.modelCalls, option.logicalSteps ? 3 : 4);
  assert.equal(f.modelAllowance().used.attempts, f.modelCalls);
  assert.equal(f.counts.publish, 0); assert.equal(await f.store.current(), f.base);
});

test('pending full-application review survives an origin restart without repeating model or check work', async t => {
  const f = await fixture(t, { mobile: true, restartReview: true });
  assert.equal((await f.run()).kind, 'terminal'); assert.equal(f.outcomeKind(), 'completed');
  assert.equal(f.modelCalls, 3); assert.equal(f.cleanupCalls, 1);
  assert.deepEqual(f.counts, { check: 1, publish: 1, human: 1 });
});
test('cancellation at full-application review disposes its retained investigator and prevents publication', async t => {
  const f = await fixture(t, { mobile: true, cancelReview: true });
  assert.equal((await f.run()).kind, 'terminal'); assert.equal(f.outcomeKind(), 'cancelled');
  assert.equal(f.cleanupCalls, 1); assert.equal(f.modelCalls, 3); assert.equal(f.counts.publish, 0);
  assert.equal(await f.store.current(), f.base);
});


test('successful publication remains durable when the authored return is unavailable', async t => {
  const f = await fixture(t, { mobile: true, refuseReturn: true });
  assert.equal((await f.run()).kind, 'terminal'); assert.equal(f.outcomeKind(), 'failed');
  assert.equal(f.counts.publish, 1); const commit = await f.store.current(); assert.notEqual(commit, f.base);
  assert.equal(f.status().delivery.status, 'published'); assert.equal(f.status().delivery.presentation, 'pending');
  assert.equal(f.status().delivery.receipt.commit, commit);
  f.restart(); assert.equal(f.status().delivery.receipt.commit, commit); assert.equal(f.status().delivery.presentation, 'pending');
  assert.equal((await f.run()).kind, 'terminal'); assert.equal(f.counts.publish, 1);
});
if (process.env.AGENT_MOBILITY_BROWSER_TOOLS) {
  const { chromium, firefox } = await import(pathToFileURL(join(resolve(process.env.AGENT_MOBILITY_BROWSER_TOOLS), 'node_modules/playwright-core/index.mjs')));
  for (const [name, engine] of [['chromium', chromium], ['firefox', firefox]]) for (const mode of [0, 1, 2]) test(name + ': full repository mode ' + mode + ' executes in real origin Workers across custody moves', async t => {
    const f = await fixture(t, { mobile: true, mode, engine });
    assert.equal((await f.run()).kind, 'terminal'); assert.equal(f.outcomeKind(), 'completed');
    assert.equal(f.outcome()[2], mode); assert.equal(f.cleanupCalls, 1);
    assert.equal(f.counts.publish, mode === 2 ? 1 : 0);
    assert.deepEqual(f.moves, mode === 2 ? [['U', 'W'], ['W', 'U'], ['U', 'W'], ['W', 'U']] : [['U', 'W'], ['W', 'U']]);
  });
}

if (process.env.AGENT_MOBILITY_BROWSER_TOOLS) test('full Agent source repair uses a real Worker, qualified Zig check and managed publication', async t => {
  const { chromium } = await import(pathToFileURL(join(resolve(process.env.AGENT_MOBILITY_BROWSER_TOOLS), 'node_modules/playwright-core/index.mjs')));
  const f = await fixture(t, { mobile: true, engine: chromium, qualified: true });
  assert.equal((await f.run()).kind, 'terminal'); assert.equal(f.outcomeKind(), 'completed');
  assert.equal(f.counts.check, 1); assert.equal(f.counts.publish, 1); assert.equal(f.cleanupCalls, 1);
  const proposal = JSON.parse(f.outcome()[5]); assert.equal(proposal.core.validation[0].status, 'Passed');
  assert.equal(proposal.core.validation[0].physicalExecutions, 2);
  assert.equal(proposal.core.candidate.edits[0].path, 'subject.zig');
  assert.notEqual(await f.store.current(), f.base);
});

if (process.env.AGENT_MOBILITY_BROWSER_TOOLS) test('browser catalogue starts an authenticated full task without protocol bytes', async t => {
  const { chromium } = await import(pathToFileURL(join(resolve(process.env.AGENT_MOBILITY_BROWSER_TOOLS), 'node_modules/playwright-core/index.mjs')));
  const f = await fixture(t, { mobile: true, engine: chromium, intake: true });
  assert.equal((await f.run()).kind, 'terminal'); assert.equal(f.outcomeKind(), 'completed');
  assert.equal(f.outcome()[2], 2); assert.equal(f.counts.publish, 1); assert.equal(f.cleanupCalls, 1);
});

test('authored session advances generations across origin restart with independent tasks and cumulative allowances', async t => {
  const f = await fixture(t, { mobile: true, mode: 0, sessionTasks: 2 });
  assert.equal((await f.run()).kind, 'terminal');
  assert.equal(f.outcome()[1], 2n); assert.equal(f.modelCalls, 2); assert.equal(f.cleanupCalls, 2);
  assert.equal(f.modelAllowance().used.attempts, 2, 'host allowance is cumulative across task generations');
  assert.equal(f.counts.publish, 0); assert.equal(await f.store.current(), f.base);
  assert.equal(f.moves.length, 4);
});

if (process.env.AGENT_MOBILITY_BROWSER_TOOLS) {
  const { chromium, firefox } = await import(pathToFileURL(join(resolve(process.env.AGENT_MOBILITY_BROWSER_TOOLS), 'node_modules/playwright-core/index.mjs')));
  for (const [name, engine] of [['chromium', chromium], ['firefox', firefox]]) test(name + ': browser repeated tasks use authored generations and export the completed report', async t => {
    const f = await fixture(t, { mobile: true, mode: 0, sessionTasks: 2, intake: true, engine });
    assert.equal((await f.run()).kind, 'terminal');
    assert.equal(f.outcome()[1], 2n); assert.equal(f.cleanupCalls, 2); assert.equal(f.modelAllowance().used.attempts, 2);
    assert.equal(f.counts.publish, 0);
  });
}

test('session propose then publish gets a fresh check and exact approval at generation two', async t => {
  const f = await fixture(t, { mobile: true, mode: 1, nextMode: 2, sessionTasks: 2 });
  assert.equal((await f.run()).kind, 'terminal');
  const report = f.outcome(); assert.equal(report[1], 2n); assert.equal(report[2], 2);
  assert.equal(f.cleanupCalls, 2); assert.equal(f.counts.check, 2); assert.equal(f.counts.publish, 1);
  assert.equal(f.modelAllowance().used.attempts, 6); assert.equal(f.checkAllowance().used.attempts, 2);
  assert.notEqual(await f.store.current(), f.base);
});
