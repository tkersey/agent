// Same authored image under the Node/WASM environment, with durable capture loss.
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AdaptiveRunner} from '../../runtime/adaptive/runner.mjs';

export async function verifyAdaptiveApplication({image, application, worldRuntime}) {
  const directory = mkdtempSync(join(tmpdir(), 'adaptive-js-'));
  const options = {image, application, worldRuntime, stateDir: directory, offline: true, create: true};
  let runner, captures = 0, injections = 0;
  try {
    runner = await AdaptiveRunner.open(options, {onBoundary: async event => {
      if (event.operation !== 'agent.model.invoke.v6') return;
      if (event.phase === 'dispatch' && captures === 0) {
        runner.message('followup-one', {message: 'Distinguish lexical observations from unrun checks.'}); injections++;
      }
      if (event.phase === 'capture' && ++captures === 8) throw Object.assign(new Error('InjectedCaptureLoss'), {code: 'InjectedCaptureLoss'});
    }});
    await runner.start({task: 'Explain the fixture entry point using source evidence and exercise the approved adaptive controls.'});
    await assert.rejects(runner.drive(), {code: 'InjectedCaptureLoss'});
    assert.equal(runner.status().model_attempts, 8);
    assert.equal(runner.status().occurrence, 'captured');
    assert.equal(runner.status().consumed_messages, 1);
    await runner.close(); runner = null;
    runner = await AdaptiveRunner.open({...options, create: false}, {onBoundary: async event => {
      if (event.operation === 'agent.model.invoke.v6' && event.phase === 'capture') captures++;
    }});
    assert.equal(runner.status().model_attempts, 8, 'reopening a capture does not charge another attempt');
    const parked = await runner.drive();
    assert.equal(parked.occurrence, 'waiting'); assert.equal(parked.model_attempts, 12);
    runner.message('followup-two', {message: 'Keep the final report grounded in the acquired source.'});
    assert.equal(runner.status().occurrence, 'waiting', 'a queued message cannot answer a question');
    const answer = {message: 'Focus on observable behavior.'};
    assert.throws(() => runner.respond('bad-answer', parked.question.id, '0'.repeat(64), answer), /stale question/);
    const accepted = runner.respond('answer-one', parked.question.id, parked.question.request_digest, answer);
    assert.deepEqual(runner.respond('answer-one', parked.question.id, parked.question.request_digest, answer), accepted);
    await runner.close(); runner = null;
    runner = await AdaptiveRunner.open({...options, create: false}, {onBoundary: async event => {
      if (event.operation === 'agent.model.invoke.v6' && event.phase === 'capture') captures++;
    }});
    const completed = await runner.drive();
    assert.equal(completed.kind, 'completed'); assert.equal(completed.model_attempts, 13); assert.equal(captures, 13); assert.equal(injections, 1);
    assert.equal(completed.output.disposition, 'report'); assert.equal(completed.output.model_calls, 13); assert.equal(completed.output.work_calls, 4);
    assert.equal(completed.output.control.selection.profile_id, 'analysis'); assert.equal(completed.output.control.selection.effective_effort, 'medium');
    assert.equal(completed.output.control.selection.control_revision, '8'); assert.equal(completed.output.control.eviction_generation, '2');
    assert.equal(completed.output.control.skills.length, 0); assert.equal(completed.output.receipts.length, 8); assert.equal(completed.consumed_messages, 2);
    assert.equal(completed.output.evidence[0].path, 'src/main.zig');
    const metrics = runner.metrics();
    assert(metrics.bytes < 256 * 1024 * 1024 && metrics.database_bytes <= 256 * 1024 * 1024);
    await runner.close(); runner = null;
    runner = await AdaptiveRunner.open({...options, create: false});
    assert.deepEqual(runner.status().output, completed.output);
    console.log(JSON.stringify({adaptive_js: 'same-image controls, inbox and captured-reply recovery', model_attempts: captures,
      controls: completed.output.receipts.length, consumed_messages: completed.consumed_messages, metrics, live_provider: false},
    (_key, value) => typeof value === 'bigint' ? String(value) : value));
  } finally { if (runner) await runner.close(); rmSync(directory, {recursive: true, force: true}); }
}
