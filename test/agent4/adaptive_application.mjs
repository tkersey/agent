// Same authored image under the Node/WASM environment, with durable capture loss.
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {execFileSync, spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:https';
import {X509Certificate} from 'node:crypto';
import {packageArtifacts} from '../../tools/agent4/package.mjs';
import {codecs, hash} from '../../runtime/adaptive/codec.mjs';
import {certificates} from './mobility_tls_fixture.mjs';

async function within(promise, milliseconds, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

async function verifyInterrupts({directory, root, options, template, AdaptiveRunner}) {
  const tls = await certificates(directory), trust = join(directory, 'interrupt-root.der');
  writeFileSync(trust, new X509Certificate(tls.ca).raw);
  let announceHeld, requests = 0, runner;
  const sockets = new Set();
  const server = createServer(tls.A, async (request, _response) => {
    for await (const _bytes of request) {} // Deliberately hold the response.
    requests++; announceHeld?.();
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const config = structuredClone(template), configPath = join(directory, 'interrupt.json');
  config.endpoint = `https://127.0.0.1:${server.address().port}/v1/responses`;
  for (const profile of config.profiles) { profile.model = 'fixture-interrupt-model'; profile.timeout_ms = 10000; }
  writeFileSync(configPath, JSON.stringify(config));
  const configured = stateDir => ({...options, stateDir, offline: false, config: configPath, testTrustRoot: trust, authorizeInference: true});
  try {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const launch = configured(join(directory, signal));
      runner = await AdaptiveRunner.open(launch);
      await runner.start({task: 'Stop the held fixture request on operator interruption.'});
      runner.message('cli-interrupt', {message: 'This is a valid caller-owned operation identity.'});
      assert.throws(() => runner.cancel('cli-interrupt', 'Conflicting caller request.'), /operation ID conflict/);
      assert.equal(runner.status().cancellation_requested, false);
      await runner.close(); runner = null;
      const held = new Promise(resolve => { announceHeld = resolve; });
      const child = spawn(process.execPath, [join(root, 'runtime/adaptive/cli.mjs'), 'resume', '--world-runtime', options.worldRuntime,
        '--state-dir', launch.stateDir, '--config', configPath, '--test-provider', '--trust-root-file', trust, '--authorize-inference'],
      {cwd: root, env: {PATH: '/nonexistent'}, stdio: ['ignore', 'pipe', 'pipe']});
      const exit = once(child, 'exit'); let stdout = '', stderr = '', reaped = false;
      child.stdout.on('data', bytes => { stdout = (stdout + bytes).slice(-4 * 1024 * 1024); });
      child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-1024 * 1024); });
      try {
        await within(Promise.race([held, exit.then(() => { throw new Error(`interrupt child exited before request: ${stderr}`); })]), 15000, 'interrupt request not received');
        const before = requests;
        child.kill(signal);
        assert.deepEqual(await within(exit, 3000, `${signal} did not abort the 10-second request`), [2, null], stderr);
        reaped = true;
        const stopped = JSON.parse(stdout);
        assert.equal(stopped.occurrence, 'unknown'); assert.equal(stopped.model_attempts, 1); assert.equal(stopped.cancellation_requested, true);
        runner = await AdaptiveRunner.open({...launch, create: false});
        const resumed = await runner.drive();
        assert.equal(resumed.occurrence, 'unknown'); assert.equal(resumed.model_attempts, 1); assert.equal(requests, before);
        await runner.close(); runner = null;
      } finally { if (!reaped) { child.kill('SIGKILL'); await exit.catch(() => {}); } }
    }
    const before = requests;
    runner = await AdaptiveRunner.open(configured(join(directory, 'interrupt-before-acquire')), {onBoundary: async event => {
      if (event.operation === 'agent.model.invoke.v6' && event.phase === 'dispatch') runner.interrupt('Stop before acquisition.');
    }});
    await runner.start({task: 'Do not send an interrupted dispatch.'});
    const unsent = await runner.drive();
    assert.equal(unsent.occurrence, 'not_sent'); assert.equal(unsent.model_attempts, 1); assert.equal(requests, before);
    assert.equal((await runner.drive()).kind, 'cancelled');
    await runner.close(); runner = null;

    const held = new Promise(resolve => { announceHeld = resolve; });
    runner = await AdaptiveRunner.open(configured(join(directory, 'interrupt-storage-failure')), {fault: point => {
      if (point === 'interrupt.begin') throw new Error('InjectedInterruptPersistenceFailure');
    }});
    await runner.start({task: 'Abort even if recording the signal fails.'});
    const driving = runner.drive();
    await within(Promise.race([held, driving.then(() => { throw new Error('storage-failure task stopped before request'); })]), 15000, 'storage-failure request not received');
    assert.throws(() => runner.interrupt('Stop despite storage failure.'), /InjectedInterruptPersistenceFailure/);
    const interrupted = await within(driving, 3000, 'storage failure prevented transport abort');
    assert.equal(interrupted.occurrence, 'unknown'); assert.equal(interrupted.cancellation_requested, false);
    assert.equal(interrupted.model_attempts, 1);
    await runner.close(); runner = null;
    assert.equal(requests, before + 1);
    return {signals: ['SIGINT', 'SIGTERM'], held_requests: requests, pre_acquisition: true, persistence_failure: true};
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    if (runner) await runner.close();
  }
}

