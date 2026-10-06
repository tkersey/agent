import test from 'node:test';
import assert from 'node:assert/strict';
import { repositoryFixture } from './repository_application_fixture.mjs';
import { comparisonProfile } from './repository_comparison.mjs';
import { hash } from '../../runtime/mobility/protocol.mjs';

test('stationary authorized proxies and mobility run the same session image, inputs and checked change', async t => {
  const observations = [];
  for (const topology of ['mobile', 'stationary']) {
    const comparison = comparisonProfile(t, { topology });
    const f = await repositoryFixture(t, { mobile: true, mode: 1, comparison });
    assert.equal((await f.run()).kind, 'terminal');
    const report = f.outcome(), metrics = comparison.result(); comparison.assertStationary(f.id);
    assert.equal(report[2], 1); assert.equal(f.counts.check, 1); assert.equal(f.modelCalls, 3); assert.equal(f.cleanupCalls, 1);
    assert.equal(f.checkAllowance().used.attempts, 1); assert.equal(f.modelAllowance().used.attempts, 3);
    assert.equal(f.counts.publish, 0); assert.equal(await f.store.current(), f.base);
    assert.equal(f.moves.length, topology === 'mobile' ? 2 : 0);
    assert.equal(metrics.endingWorkingLiveBytes, 0);
    const proposal = JSON.parse(report[5]); assert.equal(proposal.core.validation[0].status, 'Passed');
    observations.push({ image: hash(f.image), task: hash(f.initialArgs), base: f.base, diff: proposal.core.diff, leafTrace: metrics.leafTrace,
      allowanceLimits: { model: f.modelAllowance().limit, check: f.checkAllowance().limit } });
    assert(metrics.traffic.requests > 0);
    if (topology === 'stationary') assert.equal(metrics.proxyCalls['agent.model.invoke.v4'].calls, 3);
    const savedMetrics = JSON.stringify(metrics);
    await f.registerFresh(); assert.equal((await f.run()).kind, 'terminal');
    const warm = comparison.result(); assert.equal(warm.traffic.image, 0, 'warm admission uses the actual authenticated image cache');
    assert.equal(JSON.stringify(metrics), savedMetrics, 'a later sample cannot mutate the saved cold measurement');
    assert.equal(f.modelAllowance().used.attempts, 3);
  }
  assert.deepEqual(observations[0], observations[1]);
});

test('qualification proxy rejects payload substitution before workspace I/O', async t => {
  const comparison = comparisonProfile(t, { topology: 'stationary', corruptFirstProxyRequest: true });
  const f = await repositoryFixture(t, { mobile: true, mode: 1, comparison });
  await assert.rejects(f.run(), /ProxyRejected/);
  assert.deepEqual(comparison.result().leafMethods, {});
  assert.equal(f.modelCalls, 0); assert.equal(f.counts.check, 0); assert.equal(f.counts.publish, 0);
  assert.equal(await f.store.current(), f.base); comparison.assertStationary(f.id);
});
