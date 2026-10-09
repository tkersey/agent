// Exercise the authored adaptive loop through the copied native product.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {deployment} from './native_deployment.mjs';

const app = deployment(process.argv[2], 'adaptive-agent');
let passed = false;
try {
  const invoke = (...args) => {
    const result = spawnSync(app.command, args, {cwd: app.data, env: {PATH: '/nonexistent'}, encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024});
    assert.equal(result.status, 0, `${args[0]}: ${result.error ?? result.stderr}\n${result.stdout}`);
    return JSON.parse(result.stdout);
  };
  const result = invoke('demo', '--offline', '--state-dir', join(app.data, 'adaptive state'));
  assert.equal(result.mode, 'offline-demo');
  assert.equal(result.output.disposition, 'report');
  assert.equal(result.output.model_calls, 13);
  assert.equal(result.output.work_calls, 4);
  assert.equal(result.output.control.selection.profile_id, 'analysis');
  assert.equal(result.output.control.selection.effective_effort, 'medium');
  assert.equal(result.output.control.selection.control_revision, '8');
  assert.equal(result.output.control.skills.length, 0);
  assert.equal(result.output.receipts.length, 8);
  assert.equal(result.output.evidence.length, 1);
  assert.equal(result.output.evidence[0].path, 'src/main.zig');
  assert.deepEqual(result.output.receipts.map(item => item.next_revision), ['1', '2', '3', '4', '5', '6', '7', '8']);
  assert.equal(result.output.receipts[3].context_epoch, result.output.receipts[2].context_epoch, 'resident deactivation retains the epoch');
  assert.equal(BigInt(result.output.receipts[4].context_epoch), BigInt(result.output.receipts[3].context_epoch) + 1n, 'physical unload creates a new projection');
  assert.equal(BigInt(result.output.control.eviction_generation), 2n);
  passed = true;
  console.log(JSON.stringify({adaptive: 'authored control scenario', model_calls: result.output.model_calls, controls: result.output.receipts.length, live_provider: false}));
} finally {
  app.close(passed);
}
