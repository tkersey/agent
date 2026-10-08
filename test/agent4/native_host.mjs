// Independent process peer for the build/discovery boundary. This does not
// claim the later task/recovery/provider conformance obligations are complete.
import assert from 'node:assert/strict';
import {spawn, spawnSync, execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join, resolve} from 'node:path';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {readArchive, missingCheckpoint, changedProfile, unknownOccurrence, retainedEventSuffix, cancellationState, omittedFactEvent, omittedAttempts, omittedQuestion, unboundQuestionReply, acquiredQuestionArchive, changedOperationKey, invalidEventData, falseEventFact} from './native_archive.mjs';
import {deployment} from './native_deployment.mjs';

const source = resolve(process.argv[2]);
const isolated = deployment(source, 'agent-native-example');
const directory = isolated.data;
const binary = isolated.command;
const options = {cwd: directory, env: {PATH: '/nonexistent'}, encoding: 'utf8', timeout: 5000, maxBuffer: 2 * 1024 * 1024};
const methodsById = new Map();
const schemaCases = [];
function capture(frame) {
  if (Array.isArray(frame)) { frame.forEach(capture); return; }
  const definition = frame.error ? 'error' : frame.method ?? (methodsById.has(frame.id) ? `${methodsById.get(frame.id)}.response` : null);
  if (definition) schemaCases.push({definition, value: frame});
}
function launch(state = null, lifetime = 15000) {
  const child = spawn(binary, ['serve', '--transport', 'stdio', '--offline', ...(state ? ['--state-dir', state] : [])], {cwd: directory, env: options.env, stdio: ['pipe', 'pipe', 'pipe']});
  const frames = [], waiters = [];
  let output = '', diagnostic = '', failure, initialized = false;
  const ended = once(child, 'close');
  child.stdin.on('error', error => { if (error.code !== 'EPIPE') failure = error; });
  child.stderr.on('data', bytes => { diagnostic += bytes; assert(diagnostic.length < 65536); });
  child.stdout.setEncoding('utf8').on('data', bytes => {
    output += bytes;
    assert(output.length <= 1024 * 1024);
    for (let newline; (newline = output.indexOf('\n')) >= 0;) {
      const frame = JSON.parse(output.slice(0, newline)); output = output.slice(newline + 1);
      capture(frame);
      const waiter = waiters.shift();
      if (waiter) waiter(frame); else frames.push(frame);
    }
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), lifetime);
  return {
    child,
    write: bytes => child.stdin.write(bytes),
    async next(milliseconds = 5000) {
      if (failure) throw failure;
      if (frames.length) return frames.shift();
      return Promise.race([new Promise(resolve => waiters.push(resolve)), new Promise((_, reject) => { const timeout = setTimeout(() => reject(new Error('native response timeout')), milliseconds); timeout.unref(); })]);
    },
    async end(code = 0, mode = 'park') {
      child.stdin.end();
      const [actual, signal] = await ended;
      clearTimeout(timer);
      assert.equal(signal, null, diagnostic);
      assert.equal(actual, code, diagnostic);
      assert.equal(output, '');
      if (initialized && (code === 0 || code === 2)) {
        assert.equal(frames.length, 1, JSON.stringify(frames));
        assert.equal(frames[0].method, 'server.closed');
        assert.equal(frames[0].params.mode, mode);
        assert.equal(frames[0].params.disposition, code === 0 ? (mode === 'cancel' ? 'cancelled' : 'parked') : 'incomplete');
        return frames[0];
      } else assert.deepEqual(frames, []);
    },
    async crash() {
      child.kill('SIGKILL');
      const [code, signal] = await ended;
      clearTimeout(timer);
      assert.equal(code, null);
      assert.equal(signal, 'SIGKILL');
    },
    async initialize(id = 'init') {
      methodsById.set(id, 'initialize');
      child.stdin.write(JSON.stringify({jsonrpc: '2.0', id, method: 'initialize', params: {protocol_versions: ['agent-host/1.0']}}) + '\n');
      const reply = await this.next();
      assert.equal(reply.id, id);
      assert.equal(reply.result.protocol_version, 'agent-host/1.0');
      initialized = true;
      return reply;
    },
  };
}
const rpc = (id, method, params = {}) => {
  methodsById.set(id, method);
  return JSON.stringify({jsonrpc: '2.0', id, method, params}) + '\n';
};
let passed = false;
try {
  assert.match(execFileSync(binary, ['--help'], options), /serve --transport stdio/);
  const describeStartedAt = performance.now();
  const manifest = JSON.parse(execFileSync(binary, ['describe-build'], options));
  const describeMilliseconds = performance.now() - describeStartedAt;
  assert.equal(manifest.format, 'agent-native-build/v1');
  assert.equal(manifest.protocol, 'agent-host/1.0');
  assert.equal(manifest.compiler.version, '0.17.0');
  assert.equal(manifest.artifact_sha256, createHash('sha256').update(readFileSync(isolated.executable)).digest('hex'));
  assert.equal(manifest.artifact_bytes, String(readFileSync(isolated.executable).length));
  assert(!JSON.stringify(manifest).includes(process.cwd()));
  assert.equal(manifest.dependencies.sqlite.version, '3.53.4');
  assert.deepEqual(manifest.licenses.map(item => item.component).sort(), ['Agent', 'World', 'Boundary', 'Zig standard library', 'SQLite', ...(manifest.target.includes('linux') ? ['musl libc'] : [])].sort());
  assert(manifest.licenses.some(item => item.component === 'SQLite' && item.text.includes('disclaims copyright')));
  const demoStarted = performance.now();
  const timedDemo = spawnSync('/usr/bin/time', [...(process.platform === 'darwin' ? ['-l'] : ['-f', 'native_demo_maxrss_kib=%M']), binary, 'demo', '--offline', '--state-dir', 'demo state'], options);
  const demoMilliseconds = performance.now() - demoStarted;
  assert.equal(timedDemo.error, undefined);
  assert.equal(timedDemo.signal, null, timedDemo.stderr);
  assert.equal(timedDemo.status, 0, timedDemo.stderr);
  const rss = timedDemo.stderr.match(process.platform === 'darwin' ? /(\d+)\s+maximum resident set size/ : /native_demo_maxrss_kib=(\d+)/);
  assert(rss, timedDemo.stderr);
  const demoMaxRssBytes = Number(rss[1]) * (process.platform === 'darwin' ? 1 : 1024);
  const demo = JSON.parse(timedDemo.stdout);
  assert.match(demo.task_id, /^[a-f0-9]{32}$/);
  const {task_id: demoTask, ...demoOutput} = demo;
  assert.deepEqual(demoOutput, {mode: 'offline-demo', persistence: 'durable', effects: 3, yields: 1, output: {value: 41, answer: 'offline answer'}});
  const cli = (command, state, ...args) => JSON.parse(execFileSync(binary, [command, '--offline', '--state-dir', state, ...args], options));
  const failedCli = (command, state, ...args) => {
    const result = spawnSync(binary, [command, '--offline', '--state-dir', state, ...args], options);
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null, result.stderr);
    assert.equal(result.status, 1, result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.equal(cli('status', 'demo state').task_id, demoTask);
  assert.deepEqual(cli('result', 'demo state', '--task-id', demoTask).outcome.value, demoOutput.output);
  const cliTask = cli('run', 'human state', '--input-json', '{"value":20}', '--operation-id', 'human-run');
  assert.equal(cliTask.status, 'waiting_input');
  assert.equal(cli('run', 'human state', '--input-json', '{"value":20}', '--operation-id', 'human-run').task_id, cliTask.task_id);
  assert.deepEqual(cli('resume', 'human state', '--task-id', cliTask.task_id, '--operation-id', 'human-resume', '--expected-revision', cliTask.revision).question, cliTask.question);
  assert.deepEqual(cli('resume', 'human state', '--task-id', cliTask.task_id, '--operation-id', 'human-resume', '--expected-revision', cliTask.revision).question, cliTask.question);
  const secondCliTask = cli('run', 'human state', '--input-json', '{"value":21}', '--operation-id', 'human-second');
  assert.notEqual(secondCliTask.task_id, cliTask.task_id);
  assert.throws(() => execFileSync(binary, ['status', '--offline', '--state-dir', 'human state'], options), error => error.status === 64);
  const cancelledCli = cli('cancel', 'human state', '--task-id', cliTask.task_id, '--operation-id', 'human-cancel');
  assert.equal(cancelledCli.status, 'cancelled');
  assert.equal(cancelledCli.outcome.cleanup_complete, true);
  const humanAnswerArgs = ['--task-id', secondCliTask.task_id, '--operation-id', 'human-answer', '--question-id', secondCliTask.question.question_id, '--question-revision', secondCliTask.question.question_revision, '--request-digest', secondCliTask.question.request_digest, '--answer-json', '{"message":"human answer"}'];
  const humanAnswered = cli('respond', 'human state', ...humanAnswerArgs);
  assert.deepEqual(humanAnswered.outcome.value, {value: 43, answer: 'human answer'});
  assert.equal(cli('respond', 'human state', ...humanAnswerArgs).revision, humanAnswered.revision);
  assert.throws(() => execFileSync(binary, ['respond', '--offline', '--state-dir', 'human state', ...humanAnswerArgs.slice(0, -1), '{"message":"conflicting answer"}'], options), error => error.status === 64);
  // The full admitted u32 domain reaches authored completion/failure, never
  // UNKNOWN delivery for deterministic arithmetic. Cover both additions.
  const incrementOverflow = failedCli('run', 'increment overflow', '--input-json', '{"value":4294967295}', '--operation-id', 'increment-overflow');
  assert.equal(incrementOverflow.status, 'failed');
  assert.equal(incrementOverflow.outcome.type, 'failed');
  assert.equal(incrementOverflow.outcome.cleanup_complete, true);
  for (const [value, expected] of [[2147483647, 'completed'], [2147483648, 'failed']]) {
    const state = `sum boundary ${value}`;
    const pending = cli('run', state, '--input-json', JSON.stringify({value}), '--operation-id', 'sum-boundary');
    assert.equal(pending.status, 'waiting_input');
    const answered = (expected === 'failed' ? failedCli : cli)('respond', state, '--task-id', pending.task_id, '--operation-id', 'sum-answer', '--question-id', pending.question.question_id, '--question-revision', pending.question.question_revision, '--request-digest', pending.question.request_digest, '--answer-json', '{"message":"boundary"}');
    assert.equal(answered.status, expected);
    if (expected === 'completed') assert.deepEqual(answered.outcome.value, {value: 4294967295, answer: 'boundary'});
    else assert.equal(answered.outcome.cleanup_complete, true);
  }
  const unsafeParent = mkdtempSync(join(directory, 'Agent writable parent '));
  try {
    chmodSync(unsafeParent, 0o777);
    const unsafeCwd = join(unsafeParent, 'private child');
    mkdirSync(unsafeCwd, {mode: 0o700});
    assert.throws(() => execFileSync(binary, ['demo', '--offline', '--state-dir', 'state'], {...options, cwd: unsafeCwd}), error => error.status === 64);
    assert.equal(existsSync(join(unsafeCwd, 'state')), false);
  } finally { rmSync(unsafeParent, {recursive: true, force: true}); }

  // All recognized entries use the same nonblocking type-admission helper.
  const fifoState = join(directory, 'fifo state');
  mkdirSync(fifoState, {mode: 0o700});
  writeFileSync(join(fifoState, 'owner.lock'), '', {mode: 0o600});
  execFileSync('/usr/bin/mkfifo', ['-m', '600', join(fifoState, 'identity')]);
  assert.throws(() => execFileSync(binary, ['status', '--offline', '--state-dir', fifoState], options), error => error.status === 64 && error.signal === null);
  rmSync(fifoState, {recursive: true});

  const portable = cli('run', 'archive pending', '--input-json', '{"value":20}', '--operation-id', 'portable-submission');
  const exported = cli('export-checkpoint', 'archive pending', '--output', 'pending.bundle');
  assert.equal(exported.task_id, portable.task_id);
  const archiveBytes = readFileSync(join(directory, 'pending.bundle'));
  assert.equal(exported.sha256, createHash('sha256').update(archiveBytes).digest('hex'));
  assert.equal(exported.bytes, String(archiveBytes.length));
  const archive = readArchive(archiveBytes);
  for (const change of ['completed', 'failed', 'cancelled', ...['accepted', 'input_accepted', 'cancellation_requested', 'resumed', 'imported'].map(kind => `admission-${kind}`), ...['question_id', 'question_revision', 'request_digest', 'answer_schema_id', 'prompt'].map(field => `question-${field}`)]) {
    const name = `false-event-${change}`;
    writeFileSync(join(directory, `${name}.bundle`), falseEventFact(archiveBytes, change), {mode: 0o600});
    assert.throws(() => execFileSync(binary, ['import-checkpoint', '--offline', '--state-dir', name, '--input', `${name}.bundle`, '--operation-id', 'import-fact'], options), error => error.status === 64 && JSON.parse(error.stdout).reason === 'InvalidArchive');
    assert.equal(cli('import-checkpoint', name, '--input', 'pending.bundle', '--operation-id', 'import-fact').task_id, portable.task_id);
  }
  assert.equal(Buffer.from(archive.task.id).toString('hex'), portable.task_id);
  assert.equal(archive.build.program_sha256, manifest.program_sha256);
  assert.equal(Buffer.from(archive.task.runtime_identity).toString('hex'), manifest.artifact_sha256);
  assert.equal(cli('export-checkpoint', 'archive pending', '--output', 'pending-again.bundle').sha256, exported.sha256);
  assert.throws(() => execFileSync(binary, ['export-checkpoint', '--offline', '--state-dir', 'archive pending', '--output', 'pending.bundle'], options), error => error.status === 64 && JSON.parse(error.stdout).reason === 'AlreadyExists');
  assert.throws(() => execFileSync(binary, ['export-checkpoint', '--offline', '--state-dir', 'archive pending', '--output', 'archive pending/forbidden.bundle'], options), error => error.status === 64);
  assert.equal(cli('status', 'archive pending').revision, portable.revision);
  const imported = cli('import-checkpoint', 'archive target', '--input', 'pending.bundle', '--operation-id', 'import-once');
  assert.equal(imported.task_id, portable.task_id);
  assert.equal(imported.disposition, 'imported');
  assert.deepEqual(imported.question, portable.question);
  assert.equal(cli('import-checkpoint', 'archive target', '--input', 'pending.bundle', '--operation-id', 'import-once').receipt_id, imported.receipt_id);
  const portableAnswer = ['--task-id', imported.task_id, '--question-id', imported.question.question_id, '--question-revision', imported.question.question_revision, '--request-digest', imported.question.request_digest, '--answer-json', '{"message":"portable answer"}', '--operation-id', 'portable-answer'];
  assert.deepEqual(cli('respond', 'archive target', ...portableAnswer).outcome.value, {value: 41, answer: 'portable answer'});
  cli('export-checkpoint', 'archive target', '--output', 'answered-portable.bundle');
  const answeredPortable = readFileSync(join(directory, 'answered-portable.bundle'));
  for (const change of ['answer-revision', 'import-origin']) {
    writeFileSync(join(directory, `${change}.bundle`), falseEventFact(answeredPortable, change), {mode: 0o600});
    assert.throws(() => execFileSync(binary, ['import-checkpoint', '--offline', '--state-dir', change, '--input', `${change}.bundle`, '--operation-id', 'import-answer-fact'], options), error => error.status === 64 && JSON.parse(error.stdout).reason === 'InvalidArchive');
    assert.equal(cli('import-checkpoint', change, '--input', 'answered-portable.bundle', '--operation-id', 'import-answer-fact').task_id, portable.task_id);
  }
  writeFileSync(join(directory, 'acquired-answer.bundle'), acquiredQuestionArchive(archiveBytes, answeredPortable), {mode: 0o600});
  writeFileSync(join(directory, 'unbound-acquired-answer.bundle'), acquiredQuestionArchive(archiveBytes, answeredPortable, true), {mode: 0o600});
  assert.throws(() => execFileSync(binary, ['import-checkpoint', '--offline', '--state-dir', 'acquired answer target', '--input', 'unbound-acquired-answer.bundle', '--operation-id', 'import-answer'], options), error => error.status === 64 && JSON.parse(error.stdout).reason === 'InvalidArchive');
  assert.equal(cli('import-checkpoint', 'acquired answer target', '--input', 'acquired-answer.bundle', '--operation-id', 'import-answer').task_id, portable.task_id);
  assert.deepEqual(cli('resume', 'acquired answer target', '--operation-id', 'resume-answer').outcome.value, {value: 41, answer: 'portable answer'});
  assert.throws(() => execFileSync(binary, ['import-checkpoint', '--offline', '--state-dir', 'archive target', '--input', 'pending.bundle', '--operation-id', 'another-import'], options), error => error.status === 64 && JSON.parse(error.stdout).reason === 'NonEmptyNamespace');
  for (const [name, bytes, expectedReason] of [
    ['attempts-and-captures', omittedAttempts(archiveBytes), 'InvalidArchive'],
    ['question-without-answer', unboundQuestionReply(archiveBytes), 'InvalidArchive'],
    ['missing', missingCheckpoint(archiveBytes), 'MissingArtifact'],
    ['profile', changedProfile(archiveBytes), 'IncompatibleProfile'],
    ['unknown', unknownOccurrence(archiveBytes), 'UnsettledOccurrence'],
    ['cancel-without-intent', cancellationState(archiveBytes, true), 'InvalidArchive'],
    ['cancel-not-applied', cancellationState(archiveBytes, true, 'not applied to World'), 'InvalidArchive'],
    ['truncated', archiveBytes.subarray(0, archiveBytes.length - 1), 'InvalidArchive'],
  ]) {
    writeFileSync(join(directory, `${name}.bundle`), bytes, {mode: 0o600});
    assert.throws(() => execFileSync(binary, ['import-checkpoint', '--offline', '--state-dir', `bad ${name}`, '--input', `${name}.bundle`, '--operation-id', 'recoverable-import'], options), error => error.status === 64 && JSON.parse(error.stdout).reason === expectedReason);
    assert.equal(cli('import-checkpoint', `bad ${name}`, '--input', 'pending.bundle', '--operation-id', 'recoverable-import').task_id, portable.task_id);
  }
  // A pending cancellation is a valid, distinct state: import must not treat
  // intent alone as already applied or require execution before data copying.
  writeFileSync(join(directory, 'pending-cancel.bundle'), cancellationState(archiveBytes, false, 'pending cancellation'), {mode: 0o600});
  const pendingCancel = cli('import-checkpoint', 'pending cancellation', '--input', 'pending-cancel.bundle', '--operation-id', 'import-pending-cancel');
  assert.equal(pendingCancel.task_id, portable.task_id);
  assert.equal(cli('resume', 'pending cancellation', '--task-id', portable.task_id).status, 'cancelled');
  const demoReader = launch('demo state');
  await demoReader.initialize();
  demoReader.write(rpc('result', 'task.result', {task_id: demoTask}));
  assert.deepEqual((await demoReader.next()).result.outcome.value, demoOutput.output);
  await demoReader.end();

  const peer = launch();
  peer.write(rpc('before', 'ping'));
  assert.equal((await peer.next()).error.data.kind, 'ProtocolState');
  peer.write('{"jsonrpc":"2.0","method":"task.cancel"}\n');
  await peer.initialize();
  const unicode = Buffer.from(rpc('雪', 'ping').trimEnd() + '\r\n');
  for (const byte of unicode) peer.write(Buffer.from([byte]));
  assert.equal((await peer.next()).id, '雪');
  peer.write(rpc('p1', 'ping') + rpc('p2', 'ping'));
  assert.equal((await peer.next()).id, 'p1');
  assert.equal((await peer.next()).id, 'p2');
  peer.write('{"jsonrpc":"2.0","id":"duplicate","method":"ping","params":{},"params":{}}\n');
  assert.equal((await peer.next()).error.data.kind, 'InvalidRequest');
  peer.write('not json\n' + rpc('after', 'ping'));
  assert.equal((await peer.next()).error.data.kind, 'ParseError');
  assert.equal((await peer.next()).id, 'after');
  peer.write(rpc('discovery', 'describe'));
  const description = (await peer.next()).result;
  assert.equal(description.profile, null); // Discovery-only launch admits no task profile.
  async function publicArtifact(id) {
    const chunks = [];
    let offset = 0;
    for (let count = 0; count < 512; count++) {
      const call = `schema-${id}-${offset}`;
      peer.write(rpc(call, 'artifact.read', {artifact_id: id, offset: String(offset), length: '32768'}));
      const reply = await peer.next();
      assert.equal(reply.id, call);
      const chunk = reply.result;
      assert.equal(chunk.sha256, id);
      const bytes = Buffer.from(chunk.data, 'base64url');
      assert.equal(bytes.toString('base64url'), chunk.data);
      assert(bytes.length <= 32768);
      chunks.push(bytes); offset += bytes.length;
      assert.equal(chunk.next_offset, String(offset));
      if (chunk.eof) {
        assert.equal(chunk.total_bytes, String(offset));
        const result = Buffer.concat(chunks);
        assert.equal(createHash('sha256').update(result).digest('hex'), id);
        return JSON.parse(result);
      }
    }
    assert.fail('bounded schema artifact');
  }
  const applicationDescription = description.application.metadata_ref ? await publicArtifact(description.application.metadata_ref.artifact_id) : description.application;
  assert.equal(applicationDescription.application_id, 'native-minimal');
  assert.equal(applicationDescription.input.json.additionalProperties, false);
  assert.equal(description.methods.length, 15);
  const protocolSchema = await publicArtifact(manifest.protocol_schema_sha256);
  if (description.protocol_schema) assert.deepEqual(protocolSchema, description.protocol_schema);
  else assert.equal(description.protocol_schema_ref.artifact_id, manifest.protocol_schema_sha256);
  assert.equal(protocolSchema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.match(protocolSchema.$id, /^urn:agent:agent-host:1.0:[a-f0-9]{64}$/);
  const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  assert.equal(createHash('sha256').update(canonical(protocolSchema)).digest('hex'), manifest.protocol_schema_sha256);
  for (const method of description.methods) {
    assert.deepEqual(protocolSchema.$defs[`${method.name}.params`].required, method.required_fields);
    assert.equal(method.params_schema, `#/$defs/${method.name}.params`);
    assert.equal(method.result_schema, `#/$defs/${method.name}.result`);
    assert(protocolSchema.$defs[`${method.name}.result`]);
  }
  for (const lexeme of ['1.0', '1e0', '10e-1']) {
    const id = `describe-limit-${lexeme}`;
    peer.write(rpc(id, 'describe', {limit: 0}).replace('"limit":0', `"limit":${lexeme}`));
    const page = await peer.next();
    assert.equal(page.id, id);
    assert.equal(page.result.methods.length, 1);
    assert.equal(page.result.next_cursor, '1');
  }
  peer.write(JSON.stringify(Array.from({length: 16}, (_, i) => {
    const id = `discovery-batch-${i}`;
    methodsById.set(id, 'describe');
    return {jsonrpc: '2.0', id, method: 'describe', params: {}};
  })) + '\n');
  const discoveryBatch = await peer.next();
  assert.equal(discoveryBatch.length, 16);
  discoveryBatch.forEach((reply, i) => {
    assert.equal(reply.id, `discovery-batch-${i}`);
    assert.deepEqual(reply.result, description);
  });
  peer.write('[{"jsonrpc":"2.0","method":"task.submit","params":{}},{"jsonrpc":"2.0","id":7,"method":"ping","params":{}}]\n');
  const batch = await peer.next();
  assert.equal(batch.length, 1);
  assert.equal(batch[0].id, 7);
  peer.write('[]\n' + rpc('still', 'ping'));
  assert.equal((await peer.next()).error.data.kind, 'InvalidRequest');
  assert.equal((await peer.next()).id, 'still');
  await peer.end();

  const unsupported = launch();
  unsupported.write(rpc('unknown', 'initialize', {protocol_versions: ['agent-host/99.0']}));
  assert.deepEqual((await unsupported.next()).error.data.supported_versions, ['agent-host/1.0']);
  await unsupported.end(64);
  const ambiguous = launch();
  await ambiguous.initialize();
  ambiguous.write('[{"jsonrpc":"2.0","id":1,"method":"ping","params":{}},{"jsonrpc":"2.0","id":1.0,"method":"ping","params":{}}]\n');
  assert.equal((await ambiguous.next()).error.data.kind, 'InvalidRequest');
  await ambiguous.end(64);
  const truncated = launch();
  truncated.write('{"jsonrpc":');
  await truncated.end(64);
  const oversized = launch();
  oversized.write(' '.repeat(1024 * 1024));
  assert.equal((await oversized.next()).error.data.kind, 'InvalidRequest');
  await oversized.end(64);

  const taskPeer = launch('protocol state');
  assert.equal((await taskPeer.initialize()).result.capabilities.task_execution, true);
  assert.throws(() => execFileSync(binary, ['serve', '--transport', 'stdio', '--offline', '--state-dir', 'protocol state'], options), error => error.status === 75);
  assert.throws(() => execFileSync(binary, ['status', '--offline', '--state-dir', 'protocol state'], options), error => error.status === 75);
  const submission = {client_operation_id: 'submit-once', application_id: 'native-minimal', profile_id: 'offline', input: {schema_id: 'native-minimal.input.v1', value: {value: 20}}};
  taskPeer.write(rpc('submit', 'task.submit', submission));
  const receipt = (await taskPeer.next()).result;
  assert.match(receipt.task_id, /^[a-f0-9]{32}$/);
  taskPeer.write(rpc('duplicate-submit', 'task.submit', submission));
  const duplicate = (await taskPeer.next()).result;
  assert.equal(duplicate.receipt_id, receipt.receipt_id);
  assert.equal(duplicate.task_id, receipt.task_id);
  assert.equal(duplicate.replayed, true);
  let question;
  for (let i = 0; i < 100; i++) {
    taskPeer.write(rpc(`status-${i}`, 'task.status', {task_id: receipt.task_id}));
    const status = (await taskPeer.next()).result;
    if (status.status === 'waiting_input') { question = status.question; break; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert(question, 'authored question was not exposed');
  assert.equal(question.answer_schema_id, 'native-minimal.answer.v1');
  assert.match(question.prompt.prompt, /label/);
  await taskPeer.end();
  const resumed = launch('protocol state');
  await resumed.initialize();
  resumed.write(rpc('question-after-restart', 'task.status', {task_id: receipt.task_id}));
  assert.deepEqual((await resumed.next()).result.question, question);
  const answer = {client_operation_id: 'answer-once', task_id: receipt.task_id, question_id: question.question_id, question_revision: question.question_revision, request_digest: question.request_digest, answer: {schema_id: question.answer_schema_id, value: {message: 'client answer'}}};
  resumed.write(rpc('answer', 'task.respond', answer));
  const answerReceipt = (await resumed.next()).result;
  assert.equal(answerReceipt.disposition, 'answer_acquired');
  let result;
  for (let i = 0; i < 100; i++) {
    resumed.write(rpc(`result-${i}`, 'task.result', {task_id: receipt.task_id}));
    result = (await resumed.next()).result;
    if (result.ready) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.outcome.value, {value: 41, answer: 'client answer'});
  resumed.write(rpc('answer-after-completion', 'task.respond', answer));
  assert.equal((await resumed.next()).result.receipt_id, answerReceipt.receipt_id);
  resumed.write(rpc('answer-alias', 'task.respond', {...answer, client_operation_id: 'answer-alias'}));
  assert.equal((await resumed.next()).result.receipt_id, answerReceipt.receipt_id);
  resumed.write(rpc('answer-conflict', 'task.respond', {...answer, client_operation_id: 'different-answer', answer: {...answer.answer, value: {message: 'different'}}}));
  assert.equal((await resumed.next()).error.data.kind, 'AnswerConflict');
  resumed.write(rpc('events', 'task.events', {task_id: receipt.task_id, after_seq: '0', limit: 128}));
  const events = (await resumed.next()).result;
  assert.deepEqual(events.events.map(event => event.type), ['accepted', 'input_required', 'input_accepted', 'completed']);
  assert.deepEqual(events.events.map(event => event.seq), ['1', '2', '3', '4']);
  assert.equal(events.has_more, false);
  for (const lexeme of ['1.0', '1e0', '10e-1']) {
    const id = `event-limit-${lexeme}`;
    resumed.write(rpc(id, 'task.events', {task_id: receipt.task_id, after_seq: '0', limit: 0}).replace('"limit":0', `"limit":${lexeme}`));
    const page = await resumed.next();
    assert.equal(page.id, id);
    assert.deepEqual(page.result.events, events.events.slice(0, 1));
    assert.equal(page.result.next_after_seq, '1');
    assert.equal(page.result.has_more, true);
  }
  resumed.write(rpc('subscribe', 'task.subscribe', {task_id: receipt.task_id, after_seq: '0'}));
  const subscription = (await resumed.next()).result;
  assert.equal(subscription.after_seq, '0');
  for (const expected of events.events) {
    const notification = await resumed.next();
    assert.equal(notification.method, 'task.event');
    assert.equal(notification.params.subscription_id, subscription.subscription_id);
    assert.deepEqual(notification.params.event, expected);
  }
  resumed.write(rpc('unsubscribe', 'task.unsubscribe', {subscription_id: subscription.subscription_id}));
  assert.deepEqual((await resumed.next()).result, {});
  resumed.write(rpc('future-cursor', 'task.events', {task_id: receipt.task_id, after_seq: '99'}));
  assert.equal((await resumed.next()).error.data.kind, 'InvalidParams');
  await resumed.end();
  cli('export-checkpoint', 'protocol state', '--output', 'completed.bundle');
  const completeArchiveBytes = readFileSync(join(directory, 'completed.bundle'));
  for (const [scope, bytes, kinds] of [
    ['full', completeArchiveBytes, ['accepted', 'input_accepted', 'completed']],
    ['suffix', retainedEventSuffix(completeArchiveBytes, 2n), ['input_accepted', 'completed']],
  ]) for (const kind of kinds) {
    const name = `missing-${scope}-${kind}`;
    writeFileSync(join(directory, `${name}.bundle`), omittedFactEvent(bytes, kind), {mode: 0o600});
    assert.throws(() => execFileSync(binary, ['import-checkpoint', '--offline', '--state-dir', name, '--input', `${name}.bundle`, '--operation-id', 'import-event'], options), error => error.status === 64 && JSON.parse(error.stdout).reason === 'InvalidArchive');
    assert.equal(cli('import-checkpoint', name, '--input', 'completed.bundle', '--operation-id', 'import-event').task_id, receipt.task_id);
  }
  // A later cancellation receipt does not resurrect a terminal task. Its
  // retained suffix may legitimately begin after the terminal event.
  cli('cancel', 'protocol state', '--task-id', receipt.task_id, '--operation-id', 'after-completion');
  cli('export-checkpoint', 'protocol state', '--output', 'after-completion.bundle');
  const afterCompletion = readFileSync(join(directory, 'after-completion.bundle'));
  assert.equal(readArchive(afterCompletion).task.cancellation.tag, 0);
  writeFileSync(join(directory, 'pruned-terminal.bundle'), retainedEventSuffix(afterCompletion, readArchive(completeArchiveBytes).task.event_high + 1n), {mode: 0o600});
  assert.equal(cli('import-checkpoint', 'pruned terminal', '--input', 'pruned-terminal.bundle', '--operation-id', 'import-pruned').task_id, receipt.task_id);
  assert.deepEqual(cli('result', 'pruned terminal').outcome.value, {value: 41, answer: 'client answer'});
  for (const removeOccurrence of [false, true]) {
    const name = `omitted-question-${removeOccurrence}`;
    writeFileSync(join(directory, `${name}.bundle`), omittedQuestion(readFileSync(join(directory, 'completed.bundle')), removeOccurrence), {mode: 0o600});
    assert.throws(() => execFileSync(binary, ['import-checkpoint', '--offline', '--state-dir', name, '--input', `${name}.bundle`, '--operation-id', 'import-question'], options), error => error.status === 64 && JSON.parse(error.stdout).reason === 'InvalidArchive');
    assert.equal(cli('import-checkpoint', name, '--input', 'completed.bundle', '--operation-id', 'import-question').task_id, receipt.task_id);
  }
  for (const [name, mutate] of [['operation-key', changedOperationKey], ['omitted-submission', bytes => changedOperationKey(bytes, 'omitted')], ...['null', 'extra-field', 'question-counter'].map(kind => [`event-${kind}`, bytes => invalidEventData(bytes, kind)]), ...['question_id', 'question_revision', 'request_digest', 'answer_schema_id', 'prompt'].map(field => [`retired-question-${field}`, bytes => falseEventFact(bytes, `question-${field}`)])]) {
    writeFileSync(join(directory, `${name}.bundle`), mutate(readFileSync(join(directory, 'completed.bundle'))), {mode: 0o600});
    assert.throws(() => execFileSync(binary, ['import-checkpoint', '--offline', '--state-dir', name, '--input', `${name}.bundle`, '--operation-id', 'import-consistency'], options), error => error.status === 64 && JSON.parse(error.stdout).reason === 'InvalidArchive');
    assert.equal(cli('import-checkpoint', name, '--input', 'completed.bundle', '--operation-id', 'import-consistency').task_id, receipt.task_id);
  }
  writeFileSync(join(directory, 'completed-cancel.bundle'), cancellationState(readFileSync(join(directory, 'completed.bundle')), true, 'not applied to completed task'), {mode: 0o600});
  assert.throws(() => execFileSync(binary, ['import-checkpoint', '--offline', '--state-dir', 'completed cancellation corruption', '--input', 'completed-cancel.bundle', '--operation-id', 'import-completed'], options), error => error.status === 64 && JSON.parse(error.stdout).reason === 'InvalidArchive');
  assert.equal(cli('import-checkpoint', 'completed cancellation corruption', '--input', 'completed.bundle', '--operation-id', 'import-completed').task_id, receipt.task_id);
  writeFileSync(join(directory, 'retained-completion.bundle'), retainedEventSuffix(readFileSync(join(directory, 'completed.bundle')), 2n), {mode: 0o600});
  const completedImport = cli('import-checkpoint', 'imported completion', '--input', 'retained-completion.bundle', '--operation-id', 'import-completed');
  assert.equal(completedImport.task_id, receipt.task_id);
  assert.deepEqual(cli('result', 'imported completion').outcome.value, {value: 41, answer: 'client answer'});
  const importedPeer = launch('imported completion');
  await importedPeer.initialize();
  importedPeer.write(rpc('imported-submit-replay', 'task.submit', submission));
  assert.equal((await importedPeer.next()).result.receipt_id, receipt.receipt_id);
  importedPeer.write(rpc('imported-answer-alias', 'task.respond', {...answer, client_operation_id: 'answer-alias'}));
  assert.equal((await importedPeer.next()).result.receipt_id, answerReceipt.receipt_id);
  for (const method of ['task.events', 'task.subscribe']) {
    importedPeer.write(rpc(`expired-${method}`, method, {task_id: receipt.task_id, after_seq: '0'}));
    const expired = await importedPeer.next();
    assert.deepEqual(expired.error.data, {kind: 'CursorExpired', recovery: 'read_status_or_result', earliest_available_seq: '2', high_water_seq: '5'});
    const missingRange = structuredClone(expired.error);
    delete missingRange.data.earliest_available_seq;
    schemaCases.push({definition: 'error', value: missingRange, accept: false});
  }
  importedPeer.write(rpc('imported-events', 'task.events', {task_id: receipt.task_id, after_seq: '4'}));
  assert.deepEqual((await importedPeer.next()).result.events.map(event => event.type), ['imported']);
  await importedPeer.end();

  const cancelling = launch('cancel state');
  await cancelling.initialize();
  cancelling.write(rpc('submit-cancel', 'task.submit', {...submission, client_operation_id: 'cancel-submission'}));
  const cancelTask = (await cancelling.next()).result.task_id;
  for (let i = 0; i < 100; i++) {
    cancelling.write(rpc(`wait-${i}`, 'task.status', {task_id: cancelTask}));
    if ((await cancelling.next()).result.status === 'waiting_input') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  cancelling.write(rpc('cancel', 'task.cancel', {client_operation_id: 'cancel-once', task_id: cancelTask}));
  assert.equal((await cancelling.next()).result.disposition, 'cancellation_requested');
  let cancelled;
  for (let i = 0; i < 100; i++) {
    cancelling.write(rpc(`cancelled-${i}`, 'task.result', {task_id: cancelTask}));
    cancelled = (await cancelling.next()).result;
    if (cancelled.ready) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.outcome.cleanup_complete, true);
  cancelling.write(rpc('shutdown-cancel', 'shutdown', {mode: 'cancel'}));
  assert.equal((await cancelling.next()).result.mode, 'cancel');
  await cancelling.end(0, 'cancel');
  for (const mode of ['park', 'cancel']) for (const state of [null, `shutdown-${mode}-idle`]) {
    const shutdown = launch(state, 5000);
    await shutdown.initialize();
    const stopped = once(shutdown.child, 'close');
    const batch = [
      ['invalid-mode', 'shutdown', {mode: 'invalid'}],
      ['shutdown-first', 'shutdown', {mode}],
      ['shutdown-again', 'shutdown', {mode}],
      ['shutdown-conflict', 'shutdown', {mode: mode === 'park' ? 'cancel' : 'park'}],
      ['shutdown-submit', 'task.submit', {...submission, client_operation_id: 'after-shutdown'}],
      ['shutdown-ping', 'ping', {}],
    ];
    shutdown.write(JSON.stringify(batch.map(([id, method, params]) => JSON.parse(rpc(id, method, params)))) + '\n');
    const replies = await shutdown.next();
    assert.deepEqual(replies.map(reply => reply.id), batch.map(([id]) => id));
    assert.equal(replies[0].error.data.kind, 'InvalidParams');
    for (const reply of replies.slice(1, 3)) assert.deepEqual(reply.result, {mode, accepted: true});
    for (const reply of replies.slice(3, 5)) assert.equal(reply.error.data.kind, 'StateConflict');
    assert.equal(typeof replies[5].result.server_instance_id, 'string');
    const [code, signal] = await stopped;
    assert.equal(shutdown.child.stdin.writableEnded, false, 'shutdown must not depend on stdin EOF');
    assert.equal(signal, null);
    assert.equal(code, 0);
    await shutdown.end(0, mode);
  }
  for (const mode of ['park', 'cancel']) {
    const state = `settled-${mode}`;
    const created = cli('run', state, '--input-json', '{"value":20}', '--operation-id', 'park-before-shutdown');
    // Reopening exposes the saved task without taking execution ownership.
    // Two LF frames, not one batch: shutdown settles before the second frame.
    const shutdown = launch(state, 5000);
    await shutdown.initialize();
    shutdown.write(rpc('before-settlement', 'task.status', {task_id: created.task_id}));
    const parkedTask = (await shutdown.next()).result;
    assert.equal(parkedTask.status, 'waiting_input');
    assert.equal(parkedTask.cancellation, null);
    const stopped = once(shutdown.child, 'close');
    shutdown.write(rpc('settled-shutdown', 'shutdown', {mode}) +
      rpc('late-cancel', 'task.cancel', {task_id: parkedTask.task_id, client_operation_id: 'after-settlement'}));
    const accepted = await shutdown.next();
    assert.equal(accepted.id, 'settled-shutdown');
    assert.deepEqual(accepted.result, {mode, accepted: true});
    assert.deepEqual(await stopped, [0, null]);
    assert.equal(shutdown.child.stdin.writableEnded, false, 'settled shutdown does not wait for stdin EOF');
    // end checks that the only remaining frame is server.closed, so a late
    // cancellation acknowledgment cannot be hidden behind that notification.
    const closed = await shutdown.end(0, mode);
    assert.deepEqual(closed.params.recovery_tasks, []);
    const recovered = cli('status', state, '--task-id', parkedTask.task_id);
    assert.equal(recovered.status, 'waiting_input');
    assert.equal(recovered.cancellation, null);
    assert.equal(recovered.revision, parkedTask.revision);
    assert.deepEqual(recovered.question, parkedTask.question);
  }
  for (const state of [null, 'interrupt-idle']) {
    const interrupted = launch(state, 5000);
    await interrupted.initialize();
    const stopped = once(interrupted.child, 'close');
    isolated.signal(interrupted.child, 'SIGINT');
    assert.deepEqual(await stopped, [0, null]);
    assert.equal(interrupted.child.stdin.writableEnded, false);
    await interrupted.end(0, 'cancel');
  }
  cli('export-checkpoint', 'cancel state', '--task-id', cancelTask, '--output', 'cancelled.bundle');
  const cancelledImport = cli('import-checkpoint', 'imported cancellation', '--input', 'cancelled.bundle', '--operation-id', 'import-cancelled');
  assert.equal(cancelledImport.task_id, cancelTask);
  assert.equal(cli('result', 'imported cancellation', '--task-id', cancelTask).status, 'cancelled');

  // The receiver discards the submission acknowledgment and loses the process.
  // Recovery may find READY, an acquired reply, a question, or UNKNOWN; none of
  // those states permits retransmission to create another task or auto-resume.
  const lostAck = launch('lost acknowledgment state');
  await lostAck.initialize();
  const lostSubmission = {...submission, client_operation_id: 'lost-acknowledgment'};
  lostAck.write(rpc('lost-submit', 'task.submit', lostSubmission));
  const original = (await lostAck.next()).result;
  await lostAck.crash();
  const recovered = launch('lost acknowledgment state');
  await recovered.initialize();
  recovered.write(rpc('recover-receipt', 'task.submit', lostSubmission));
  const replayed = (await recovered.next()).result;
  assert.equal(replayed.task_id, original.task_id);
  assert.equal(replayed.receipt_id, original.receipt_id);
  assert.equal(replayed.replayed, true);
  assert(['parked', 'waiting_input', 'blocked', 'unknown'].includes(replayed.status));
  await new Promise(resolve => setTimeout(resolve, 50));
  recovered.write(rpc('recover-status', 'task.status', {task_id: original.task_id}));
  const unchanged = (await recovered.next()).result;
  assert.equal(unchanged.revision, replayed.revision);
  assert.equal(unchanged.status, replayed.status);
  await recovered.end();

  for (const state of [null, 'broken output idle']) {
    const broken = launch(state, 5000);
    await broken.initialize();
    const stopped = once(broken.child, 'close');
    const readerClosed = once(broken.child.stdout, 'close');
    broken.child.stdout.destroy();
    await readerClosed;
    // Keep the existing case where another request races with output closure.
    broken.write(rpc('broken-ping', 'ping', {}));
    const [code, signal] = await stopped;
    assert.equal(broken.child.stdin.writableEnded, false);
    assert.equal(signal, null);
    assert.equal(code, 74);
    await broken.end(74);
  }
  for (const state of [null, 'closed output idle', 'closed output waiting']) {
    const broken = launch(state, 7000);
    await broken.initialize();
    let task;
    if (state === 'closed output waiting') {
      broken.write(rpc('close-submit', 'task.submit', {...submission, client_operation_id: 'close-submit'}));
      task = (await broken.next()).result.task_id;
      let status;
      for (let i = 0; i < 100; i++) {
        broken.write(rpc(`close-wait-${i}`, 'task.status', {task_id: task}));
        status = (await broken.next()).result;
        if (status.status === 'waiting_input') break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(status.status, 'waiting_input');
    }
    const stopped = once(broken.child, 'close');
    const started = performance.now();
    // The acknowledgment is drained. No subscription, further write or stdin
    // EOF may be needed to observe the closed output reader.
    broken.child.stdout.destroy();
    assert.deepEqual(await stopped, [74, null]);
    assert(performance.now() - started < 6000, 'bounded broken-output parking');
    assert.equal(broken.child.stdin.writableEnded, false);
    await broken.end(74);
    if (state) {
      const reopened = launch(state);
      await reopened.initialize();
      if (task) {
        reopened.write(rpc('closed-output-status', 'task.status', {task_id: task}));
        const saved = (await reopened.next()).result;
        assert.equal(saved.status, 'waiting_input');
        assert(saved.question, 'disconnect preserves the pending question');
      }
      await reopened.end();
    }
  }
  const stalled = spawn(binary, ['serve', '--transport', 'stdio', '--offline'], {cwd: directory, env: options.env, stdio: ['pipe', 'pipe', 'pipe']});
  const stallExit = once(stalled, 'exit');
  const stallClose = once(stalled, 'close');
  const stallStart = performance.now();
  const stallKill = setTimeout(() => stalled.kill('SIGKILL'), 12000);
  stalled.stdin.on('error', error => assert.equal(error.code, 'EPIPE'));
  stalled.stderr.resume();
  // No stdout reader: enough bounded discovery replies fill both pipe and queue.
  stalled.stdin.write(rpc('stall-init', 'initialize', {protocol_versions: ['agent-host/1.0']}));
  for (let i = 0; i < 256; i++) stalled.stdin.write(rpc(`stall-${i}`, 'describe'));
  const [stallCode, stallSignal] = await stallExit;
  const stallElapsed = performance.now() - stallStart;
  clearTimeout(stallKill);
  stalled.stdout.resume();
  stalled.stdin.destroy();
  await stallClose;
  assert.equal(stallSignal, null, 'stdout stall did not terminate within the bounded host deadline');
  assert.equal(stallCode, 74);
  assert(stallElapsed < 12000);

  // A quiet connection may wait for a person. A partially supplied frame has
  // a deadline; run both cases together against the advertised 30-second cap.
  const quiet = launch(null, 40000);
  const partial = launch(null, 40000);
  const negotiated = (await quiet.initialize()).result;
  partial.write('{');
  await Promise.all([
    (async () => {
      await new Promise(resolve => setTimeout(resolve, negotiated.limits.incomplete_frame_ms + 250));
      quiet.write(rpc('quiet-ping', 'ping'));
      assert.equal((await quiet.next()).id, 'quiet-ping');
      await quiet.end();
    })(),
    (async () => {
      assert.equal((await partial.next(negotiated.limits.incomplete_frame_ms + 3000)).error.data.kind, 'InvalidRequest');
      await partial.end(64);
    })(),
  ]);
  for (const value of ['0', '1', '9007199254740993', '18446744073709551615']) schemaCases.push({definition: 'counter', value});
  for (const value of ['00', '-1', '1.0', '18446744073709551616', '99999999999999999999', '1\n', 1]) schemaCases.push({definition: 'counter', value, accept: false});
  schemaCases.push({definition: 'task.submit.params', value: submission});
  for (const profile_id of ['fixed', 'custom-admitted-profile']) schemaCases.push({definition: 'task.submit.params', value: {...submission, profile_id}});
  for (const profile_id of ['', 'x'.repeat(129)]) schemaCases.push({definition: 'task.submit.params', value: {...submission, profile_id}, accept: false});
  schemaCases.push({definition: 'describe.result', value: {...description, profile: {id: 'fixed', sha256: '0'.repeat(64), resource_identity: '1'.repeat(64)}}});
  schemaCases.push({definition: 'task.submit.params', value: {...submission, principal: 'forged'}, accept: false});
  schemaCases.push({definition: 'task.submit.params', value: {...submission, input: {...submission.input, value: {value: 4294967296}}}, accept: false});
  schemaCases.push({definition: 'task.submit.params', value: {...submission, client_operation_id: '雪'.repeat(43)}, accept: false});
  schemaCases.push({definition: 'task.respond.params', value: answer});
  for (const [message, accept] of [['雪'.repeat(85) + 'a', true], ['雪'.repeat(86), false]]) {
    schemaCases.push({definition: 'task.respond.params', value: {...answer, answer: {...answer.answer, value: {message}}}, accept});
  }
  schemaCases.push({definition: 'task.respond.params', value: {...answer, question_revision: 1}, accept: false});
  const inputEvent = events.events.find(event => event.type === 'input_required');
  const missingPrompt = structuredClone(inputEvent);
  delete missingPrompt.data.prompt;
  schemaCases.push({definition: 'event', value: missingPrompt, accept: false});
  schemaCases.push({definition: 'event', value: {...inputEvent, data: {...inputEvent.data, unexpected: true}}, accept: false});
  schemaCases.push({definition: 'task.status.params', value: {task_id: `${demoTask}\n`}, accept: false});
  for (const [value, accept] of [['1', true], ['32768', true], ['0', false], ['32769', false]]) {
    schemaCases.push({definition: 'artifact.read.params', value: {task_id: demoTask, artifact_id: '0'.repeat(64), offset: '0', length: value}, accept});
  }
  const reference = {artifact_id: '0'.repeat(64), sha256: '0'.repeat(64), bytes: '65536', media_type: 'application/json', schema_id: result.outcome.schema_id, retention: 'state-namespace'};
  const largeResult = structuredClone(result);
  const wrongCurrentValue = structuredClone(result);
  wrongCurrentValue.outcome.value = {value: 'not an integer', answer: 'bad'};
  schemaCases.push({definition: 'task.result.result', value: wrongCurrentValue, accept: false});
  delete largeResult.outcome.value;
  largeResult.outcome.value_ref = reference;
  schemaCases.push({definition: 'task.result.result', value: largeResult});
  schemaCases.push({definition: 'task.result.result', value: {...largeResult, outcome: {...largeResult.outcome, value: result.outcome.value}}, accept: false});
  const oldArtifactShape = structuredClone(largeResult);
  delete oldArtifactShape.outcome.value_ref;
  oldArtifactShape.outcome.artifact = reference;
  schemaCases.push({definition: 'task.result.result', value: oldArtifactShape, accept: false});
  const embedded = {...reference, schema_id: 'agent-host.protocol-schema.v1', retention: 'embedded'};
  const referencedDescription = {...description, application: {application_id: applicationDescription.application_id, application_version: applicationDescription.application_version, client_mapping: applicationDescription.client_mapping, metadata_ref: {...embedded, schema_id: 'agent-native-discovery.application.v1'}}, protocol_schema_ref: embedded};
  delete referencedDescription.protocol_schema;
  schemaCases.push({definition: 'describe.result', value: referencedDescription});
  schemaCases.push({definition: 'describe.result', value: {...referencedDescription, protocol_schema: protocolSchema}, accept: false});
  process.stdout.write(execFileSync('uv', ['run', '--no-project', '--no-config', '--python', '3.12', '--with', 'jsonschema==4.23.0', fileURLToPath(new URL('./native_schema.py', import.meta.url))], {input: JSON.stringify({schema: protocolSchema, cases: schemaCases}), encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024}));
  console.log(JSON.stringify({check: 'native-build-and-discovery', result: 'passed', target: manifest.target, program: manifest.program_sha256, artifact_bytes: manifest.artifact_bytes, describe_ms: describeMilliseconds,
    demo_ms: demoMilliseconds, demo_command_maxrss_bytes: demoMaxRssBytes, memory_scope: 'OS command high-water report, including deployment controller processes; not simultaneous aggregate RSS',
    scope: 'embedded durable demo, framing, negotiation, discovery, client question, restart, stable admissions, typed result and event replay; provider/platform qualification remains open'}));
  passed = true;
} finally {
  isolated.close(passed);
}
