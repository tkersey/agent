// Copied reference application; no source tree, build tool or interpreter on PATH.
import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import { createServer } from 'node:https';
import { mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import { once } from 'node:events';
import { AgentClient } from '../../examples/native-minimal/stdio-client.mts';
import { certificates } from './mobility_tls_fixture.mjs';
import { compareContinuation, missingReplayObject } from './native_archive.mjs';
import { deployment } from './native_deployment.mjs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function until(read, predicate, label) {
  for (let i = 0; i < 400; i++) {
    const value = await read();
    if (predicate(value)) return value;
    if (value.status === 'blocked' || value.status === 'failed' || value.status === 'unknown')
      throw new Error(`${label}: ${JSON.stringify(value)}`);
    await delay(10);
  }
  throw new Error(`${label}: timeout`);
}

async function foreignApplication(repository, directory, source) {
  const minimal = deployment(source, 'agent-native-example');
  let passed = false, client;
  try {
    const state = join(minimal.data, 'foreign state');
    const run = spawnSync(minimal.command, ['run', '--offline', '--state-dir', state, '--input-json', '{"value":20}', '--operation-id', 'foreign-submit'], {cwd: minimal.data, env: {PATH: '/nonexistent'}, encoding: 'utf8', timeout: 5000});
    assert.equal(run.status, 0, run.error ?? run.stderr);
    const task = JSON.parse(run.stdout);
    assert.equal(task.status, 'waiting_input');
    // Move the closed directory on the same filesystem, preserving the namespace's
    // device/inode identity. Copying it would correctly fail namespace admission
    // before reaching the application contract tested here. Neither application
    // can read the other's executable, source or controller files.
    const reopened = join(directory, 'foreign state');
    await rename(state, reopened);
    client = new AgentClient(repository, ['--offline', '--state-dir', reopened], {cwd: directory, env: {PATH: '/nonexistent'}});
    await client.initialize();
    const before = await client.call('task.status', {task_id: task.task_id});
    await assert.rejects(client.call('task.message', {client_operation_id: 'foreign-message', task_id: task.task_id, message: {schema_id: 'repository-agent.message.v1', value: {message: 'Follow up on the other application.'}}}), error => error.data?.kind === 'StateConflict');
    assert.deepEqual(await client.call('task.status', {task_id: task.task_id}), before);
    assert.equal((await client.call('task.result', {task_id: task.task_id})).ready, false);
    assert.deepEqual(await client.close(), {code: 0, signal: null});
    client = null;
    passed = true;
  } finally {
    if (client) { client.child.kill('SIGKILL'); await client.closed; }
    minimal.close(passed);
  }
}

