// Copied reference application; no source tree, build tool or interpreter on PATH.
import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import { createServer } from 'node:https';
import { mkdir, writeFile, readFile, rename, link, unlink } from 'node:fs/promises';
import { once } from 'node:events';
import { AgentClient } from '../../examples/native-minimal/stdio-client.mts';
import { certificates } from './mobility_tls_fixture.mjs';
import { compareContinuation, missingReplayObject, missingCaptures, omittedAttempts, invalidQueuedMessage, invalidConsumedMessage, falseEventFact, omittedFactEvent, extraPrivateArtifact, readArchive } from './native_archive.mjs';
import { deployment } from './native_deployment.mjs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function clientIntegerSchemas(probe) {
  const cases = [];
  for (const [definition, minimum, maximum] of [['unsigned', 0n, (1n << 64n) - 1n], ['signed', -(1n << 63n), (1n << 63n) - 1n]]) {
    const values = new Set([minimum - 1n, minimum, minimum + 1n, -1n, 0n, 1n, 9007199254740993n, maximum - 1n, maximum, maximum + 1n]);
    // Probe every decimal-prefix threshold, independently using BigInt order.
    for (const bound of [maximum, -minimum]) {
      const digits = String(bound);
      for (let i = 1; i <= digits.length; i++) {
        const prefix = BigInt(digits.slice(0, i)) * 10n ** BigInt(digits.length - i);
        for (const delta of [-1n, 0n, 1n]) { values.add(prefix + delta); values.add(-prefix + delta); }
      }
    }
    for (const value of values) cases.push({definition, value: String(value), accept: value >= minimum && value <= maximum});
    for (const value of ['', '00', '01', '-0', '-01', '+1', '1.0', '1e0', '1\n', ' 1', '1 ', '１', 1, null]) cases.push({definition, value, accept: false});
  }
  const textValues = ['', 'x'.repeat(16), 'x'.repeat(17), '雪'.repeat(5), '雪'.repeat(5) + 'a', '雪'.repeat(6), '😀'.repeat(4), '😀'.repeat(4) + 'a', '\u0000'.repeat(16), 1, null];
  for (const value of textValues) cases.push({definition: 'text', value, accept: typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 16});
  // Independent base64url oracle: Buffer's canonical re-encoding plus byte bound.
  const byteValues = new Set(['', '!', 'A', 'AAA', 'AAAA', 'AAAAA', 'AAAAAA', 'AAAAAAA', 'AA=', 'AA\n', 'AA ', '+A', '/A', '雪']);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  for (const last of alphabet) { byteValues.add(`A${last}`); byteValues.add(`AA${last}`); byteValues.add(`AAAAA${last}`); }
  for (let size = 0; size <= 5; size++) byteValues.add(Buffer.alloc(size, 255).toString('base64url'));
  for (const value of byteValues) {
    const decoded = Buffer.from(value, 'base64url');
    const accept = decoded.length <= 4 && decoded.toString('base64url') === value;
    cases.push({definition: 'bytes', value, accept});
    cases.push({definition: 'nested', value: {label: '雪', payload: value}, accept});
  }
  cases.push({definition: 'bytes', value: 1, accept: false}, {definition: 'nested', value: {label: '雪'.repeat(6), payload: 'AA'}, accept: false});
  const result = spawnSync(probe, ['client-integers', JSON.stringify(cases)], {encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024});
  assert.equal(result.status, 0, result.error ?? result.stderr);
  const {schema, accepted} = JSON.parse(result.stdout);
  assert.deepEqual(accepted, cases.map(item => item.accept), 'native client value admission');
  const validation = spawnSync('uv', ['run', '--no-project', '--no-config', '--python', '3.12', '--with', 'jsonschema==4.23.0', fileURLToPath(new URL('./native_schema.py', import.meta.url))], {input: JSON.stringify({schema, cases}), encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024});
  assert.equal(validation.status, 0, validation.error ?? validation.stderr);
  process.stdout.write(validation.stdout);
}
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