async function killAt(root, options, phase) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./adaptive_capture_child.mjs', import.meta.url)), root, JSON.stringify(options), phase],
    {cwd: root, env: {PATH: '/nonexistent'}, stdio: ['ignore', 'ignore', 'pipe', 'ipc']});
  const exit = once(child, 'exit'); let stderr = '', reaped = false;
  child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-1024 * 1024); });
  try {
    const status = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`capture child timeout: ${stderr}`)), 30000);
      child.once('message', value => { clearTimeout(timer); resolve(value.status); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error(`capture child exited early: ${stderr}`)); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
    });
    child.kill('SIGKILL'); assert.deepEqual(await exit, [null, 'SIGKILL']); reaped = true; return status;
  } finally { if (!reaped) { child.kill('SIGKILL'); await exit; } }
}

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
  let runner, captures = 0;
  try {
    const stopped = await killAt(root, options, 'capture');
    assert.equal(stopped.model_attempts, 8); assert.equal(stopped.occurrence, 'captured'); assert.equal(stopped.consumed_messages, 3);
    captures = 8;
    runner = await AdaptiveRunner.open({...options, create: false}, {onBoundary: async event => {
      if (event.operation === 'agent.model.invoke.v6' && event.phase === 'capture') captures++;
    }});
    assert.equal(runner.status().model_attempts, 8, 'reopening a capture does not charge another attempt');
    const parked = await runner.drive();
    assert.equal(parked.occurrence, 'waiting'); assert.equal(parked.model_attempts, 13);
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
    assert.equal(completed.kind, 'completed'); assert.equal(completed.model_attempts, 14); assert.equal(captures, 14);
    assert.equal(completed.output.disposition, 'report'); assert.equal(completed.output.model_calls, 14); assert.equal(completed.output.work_calls, 5);
    assert.equal(completed.output.control.selection.profile_id, 'analysis'); assert.equal(completed.output.control.selection.effective_effort, 'medium');
    assert.equal(completed.output.control.selection.control_revision, '8'); assert.equal(completed.output.control.eviction_generation, '2');
    assert.equal(completed.output.control.skills.length, 0); assert.equal(completed.output.receipts.length, 8); assert.equal(completed.consumed_messages, 3);
    assert.equal(completed.not_consumed_messages, 1); assert.equal(completed.queued_messages, 0);
    assert.equal(completed.output.evidence[0].path, 'src/main.zig');
    const metrics = runner.metrics();
    const observations = runner.observations();
    assert.equal(observations.length, 14);
    assert(!observations.at(-1).offered_names.includes('ask'), 'full input allowance removes the question offer before I/O');
    assert(observations.every(row => row.usage_presence === 'absent' && row.usage === null && row.cache_diagnostics.presence === 'absent'));
    assert(metrics.bytes < 256 * 1024 * 1024 && metrics.database_bytes <= 256 * 1024 * 1024);
    await runner.close(); runner = null;
    runner = await AdaptiveRunner.open({...options, create: false});
    assert.deepEqual(runner.status().output, completed.output);
    await runner.close(); runner = null;
    const cli = join(root, 'runtime/adaptive/cli.mjs');
    const invoke = (...args) => execFileSync(process.execPath, [cli, ...args], {cwd: root, env: {PATH: '/nonexistent'}, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024});
    assert(invoke('--help').includes('observations'));
    const shared = ['--world-runtime', worldRuntime, '--state-dir', options.stateDir, '--offline'];
    assert.deepEqual(JSON.parse(invoke('status', ...shared)).output, completed.output);
    assert.equal(JSON.parse(invoke('observations', ...shared)).observations.length, 14);
    const snapshot = join(directory, 'validation snapshot'), configPath = join(directory, 'validation.json');
    mkdirSync(snapshot); writeFileSync(join(snapshot, 'source.txt'), 'Read-only fixture data.\n');
    const template = JSON.parse(readFileSync(join(root, 'examples/adaptive-agent/adaptive.example.json'), 'utf8'));
    template.snapshot_root = snapshot;
    for (const skill of template.skills) skill.markdown = join(root, 'examples/adaptive-agent', skill.markdown);
    writeFileSync(configPath, JSON.stringify(template));
    const validated = JSON.parse(invoke('validate-config', '--application', options.application, '--image', options.image, '--config', configPath));
    assert.equal(validated.valid, true); assert.equal(validated.live_provider, false);
    const unknownOptions = {...options, stateDir: join(directory, 'unknown delivery')};
    const dispatched = await killAt(root, unknownOptions, 'dispatch');
    assert.equal(dispatched.occurrence, 'dispatching'); assert.equal(dispatched.model_attempts, 1);
    let newBoundaries = 0;
    runner = await AdaptiveRunner.open({...unknownOptions, create: false}, {onBoundary: async () => { newBoundaries++; }});
    assert.equal(runner.status().occurrence, 'unknown');
    const unchanged = await runner.drive();
    assert.equal(unchanged.occurrence, 'unknown'); assert.equal(unchanged.model_attempts, 1); assert.equal(newBoundaries, 0);
    await runner.close(); runner = null;
    const interruptions = await verifyInterrupts({directory, root, options, template, AdaptiveRunner});
    console.log(JSON.stringify({adaptive_js: 'extracted same-image controls, inbox and captured-reply recovery', archive_sha256: receipt.archive.sha256, model_attempts: captures,
      controls: completed.output.receipts.length, consumed_messages: completed.consumed_messages, interruptions, metrics, live_provider: false},
    (_key, value) => typeof value === 'bigint' ? String(value) : value));
  } finally {
    if (runner) await runner.close(); rmSync(directory, {recursive: true, force: true});
  }
}