async function repositoryHttps(binary, directory, controller, invoke) {
  const root = join(directory, 'controlled repository');
  const state = join(directory, 'https state');
  await mkdir(join(root, 'src'), { recursive: true });
  const source = 'pub fn answer() u32 { return 42; }\n';
  const changed = 'pub fn answer() u32 { return 99; }\n';
  await writeFile(join(root, 'src/main.zig'), source);
  const tls = await certificates(controller);
  const trust = join(directory, 'provider-root.der');
  const credential = join(directory, 'provider-token');
  await writeFile(trust, new X509Certificate(tls.ca).raw);
  await writeFile(credential, 'qualification-only\n', { mode: 0o600 });
  const requests = [], notifications = [], sockets = new Set(), clients = new Set();
  let providerFailure, releaseHeld, firstProviderAt;
  const held = new Promise(resolve => { releaseHeld = resolve; });
  let announceHeld;
  const heldRequest = new Promise(resolve => { announceHeld = resolve; });
  let announceCancelHeld, releaseCancelHeld;
  const cancelHeldRequest = new Promise(resolve => { announceCancelHeld = resolve; });
  const cancelHeld = new Promise(resolve => { releaseCancelHeld = resolve; });
  const server = createServer(tls.A, async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const index = requests.length;
      if (index === 0) firstProviderAt = performance.now();
      requests.push(body);
      assert.equal(request.url, '/v1/responses');
      assert.equal(request.headers.authorization, 'Bearer qualification-only');
      assert.equal(body.model, 'fixture-model');
      assert.deepEqual(body.reasoning, { effort: 'medium' });
      for (const key of ['store', 'stream', 'background', 'parallel_tool_calls']) assert.equal(body[key], false);
      assert.equal(body.truncation, 'disabled');
      assert.equal('previous_response_id' in body, false);
      assert.equal('conversation' in body, false);
      if (index === 4) {
        assert.equal(body.input.filter(item => item.type === 'function_call_output').length, 0);
        announceCancelHeld();
        await cancelHeld;
        response.destroy();
        return;
      }
      const names = ['list', 'read', 'ask', 'report'];
      assert(index < names.length, 'unexpected provider retry or extra model turn');
      assert(body.tools.some(tool => tool.name === names[index]), 'fixture action must be currently offered');
      const results = body.input.filter(item => item.type === 'function_call_output');
      assert.equal(results.length, index);
      for (let i = 0; i < index; i++) assert.equal(results[i].call_id, `fixture-${i}`);
      if (index > 0) {
        assert.deepEqual(body.input.find(item => item.type === 'reasoning'), { type: 'reasoning', id: 'reasoning-0', summary: [], encrypted_content: 'opaque+/=雪' });
        assert.equal(body.input.find(item => item.type === 'message' && item.phase)?.phase, 'commentary');
        assert.equal(JSON.parse(results[0].output).entries[0].path, 'src/main.zig');
      }
      if (index >= 2) {
        const read = JSON.parse(results[1].output);
        assert.equal(read.tag, 'found');
        assert.equal(read.value.content, source);
        assert.equal(read.value.sha256, hash(source));
        assert.equal(read.value.start, '0');
        assert.equal(read.value.end, String(Buffer.byteLength(source)));
      }
      if (index === 2) {
        announceHeld();
        await held;
        assert(!body.input.some(item => item.content === 'Include the exact return value. 雪'));
      }
      if (index === 3) {
        assert.equal(results[2].output, 'Explain the exported function.');
        const answer = body.input.findIndex(item => item.type === 'function_call_output' && item.call_id === 'fixture-2');
        const followup = body.input.findIndex(item => item.role === 'user' && item.content === 'Include the exact return value. 雪');
        assert(followup > answer, 'settled answer must precede queued follow-up');
      }
      const args = [
        { prefix: 'src/', after: '' },
        { path: 'src/main.zig', start: 0, maximum: 4096 },
        { question: 'Which public behavior should the report explain?' },
        { summary: 'The exported answer function returns 42.', evidence_index: 0 },
      ][index];
      const output = [];
      if (index === 0) output.push(
        { type: 'reasoning', id: 'reasoning-0', summary: [], encrypted_content: 'opaque+/=雪' },
        { type: 'message', id: 'progress-0', status: 'completed', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'I will inspect the snapshot.', annotations: [] }] },
      );
      output.push({ type: 'function_call', id: `function-${index}`, status: 'completed', call_id: `fixture-${index}`, name: names[index], arguments: JSON.stringify(args) });
      response.setHeader('content-type', 'application/json');
      response.setHeader('x-request-id', `request-${index}`);
      response.end(JSON.stringify({ status: 'completed', error: null, output, usage: { input_tokens: 20 + index, output_tokens: 10, input_tokens_details: { cached_tokens: index ? 5 : 0 } } }));
    } catch (error) {
      providerFailure = error;
      response.statusCode = 500;
      response.end('{}');
      announceHeld();
    }
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('tlsClientError', () => {});
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const config = {
      workspace: 'controlled-fixture', snapshot_root: root,
      responses: { endpoint: `https://127.0.0.1:${server.address().port}/v1/responses`, audience: 'controlled-fixture', model: 'fixture-model', effort: 'medium', max_output_tokens: 4096, request_bytes: 262144, response_bytes: 524288, timeout_ms: 10000 },
    };
    const configPath = join(directory, 'approved-profile.json');
    await writeFile(configPath, JSON.stringify(config));
    const launch = extra => {
      const client = new AgentClient(binary, ['--state-dir', state, '--authorize-inference', '--credential-file', credential, '--trust-root', trust, ...extra], { cwd: directory, env: { PATH: '/nonexistent' }, onNotification: frame => notifications.push(frame) });
      clients.add(client);
      return client;
    };
    const investigationStarted = performance.now();
    let client = launch(['--config', configPath]);
    await client.initialize();
    const description = await client.call('describe');
    assert.equal(description.execution_mode, 'live');
    assert.equal(description.profile.id, 'fixed');
    assert.match(description.profile.resource_identity, /^[a-f0-9]{64}$/);
    const accepted = await client.call('task.submit', { client_operation_id: 'repository-task', application_id: 'repository-agent', profile_id: description.profile.id, input: { schema_id: 'repository-agent.input.v1', value: { task: 'Explain the public source behavior.' } } });
    assert.equal(accepted.profile_digest, description.profile.sha256);
    const id = accepted.task_id;
    const subscribed = await client.call('task.subscribe', { task_id: id, after_seq: '0' });
    let heldTimeout;
    try {
      await Promise.race([heldRequest, new Promise((_, reject) => {
        heldTimeout = setTimeout(() => reject(new Error('held provider request timeout')), 15000);
      })]);
    } finally { clearTimeout(heldTimeout); }
    if (providerFailure) throw providerFailure;
    const start = performance.now();
    const controlSamples = [];
    let pending;
    for (let sample = 0; sample < 3; sample++) {
      const pingStarted = performance.now();
      await client.call('ping', {}, 2000);
      const pingMilliseconds = performance.now() - pingStarted;
      const statusStarted = performance.now();
      pending = await client.call('task.status', { task_id: id }, 2000);
      controlSamples.push({ping_ms: pingMilliseconds, status_ms: performance.now() - statusStarted});
    }
    const queued = await client.call('task.message', { client_operation_id: 'followup', task_id: id, message: { schema_id: 'repository-agent.message.v1', value: { message: 'Include the exact return value. 雪' } } }, 2000);
    const latency = performance.now() - start;
    assert(latency < 2000, 'control plane blocked behind held provider I/O');
    assert.equal(queued.disposition, 'queued');
    releaseHeld();
    const waiting = await until(() => client.call('task.status', { task_id: id }), value => value.question != null && notifications.some(item => item.params.event?.seq === value.high_water_seq), 'clarification');
    const events = notifications.filter(item => item.method === 'task.event');
    assert.deepEqual(events.map(item => item.params.event.seq), Array.from({ length: Number(waiting.high_water_seq) }, (_, i) => String(i + 1)));
    assert(events.every(item => item.params.subscription_id === subscribed.subscription_id));
    assert.equal(requests.length, 3);
    assert.equal(waiting.profile_digest, accepted.profile_digest);
    assert.equal(waiting.pending_messages.length, 1);
    const question = waiting.question;
    // Every preceding response has crossed durable acquisition; force process
    // death while the authored question and evidence remain retained.
    client.child.kill('SIGKILL');
    assert.equal((await client.closed).signal, 'SIGKILL');
    clients.delete(client);
    await writeFile(join(root, 'src/main.zig'), changed);
    const pendingArchive = join(directory, 'repository-pending.bundle');
    const exported = JSON.parse(invoke('export-checkpoint', '--state-dir', state, '--task-id', id, '--output', pendingArchive));
    assert.equal(exported.task_id, id);
    const pendingBytes = await readFile(pendingArchive);
    const changedConfig = join(directory, 'changed-profile.json');
    await writeFile(changedConfig, JSON.stringify({ ...config, responses: { ...config.responses, effort: 'high' } }));
    const rejected = spawnSync(binary, ['resume', '--state-dir', state, '--task-id', id, '--config', changedConfig], { cwd: directory, env: { PATH: '/nonexistent' }, encoding: 'utf8', timeout: 5000 });
    assert.equal(rejected.status, 64, 'a resume cannot change the frozen profile');
    assert.equal(requests.length, 3);
    client = launch(['--profile-task', id, '--config', configPath]);
    await client.initialize();
    const reopened = await client.call('task.status', { task_id: id });
    assert.deepEqual(reopened.question, question);
    assert.equal(reopened.profile_digest, accepted.profile_digest);
    assert.equal(requests.length, 3, 'opening an existing namespace cannot resume inference');
    await client.call('task.resume', { client_operation_id: 'resume-once', task_id: id, expected_revision: reopened.revision });
    await client.call('task.respond', { client_operation_id: 'answer-once', task_id: id, question_id: question.question_id, question_revision: question.question_revision, request_digest: question.request_digest, answer: { schema_id: question.answer_schema_id, value: { message: 'Explain the exported function.' } } });
    const result = await until(() => client.call('task.result', { task_id: id }), value => value.ready, 'report');
    const investigationMilliseconds = performance.now() - investigationStarted;
    if (providerFailure) throw providerFailure;
    assert.equal(requests.length, 4);
    assert.equal(result.outcome.type, 'completed');
    const report = result.outcome.value;
    assert.equal(report.disposition, 'report');
    assert.equal(report.summary, 'The exported answer function returns 42.');
    assert.equal(report.model_calls, 4);
    assert.equal(report.work_calls, 3);
    assert.equal(report.evidence[0].content, source);
    assert.equal(report.evidence[0].sha256, hash(source));
    assert.equal(await readFile(join(root, 'src/main.zig'), 'utf8'), changed, 'application must not mutate the repository');
    const final = await client.call('task.status', { task_id: id });
    assert.equal(final.profile_digest, pending.profile_digest);
    assert.equal(final.pending_messages.length, 0);
    assert(!JSON.stringify(notifications).includes('qualification-only'));
    assert(!JSON.stringify(notifications).includes('opaque+/=雪'));
    assert.deepEqual(await client.close(), { code: 0, signal: null });
    clients.delete(client);
    const completedArchive = join(directory, 'repository-completed.bundle');
    invoke('export-checkpoint', '--state-dir', state, '--task-id', id, '--output', completedArchive);
    const completedBytes = await readFile(completedArchive);
    const parity = await compareContinuation(process.argv[3], process.argv[4], join(controller, 'recorded-input.pki3'), pendingBytes, completedBytes);
    const importedState = join(directory, 'imported pending');
    const imported = JSON.parse(invoke('import-checkpoint', '--state-dir', importedState, '--input', pendingArchive, '--operation-id', 'import-pending'));
    assert.equal(imported.task_id, id);
    assert.deepEqual(imported.question, question);
    const importedStatus = JSON.parse(invoke('status', '--state-dir', importedState, '--task-id', id));
    assert.equal(importedStatus.profile_digest, accepted.profile_digest);
    assert.equal(importedStatus.pending_messages.length, 1);
    // Minimal checkpoint corruption cannot expose a missing provider replay
    // object hidden in an encoded reply. Exercise that distinct closure here.
    const brokenArchive = join(directory, 'missing-replay.bundle');
    await writeFile(brokenArchive, missingReplayObject(completedBytes), { mode: 0o600 });
    const recoveredState = join(directory, 'import recovery');
    const rejectedImport = spawnSync(binary, ['import-checkpoint', '--state-dir', recoveredState, '--input', brokenArchive, '--operation-id', 'import-completed'], { cwd: directory, env: { PATH: '/nonexistent' }, encoding: 'utf8', timeout: 5000 });
    assert.equal(rejectedImport.status, 64);
    assert.equal(JSON.parse(rejectedImport.stdout).reason, 'MissingArtifact');
    invoke('import-checkpoint', '--state-dir', recoveredState, '--input', completedArchive, '--operation-id', 'import-completed');
    assert.deepEqual(JSON.parse(invoke('result', '--state-dir', recoveredState, '--task-id', id)).outcome.value, report);
    assert.equal(requests.length, 4, 'archive validation and recorded replay cannot acquire inference');
    // One distinct fault phase: acknowledge cancellation with provider I/O held,
    // then preserve its unknown physical delivery across disconnect and retry.
    client = launch(['--config', configPath]);
    await client.initialize();
    const cancellationInput = {client_operation_id: 'cancel-held-submit', application_id: 'repository-agent', profile_id: 'fixed', input: {schema_id: 'repository-agent.input.v1', value: {task: 'This investigation will be cancelled.'}}};
    const cancellationTask = await client.call('task.submit', cancellationInput);
    let cancelHeldTimer;
    try {
      await Promise.race([cancelHeldRequest, new Promise((_, reject) => { cancelHeldTimer = setTimeout(() => reject(new Error('cancellation provider hold timeout')), 15000); })]);
    } finally { clearTimeout(cancelHeldTimer); }
    const cancelStarted = performance.now();
    const cancellationParams = {client_operation_id: 'cancel-held', task_id: cancellationTask.task_id};
    const cancellation = await client.call('task.cancel', cancellationParams, 2000);
    const cancelMilliseconds = performance.now() - cancelStarted;
    assert.equal(cancellation.disposition, 'cancellation_requested');
    assert(cancelMilliseconds < 2000, 'cancel acknowledgment must not await the held provider');
    await until(() => client.call('task.status', {task_id: cancellationTask.task_id}), value => value.status === 'unknown', 'unknown cancelled delivery');
    assert.deepEqual(await client.close(), {code: 2, signal: null});
    clients.delete(client);
    client = launch(['--config', configPath]);
    await client.initialize();
    const recoveredUnknown = await client.call('task.status', {task_id: cancellationTask.task_id});
    assert.equal(recoveredUnknown.status, 'unknown');
    assert.equal((await client.call('task.submit', cancellationInput)).task_id, cancellationTask.task_id);
    assert.equal((await client.call('task.cancel', cancellationParams)).receipt_id, cancellation.receipt_id);
    await assert.rejects(client.call('task.resume', {client_operation_id: 'unsafe-resume', task_id: cancellationTask.task_id, expected_revision: recoveredUnknown.revision}), error => error.data?.kind === 'StateConflict');
    assert.equal((await client.call('task.result', {task_id: cancellationTask.task_id})).ready, false);
    // This reader/replayer did not resume or newly claim the old task.
    assert.deepEqual(await client.close(), {code: 0, signal: null});
    clients.delete(client);
    assert.equal(requests.length, 5, 'unknown delivery cannot trigger another provider request');
    if (providerFailure) throw providerFailure;
    return { provider_calls: requests.length, investigation_provider_calls: 4, launch_to_first_provider_ms: firstProviderAt - investigationStarted, investigation_ms: investigationMilliseconds, duration_scope: 'controlled investigation including client actions, deliberate hold and forced restart; not live-provider latency', cancellation_unknown_after_restart: true, cancel_ack_ms: cancelMilliseconds, restart_without_retry: true, frozen_snapshot: true, clarification: true, followup: true, control_ms: latency, held_io_control_samples: controlSamples, ...parity };
  } finally {
    releaseHeld();
    releaseCancelHeld();
    for (const client of clients) { client.child.kill('SIGKILL'); await client.closed; }
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
}

const source = process.argv[2];
assert(source && process.argv[3] && process.argv[4] && process.argv[5]);
const isolated = deployment(source, 'repository-agent');
const directory = isolated.data;
let passed = false;
try {
  const binary = isolated.command;
  const invoke = (...args) => {
    const result = spawnSync(binary, args, { cwd: directory, env: { PATH: '/nonexistent' }, encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
    assert.equal(result.status, 0, `${args[0]}: ${result.error ?? result.stderr ?? result.stdout}`);
    return result.stdout;
  };
  assert.match(invoke('--help'), /serve --transport stdio/);
  const manifest = JSON.parse(invoke('describe-build'));
  assert.match(manifest.target, /^(?:x86_64-linux.*-musl|aarch64-macos.*)$/);
  await foreignApplication(binary, directory, process.argv[5]);
  const result = JSON.parse(invoke('demo', '--offline', '--state-dir', join(directory, 'state')));
  assert.equal(result.mode, 'offline-demo');
  assert.equal(result.output.disposition, 'report');
  console.log(JSON.stringify({ repository_agent: 'controlled-https', ...await repositoryHttps(binary, directory, isolated.controller, invoke) }));
  passed = true;
} finally {
  isolated.close(passed);
}