async function foreignApplication(repository, directory, source, schemaId) {
  const minimal = deployment(source, 'agent-native-example');
  let passed = false, client;
  try {
    const state = join(minimal.data, 'foreign state');
    const run = spawnSync(minimal.command, ['run', '--offline', '--state-dir', state, '--input-json', '{"value":20}', '--operation-id', 'foreign-submit'], {cwd: minimal.data, env: {PATH: '/nonexistent'}, encoding: 'utf8', timeout: 5000});
    assert.equal(run.status, 0, run.error ?? run.stderr);
    const task = JSON.parse(run.stdout);
    assert.equal(task.status, 'waiting_input');
    const completed = spawnSync(minimal.command, ['demo', '--offline', '--state-dir', state], {cwd: minimal.data, env: {PATH: '/nonexistent'}, encoding: 'utf8', timeout: 5000});
    assert.equal(completed.status, 0, completed.error ?? completed.stderr);
    const done = JSON.parse(completed.stdout);
    const failed = spawnSync(minimal.command, ['run', '--offline', '--state-dir', state, '--input-json', '{"value":4294967295}', '--operation-id', 'foreign-failure'], {cwd: minimal.data, env: {PATH: '/nonexistent'}, encoding: 'utf8', timeout: 5000});
    assert.equal(failed.status, 1, failed.error ?? failed.stderr);
    const failure = JSON.parse(failed.stdout);
    // Move the closed directory on the same filesystem, preserving the namespace's
    // device/inode identity. Copying it would correctly fail namespace admission
    // before reaching the application contract tested here. Neither application
    // can read the other's executable, source or controller files.
    const reopened = join(directory, 'foreign state');
    await rename(state, reopened);
    const cases = [];
    const saved = [[task.task_id, 'waiting_input'], [done.task_id, 'completed'], [failure.task_id, 'failed']];
    for (const [id, status] of saved) for (const command of ['status', 'result']) {
      const query = spawnSync(repository, [command, '--offline', '--state-dir', reopened, '--task-id', id], {cwd: directory, env: {PATH: '/nonexistent'}, encoding: 'utf8', timeout: 5000});
      assert.equal(query.status, 0, query.error ?? query.stderr);
      const value = JSON.parse(query.stdout);
      assert.equal(value.status, status);
      cases.push({definition: `task.${command}.result`, value});
    }
    client = new AgentClient(repository, ['--offline', '--state-dir', reopened], {cwd: directory, env: {PATH: '/nonexistent'}});
    await client.initialize();
    const chunks = [];
    let offset = 0, schema;
    for (let page = 0; page < 64; page++) {
      const chunk = await client.call('artifact.read', {artifact_id: schemaId, offset: String(offset), length: '32768'});
      assert.equal(chunk.sha256, schemaId);
      const bytes = Buffer.from(chunk.data, 'base64url');
      chunks.push(bytes); offset += bytes.length;
      if (chunk.eof) {
        const bytes = Buffer.concat(chunks);
        assert.equal(hash(bytes), schemaId);
        schema = JSON.parse(bytes);
        break;
      }
    }
    assert(schema, 'bounded protocol schema');
    const before = await client.call('task.status', {task_id: task.task_id});
    await assert.rejects(client.call('task.message', {client_operation_id: 'foreign-message', task_id: task.task_id, message: {schema_id: 'repository-agent.message.v1', value: {message: 'Follow up on the other application.'}}}), error => error.data?.kind === 'StateConflict');
    assert.deepEqual(await client.call('task.status', {task_id: task.task_id}), before);
    assert.equal((await client.call('task.result', {task_id: task.task_id})).ready, false);
    for (const [id, status] of saved) {
      const snapshot = await client.call('task.status', {task_id: id});
      const result = await client.call('task.result', {task_id: id});
      assert.equal(snapshot.status, status);
      assert.equal(result.status, status);
      if (status === 'completed') assert.deepEqual(result.outcome.value, done.output);
      if (status === 'failed') assert.deepEqual(result.outcome, failure.outcome);
      cases.push({definition: 'task.status.result', value: snapshot}, {definition: 'task.result.result', value: result});
      cases.push({definition: 'task.events.result', value: await client.call('task.events', {task_id: id, after_seq: '0'})});
    }
    assert.deepEqual(await client.close(), {code: 0, signal: null});
    client = null;
    const validation = spawnSync('uv', ['run', '--no-project', '--no-config', '--python', '3.12', '--with', 'jsonschema==4.23.0', fileURLToPath(new URL('./native_schema.py', import.meta.url))], {input: JSON.stringify({schema, cases}), encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024});
    assert.equal(validation.status, 0, validation.error ?? validation.stderr);
    process.stdout.write(validation.stdout);
    passed = true;
  } finally {
    if (client) { client.child.kill('SIGKILL'); await client.closed; }
    minimal.close(passed);
  }
}

