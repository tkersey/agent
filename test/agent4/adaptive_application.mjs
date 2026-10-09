// Same authored image under the Node/WASM environment, with durable capture loss.
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {execFileSync, spawn} from 'node:child_process';
import {once} from 'node:events';
import {packageArtifacts} from '../../tools/agent4/package.mjs';
import {codecs, hash} from '../../runtime/adaptive/codec.mjs';

export async function verifyAdaptiveApplication({image, application, worldRuntime}) {
  const directory = mkdtempSync(join(tmpdir(), 'adaptive-js-'));
  const inputs = join(directory, 'inputs'), extracted = join(directory, 'extracted');
  mkdirSync(join(inputs, 'adaptive-agent'), {recursive: true}); mkdirSync(extracted);
  const applicationBytes = readFileSync(application), codec = codecs(JSON.parse(applicationBytes));
  const files = [];
  const asset = (path, role, bytes) => { writeFileSync(join(inputs, path), bytes); files.push({path, role, sha256: hash(bytes)}); };
  asset('adaptive-agent/program.bpi3', 'image', readFileSync(image));
  asset('adaptive-agent/application.json', 'application', applicationBytes);
  asset('adaptive-agent/initial.args', 'initial-args', codec.encode('Input', {task: 'Explain the admitted snapshot using source evidence.'}));
  asset('contract.txt', 'contract', Buffer.from('One authored adaptive computation with explicit model and skill controls.\n'));
  asset('offline.txt', 'synthetic-fixture', Buffer.from('The approved offline Responses corpus is embedded in application resources.\n'));
  writeFileSync(join(inputs, 'inventory.json'), JSON.stringify({format: 'agent4-use-inventory/v1', examples: [{name: 'adaptive-agent',
    image: 'adaptive-agent/program.bpi3', initialArgs: 'adaptive-agent/initial.args'}], files}));
  const version = readFileSync('build.zig.zon', 'utf8').match(/\.version\s*=\s*"([^"]+)"/)[1];
  const output = process.env.AGENT4_BUILD_PREFIX ? join(process.env.AGENT4_BUILD_PREFIX, 'adaptive-use-archive') : join(directory, 'archive');
  const receipt = packageArtifacts(['--images-dir', inputs, '--output-dir', output, '--version', version, '--world-runtime', worldRuntime]);
  execFileSync('tar', ['-xzf', join(output, receipt.archive.name), '-C', extracted]);
  const root = join(extracted, receipt.archive.name.slice(0, -7));
  for (const file of receipt.files) assert(!/\.(zig|wasm)$/.test(file.path), 'the use package contains no compiler or kernel source');
  const {AdaptiveRunner} = await import(pathToFileURL(join(root, 'runtime/adaptive/runner.mjs')).href);
  const options = {image: join(root, 'examples/adaptive-agent/program.bpi3'), application: join(root, 'examples/adaptive-agent/application.json'),
    worldRuntime, stateDir: join(directory, 'state'), offline: true, create: true};
  let runner, child, childExit, captures = 0;
  try {
    child = spawn(process.execPath, [fileURLToPath(new URL('./adaptive_capture_child.mjs', import.meta.url)), root, JSON.stringify(options)],
      {cwd: root, env: {PATH: '/nonexistent'}, stdio: ['ignore', 'ignore', 'pipe', 'ipc']});
    childExit = once(child, 'exit'); let stderr = '';
    child.stderr.on('data', bytes => { stderr += bytes; assert(stderr.length < 1024 * 1024); });
    const stopped = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`capture child timeout: ${stderr}`)), 30000);
      child.once('message', value => { clearTimeout(timer); resolve(value.captured); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error(`capture child exited early: ${stderr}`)); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
    });
    assert.equal(stopped.model_attempts, 8); assert.equal(stopped.occurrence, 'captured'); assert.equal(stopped.consumed_messages, 3);
    child.kill('SIGKILL'); assert.deepEqual(await childExit, [null, 'SIGKILL']); child = null; captures = 8;
    runner = await AdaptiveRunner.open({...options, create: false}, {onBoundary: async event => {
      if (event.operation === 'agent.model.invoke.v6' && event.phase === 'capture') captures++;
    }});
    assert.equal(runner.status().model_attempts, 8, 'reopening a capture does not charge another attempt');
    const parked = await runner.drive();
    assert.equal(parked.occurrence, 'waiting'); assert.equal(parked.model_attempts, 12);
    runner.message('followup-four', {message: 'Retain this message if the authored input allowance is full.'});
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
    assert.equal(completed.kind, 'completed'); assert.equal(completed.model_attempts, 13); assert.equal(captures, 13);
    assert.equal(completed.output.disposition, 'report'); assert.equal(completed.output.model_calls, 13); assert.equal(completed.output.work_calls, 4);
    assert.equal(completed.output.control.selection.profile_id, 'analysis'); assert.equal(completed.output.control.selection.effective_effort, 'medium');
    assert.equal(completed.output.control.selection.control_revision, '8'); assert.equal(completed.output.control.eviction_generation, '2');
    assert.equal(completed.output.control.skills.length, 0); assert.equal(completed.output.receipts.length, 8); assert.equal(completed.consumed_messages, 3);
    assert.equal(completed.not_consumed_messages, 1); assert.equal(completed.queued_messages, 0);
    assert.equal(completed.output.evidence[0].path, 'src/main.zig');
    const metrics = runner.metrics();
    const observations = runner.observations();
    assert.equal(observations.length, 13);
    assert(!observations.at(-1).offered_names.includes('ask'), 'full input allowance removes the question offer before I/O');
    assert(observations.every(row => row.usage_presence === 'absent' && row.usage === null && row.cache_diagnostics.presence === 'absent'));
    assert(metrics.bytes < 256 * 1024 * 1024 && metrics.database_bytes <= 256 * 1024 * 1024);
    await runner.close(); runner = null;
    runner = await AdaptiveRunner.open({...options, create: false});
    assert.deepEqual(runner.status().output, completed.output);
    console.log(JSON.stringify({adaptive_js: 'extracted same-image controls, inbox and captured-reply recovery', archive_sha256: receipt.archive.sha256, model_attempts: captures,
      controls: completed.output.receipts.length, consumed_messages: completed.consumed_messages, metrics, live_provider: false},
    (_key, value) => typeof value === 'bigint' ? String(value) : value));
  } finally {
    if (child) { child.kill('SIGKILL'); await childExit; }
    if (runner) await runner.close(); rmSync(directory, {recursive: true, force: true});
  }
}
