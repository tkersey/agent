import test from 'node:test';
import assert from 'node:assert/strict';
import { pumpDeployment } from '../../runtime/mobility/deployment.mjs';

test('a repeatedly failing run does not starve execution, transfer retry or cancellation', async () => {
  const runs = [{ run_id: 'bad', status: 'ACTIVE' }, { run_id: 'good', status: 'ACTIVE' },
    { run_id: 'offered', status: 'OFFERED', transfer_id: 'transfer' }, { run_id: 'departed', status: 'DEPARTED', cancel_requested: 'stop', cancel_forwarded: false }];
  const calls = [], deployment = { config: { execution: 'node' }, journal: { recover: () => runs.map(run => ({ run })), run: id => runs.find(run => run.run_id === id) },
    custodian: { async run(id) { calls.push(id); if (id === 'bad') throw Object.assign(new Error('denied'), { code: 'LeafBindingDenied' }); return { kind: 'terminal' }; },
      async retryTransfer(id) { calls.push(id); return { kind: 'unknown' }; }, async cancelRun(id) { calls.push(id); return { kind: 'cancel_forwarded' }; } } };
  for (let i = 0; i < 3; i++) {
    const results = await pumpDeployment(deployment);
    assert.deepEqual(results.map(result => result.kind), ['failed', 'terminal', 'unknown', 'cancel_forwarded']);
    assert.deepEqual(results[0], { kind: 'failed', run_id: 'bad', reason: 'LeafBindingDenied' });
  }
  assert.deepEqual(calls, Array(3).fill(['bad', 'good', 'transfer', 'departed']).flat());
});