async function largeSnapshot(binary, directory, config, trust, invoke) {
  const root = join(directory, 'large snapshot');
  const state = join(directory, 'large snapshot state');
  const configPath = join(directory, 'large snapshot.json');
  await mkdir(root);
  const contents = Buffer.alloc(256 * 1024, 0x61);
  const contentDigest = createHash('sha256').update(contents).digest();
  const natural = value => {
    const bytes = [];
    do { const low = value & 127; value >>>= 7; bytes.push(low | (value ? 128 : 0)); } while (value);
    return Buffer.from(bytes);
  };
  const prefix = Buffer.alloc(8); prefix.writeUInt32LE(1);
  const parts = [prefix, natural(63)];
  for (let i = 0; i < 63; i++) {
    const path = `file-${String(i).padStart(2, '0')}.txt`;
    await writeFile(join(root, path), contents);
    const name = Buffer.from(path);
    parts.push(natural(name.length), name, contentDigest, natural(contents.length), contents);
  }
  const expected = Buffer.concat(parts);
  assert(expected.length > 15 * 1024 * 1024 && expected.length < 16 * 1024 * 1024);
  await writeFile(configPath, JSON.stringify({...config, workspace: 'large-fixture', snapshot_root: root}));
  let client;
  const open = async args => {
    client = new AgentClient(binary, ['--state-dir', state, '--test-provider', '--trust-root', trust, ...args], {cwd: directory, env: {PATH: '/nonexistent'}});
    await client.initialize();
    return client;
  };
  try {
    await open(['--config', configPath]);
    const description = await client.call('describe');
    const input = {client_operation_id: 'large-submit', application_id: 'repository-agent', profile_id: description.profile.id, input: {schema_id: 'repository-agent.input.v1', value: {task: 'Inspect this frozen repository.'}}};
    const accepted = await client.call('task.submit', input);
    let status;
    for (let i = 0; i < 400; i++) {
      status = await client.call('task.status', {task_id: accepted.task_id});
      if (status.status === 'blocked') break;
      await delay(10);
    }
    assert.equal(status.status, 'blocked', 'large task reaches the ordinary inference grant boundary');
    assert.equal(status.blocker, 'denied');
    assert.deepEqual(await client.close(), {code: 0, signal: null}); client = null;
    // Recovery must use the durable snapshot, even after every source is gone.
    for (let i = 0; i < 63; i++) await unlink(join(root, `file-${String(i).padStart(2, '0')}.txt`));
    await open(['--profile-task', accepted.task_id]);
    assert.equal((await client.call('describe')).profile.resource_identity, description.profile.resource_identity);
    assert.equal((await client.call('task.submit', input)).task_id, accepted.task_id);
    assert.equal((await client.call('task.status', {task_id: accepted.task_id})).status, 'blocked');
    assert.deepEqual(await client.close(), {code: 0, signal: null}); client = null;
    const archivePath = join(directory, 'large snapshot.bundle');
    invoke('export-checkpoint', '--state-dir', state, '--task-id', accepted.task_id, '--output', archivePath);
    const archive = readArchive(await readFile(archivePath));
    assert.equal(archive.task.resources.length, 1);
    assert.deepEqual(archive.object(archive.task.resources[0]), expected, 'independent expected snapshot wire bytes');
    const restoredState = join(directory, 'large snapshot imported');
    const restored = JSON.parse(invoke('import-checkpoint', '--state-dir', restoredState, '--input', archivePath, '--operation-id', 'large-import'));
    assert.equal(restored.task_id, accepted.task_id);
    const reexport = join(directory, 'large snapshot reexport.bundle');
    invoke('export-checkpoint', '--state-dir', restoredState, '--task-id', accepted.task_id, '--output', reexport);
    const imported = readArchive(await readFile(reexport));
    assert.deepEqual(imported.object(imported.task.resources[0]), expected);
    return {bytes: expected.length, files: 63, durable_roundtrip: true};
  } finally {
    if (client) { client.child.kill('SIGKILL'); await client.closed; }
  }
}

async function repositoryHttps(binary, directory, controller, invokeBase) {
  const root = join(directory, 'controlled repository');
  const state = join(directory, 'https state');
  await mkdir(join(root, 'src'), { recursive: true });
  const source = 'pub fn answer() u32 { return 42; }\n';
  const changed = 'pub fn answer() u32 { return 99; }\n';
  await writeFile(join(root, 'src/main.zig'), source);
  const tls = await certificates(controller);
  const trust = join(directory, 'provider-root.der');
  const credential = join(directory, 'provider-token');
  const invoke = (...args) => invokeBase(...args, '--test-provider', '--trust-root', trust);
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
  let announceDisconnectHeld, releaseDisconnectHeld;
  const disconnectHeldRequest = new Promise(resolve => { announceDisconnectHeld = resolve; });
  const disconnectHeld = new Promise(resolve => { releaseDisconnectHeld = resolve; });
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
      if (index === 4 || index === 5) {
        assert.equal(body.input.filter(item => item.type === 'function_call_output').length, 0);
        if (index === 4) {
          announceCancelHeld();
          await cancelHeld;
        } else {
          announceDisconnectHeld();
          await disconnectHeld;
        }
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
    const referenceConfig = join(directory, 'reference-profile.json');
    const externalConfig = join(directory, 'external-profile.json');
    await writeFile(referenceConfig, JSON.stringify({...config, responses: {...config.responses, endpoint: 'https://api.openai.com/v1/responses'}}));
    await writeFile(externalConfig, JSON.stringify({...config, responses: {...config.responses, endpoint: 'https://example.test/v1/responses'}}));
    for (const [args, expected] of [
      [['--config', referenceConfig, '--credential-file', credential], 0],
      [['--config', configPath, '--credential-file', credential, '--trust-root', trust], 64],
      [['--config', externalConfig, '--credential-file', credential], 64],
      [['--config', externalConfig, '--test-provider', '--trust-root', trust], 64],
      [['--config', configPath, '--test-provider', '--trust-root', trust, '--credential-file', credential], 64],
      [['--config', configPath, '--test-provider'], 64],
      [['--config', configPath, '--test-provider', '--trust-root', trust], 0],
    ]) {
      const validation = spawnSync(binary, ['validate', ...args], {cwd: directory, env: {PATH: '/nonexistent'}, encoding: 'utf8', timeout: 5000});
      assert.equal(validation.status, expected, validation.error ?? validation.stderr);
    }
    const snapshotCredential = join(root, 'credential-source');
    for (const kind of ['direct', 'hard-link', 'copied', 'embedded']) {
      if (kind === 'hard-link') await link(credential, snapshotCredential);
      else await writeFile(snapshotCredential, kind === 'embedded' ? 'token=qualification-only\n' : 'qualification-only\n', {mode: 0o600});
      try {
        const validation = spawnSync(binary, ['validate', '--config', referenceConfig, '--credential-file', kind === 'direct' ? snapshotCredential : credential], {cwd: directory, env: {PATH: '/nonexistent'}, encoding: 'utf8', timeout: 5000});
        assert.equal(validation.status, 64, `${kind}: ${validation.error ?? validation.stderr}`);
        assert(!`${validation.stdout}${validation.stderr}`.includes('qualification-only'));
      } finally { await unlink(snapshotCredential); }
    }
    const separateCredential = spawnSync(binary, ['validate', '--config', referenceConfig, '--credential-file', credential], {cwd: directory, env: {PATH: '/nonexistent'}, encoding: 'utf8', timeout: 5000});
    assert.equal(separateCredential.status, 0, separateCredential.error ?? separateCredential.stderr);
    assert.equal(requests.length, 0, 'configuration admission cannot dispatch inference');
    const largeSnapshotProof = await largeSnapshot(binary, directory, config, trust, invoke);
    assert.equal(requests.length, 0, 'large snapshot admission and recovery cannot dispatch without a grant');
    const launch = extra => {
      const client = new AgentClient(binary, ['--state-dir', state, '--authorize-inference', '--test-provider', '--trust-root', trust, ...extra], { cwd: directory, env: { PATH: '/nonexistent' }, onNotification: frame => notifications.push(frame) });
      const call = client.call.bind(client);
      client.call = async (method, ...args) => {
        try { return await call(method, ...args); }
        catch (error) { error.stack = `${method}: ${error.stack}`; throw error; }
      };
      clients.add(client);
      return client;
    };
    const investigationStarted = performance.now();
    let client = launch(['--config', configPath]);
    await client.initialize();
    const description = await client.call('describe');
    assert.equal(description.execution_mode, 'live');
    assert.equal(description.profile.id, 'controlled-test');
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
    const rejected = spawnSync(binary, ['resume', '--state-dir', state, '--task-id', id, '--config', changedConfig, '--test-provider', '--trust-root', trust], { cwd: directory, env: { PATH: '/nonexistent' }, encoding: 'utf8', timeout: 5000 });
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
    const queueRecovery = join(directory, 'queued import recovery');
    for (const change of ['omitted', 'omitted-acquired', 'omitted-record', 'acquired-unbound', 'queued-bound', 'acquired-question', 'consumed', 'not-consumed', 'schema', 'ordinal-zero', 'ordinal-future', 'payload', 'admission-payload', 'message-message_id', 'message-ordinal', 'message-disposition', 'message-false-consumption', 'message-admission-revision']) {
      const malformed = join(directory, `queued-${change}.bundle`);
      await writeFile(malformed, change.startsWith('message-') ? falseEventFact(pendingBytes, change) : invalidQueuedMessage(pendingBytes, change), {mode: 0o600});
      const rejected = spawnSync(binary, ['import-checkpoint', '--state-dir', queueRecovery, '--input', malformed, '--operation-id', 'import-queued', '--test-provider', '--trust-root', trust], {cwd: directory, env: {PATH: '/nonexistent'}, encoding: 'utf8', timeout: 5000});
      assert.equal(rejected.status, 64, rejected.error ?? rejected.stderr);
      assert.equal(JSON.parse(rejected.stdout).reason, 'InvalidArchive', change);
    }
    const validQueue = JSON.parse(invoke('import-checkpoint', '--state-dir', queueRecovery, '--input', pendingArchive, '--operation-id', 'import-queued'));
    assert.equal(validQueue.task_id, id);
    assert.equal(validQueue.pending_messages.length, 1);
    assert.equal(validQueue.pending_messages[0].disposition, 'queued');
    const historyRecovery = join(directory, 'consumed import recovery');
    for (const change of ['dangling-occurrence', 'requeued', 'message-message_id', 'message-ordinal', 'message-disposition', 'omitted-consumption', 'private-artifact']) {
      const malformed = join(directory, `consumed-${change}.bundle`);
      const changed = change === 'omitted-consumption' ? omittedFactEvent(completedBytes, 'message_consumed') : change === 'private-artifact' ? extraPrivateArtifact(completedBytes, 'capture') : change.startsWith('message-') ? falseEventFact(completedBytes, change) : invalidConsumedMessage(completedBytes, change);
      await writeFile(malformed, changed, {mode: 0o600});
      const rejected = spawnSync(binary, ['import-checkpoint', '--state-dir', historyRecovery, '--input', malformed, '--operation-id', 'import-history', '--test-provider', '--trust-root', trust], {cwd: directory, env: {PATH: '/nonexistent'}, encoding: 'utf8', timeout: 5000});
      assert.equal(rejected.status, 64, rejected.error ?? rejected.stderr);
      assert.equal(JSON.parse(rejected.stdout).reason, 'InvalidArchive', change);
    }
    invoke('import-checkpoint', '--state-dir', historyRecovery, '--input', completedArchive, '--operation-id', 'import-history');
    assert.deepEqual(JSON.parse(invoke('result', '--state-dir', historyRecovery, '--task-id', id)).outcome.value, report);
    // Minimal checkpoint corruption cannot expose a missing provider replay
    // object hidden in an encoded reply. Exercise that distinct closure here.
    const brokenArchive = join(directory, 'missing-replay.bundle');
    await writeFile(brokenArchive, missingReplayObject(completedBytes), { mode: 0o600 });
    const recoveredState = join(directory, 'import recovery');
    const rejectedImport = spawnSync(binary, ['import-checkpoint', '--state-dir', recoveredState, '--input', brokenArchive, '--operation-id', 'import-completed', '--test-provider', '--trust-root', trust], { cwd: directory, env: { PATH: '/nonexistent' }, encoding: 'utf8', timeout: 5000 });
    assert.equal(rejectedImport.status, 64);
    assert.equal(JSON.parse(rejectedImport.stdout).reason, 'MissingArtifact');
    invoke('import-checkpoint', '--state-dir', recoveredState, '--input', completedArchive, '--operation-id', 'import-completed');
    assert.deepEqual(JSON.parse(invoke('result', '--state-dir', recoveredState, '--task-id', id)).outcome.value, report);
    assert.equal(requests.length, 4, 'archive validation and recorded replay cannot acquire inference');
    // One distinct fault phase: acknowledge cancellation with provider I/O held,
    // then preserve its unknown physical delivery across disconnect and retry.
    client = launch(['--config', configPath]);
    await client.initialize();
    const cancellationProfile = (await client.call('describe')).profile;
    assert.equal(cancellationProfile.id, 'controlled-test');
    const cancellationInput = {client_operation_id: 'cancel-held-submit', application_id: 'repository-agent', profile_id: cancellationProfile.id, input: {schema_id: 'repository-agent.input.v1', value: {task: 'This investigation will be cancelled.'}}};
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
    client = launch(['--config', configPath]);
    await client.initialize();
    const disconnectInput = {...cancellationInput, client_operation_id: 'disconnect-held-submit'};
    const disconnectTask = await client.call('task.submit', disconnectInput);
    let disconnectTimer;
    try {
      await Promise.race([disconnectHeldRequest, new Promise((_, reject) => { disconnectTimer = setTimeout(() => reject(new Error('disconnect provider hold timeout')), 15000); })]);
    } finally { clearTimeout(disconnectTimer); }
    // No subscription or response remains queued; stdin stays open and no
    // additional request or cancellation supplies a write to detect closure.
    const disconnected = client;
    const disconnectStarted = performance.now();
    const disconnectKill = setTimeout(() => disconnected.child.kill('SIGKILL'), 7000);
    disconnected.child.stdout.destroy();
    try { assert.deepEqual(await disconnected.closed, {code: 74, signal: null}); }
    finally { clearTimeout(disconnectKill); }
    const disconnectMilliseconds = performance.now() - disconnectStarted;
    assert(disconnectMilliseconds < 6000, 'held provider is parked within disconnect budget');
    assert.equal(disconnected.child.stdin.writableEnded, false);
    clients.delete(disconnected);
    client = launch(['--config', configPath]);
    await client.initialize();
    const disconnectedStatus = await client.call('task.status', {task_id: disconnectTask.task_id});
    assert.equal(disconnectedStatus.status, 'unknown');
    assert.equal(disconnectedStatus.cancellation, null, 'disconnect is not semantic cancellation');
    assert.equal((await client.call('task.submit', disconnectInput)).task_id, disconnectTask.task_id);
    await assert.rejects(client.call('task.resume', {client_operation_id: 'disconnect-resume', task_id: disconnectTask.task_id, expected_revision: disconnectedStatus.revision}), error => error.data?.kind === 'StateConflict');
    assert.deepEqual(await client.close(), {code: 0, signal: null});
    clients.delete(client);
    assert.equal(requests.length, 6, 'broken output cannot dispatch again or retry unknown delivery');
    if (providerFailure) throw providerFailure;
    return { large_snapshot: largeSnapshotProof, provider_calls: requests.length, investigation_provider_calls: 4, launch_to_first_provider_ms: firstProviderAt - investigationStarted, investigation_ms: investigationMilliseconds, duration_scope: 'controlled investigation including client actions, deliberate hold and forced restart; not live-provider latency', cancellation_unknown_after_restart: true, cancel_ack_ms: cancelMilliseconds, broken_output_unknown_after_restart: true, broken_output_ms: disconnectMilliseconds, restart_without_retry: true, frozen_snapshot: true, clarification: true, followup: true, control_ms: latency, held_io_control_samples: controlSamples, ...parity };
  } finally {
    releaseHeld();
    releaseCancelHeld();
    releaseDisconnectHeld();
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
    assert.equal(result.status, 0, `${args[0]}: ${result.error ?? (result.stderr || result.stdout)}`);
    return result.stdout;
  };
  assert.match(invoke('--help'), /serve --transport stdio/);
  const manifest = JSON.parse(invoke('describe-build'));
  assert.match(manifest.target, /^(?:x86_64-linux.*-musl|aarch64-macos.*)$/);
  clientIntegerSchemas(process.argv[4]);
  await foreignApplication(binary, directory, process.argv[5], manifest.protocol_schema_sha256);
  const result = JSON.parse(invoke('demo', '--offline', '--state-dir', join(directory, 'state')));
  assert.equal(result.mode, 'offline-demo');
  assert.equal(result.output.disposition, 'report');
  const captureState = join(directory, 'capture closure');
  const captureTask = JSON.parse(invoke('run', '--offline', '--state-dir', captureState, '--input-json', '{"task":"Explain the fixture."}', '--operation-id', 'capture-submit'));
  assert.equal(captureTask.status, 'waiting_input');
  const captureArchive = join(directory, 'capture-closure.bundle');
  invoke('export-checkpoint', '--offline', '--state-dir', captureState, '--task-id', captureTask.task_id, '--output', captureArchive);
  const captureBytes = await readFile(captureArchive);
  for (const change of ['all', 'one', 'prepared-marker', 'attempts-and-captures']) {
    const malformed = join(directory, `capture-${change}.bundle`);
    const destination = join(directory, `capture-${change}-import`);
    await writeFile(malformed, change === 'attempts-and-captures' ? omittedAttempts(captureBytes) : missingCaptures(captureBytes, change), {mode: 0o600});
    const rejected = spawnSync(binary, ['import-checkpoint', '--offline', '--state-dir', destination, '--input', malformed, '--operation-id', 'capture-import'], {cwd: directory, env: {PATH: '/nonexistent'}, encoding: 'utf8', timeout: 5000});
    assert.equal(rejected.status, 64, rejected.error ?? rejected.stderr);
    assert.equal(JSON.parse(rejected.stdout).reason, 'InvalidArchive', change);
    const restored = JSON.parse(invoke('import-checkpoint', '--offline', '--state-dir', destination, '--input', captureArchive, '--operation-id', 'capture-import'));
    assert.equal(restored.task_id, captureTask.task_id);
    assert.deepEqual(restored.question, captureTask.question);
  }
  console.log(JSON.stringify({ repository_agent: 'controlled-https', ...await repositoryHttps(binary, directory, isolated.controller, invoke) }));
  passed = true;
} finally {
  isolated.close(passed);
}
