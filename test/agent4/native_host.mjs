// Independent process peer for the build/discovery boundary. This does not
// claim the later task/recovery/provider conformance obligations are complete.
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {mkdtempSync, copyFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {once} from 'node:events';

const source = resolve(process.argv[2]);
const directory = mkdtempSync(join(tmpdir(), 'Agent native ü '));
const binary = join(directory, 'agent-native-example');
copyFileSync(source, binary);
const options = {cwd: directory, env: {PATH: '/nonexistent'}, encoding: 'utf8', timeout: 5000, maxBuffer: 2 * 1024 * 1024};
function launch(state = null, lifetime = 15000) {
  const child = spawn(binary, ['serve', '--transport', 'stdio', '--offline', ...(state ? ['--state-dir', state] : [])], {cwd: directory, env: options.env, stdio: ['pipe', 'pipe', 'pipe']});
  const frames = [], waiters = [];
  let output = '', diagnostic = '', failure, initialized = false;
  const ended = once(child, 'close');
  child.stdin.on('error', error => { if (error.code !== 'EPIPE') failure = error; });
  child.stderr.on('data', bytes => { diagnostic += bytes; assert(diagnostic.length < 65536); });
  child.stdout.on('data', bytes => {
    output += bytes;
    assert(output.length <= 1024 * 1024);
    for (let newline; (newline = output.indexOf('\n')) >= 0;) {
      const frame = JSON.parse(output.slice(0, newline)); output = output.slice(newline + 1);
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
    async end(code = 0) {
      child.stdin.end();
      const [actual, signal] = await ended;
      clearTimeout(timer);
      assert.equal(signal, null, diagnostic);
      assert.equal(actual, code, diagnostic);
      assert.equal(output, '');
      if (initialized && (code === 0 || code === 2)) {
        assert.equal(frames.length, 1, JSON.stringify(frames));
        assert.equal(frames[0].method, 'server.closed');
        assert.equal(frames[0].params.disposition, code === 0 ? 'parked' : 'incomplete');
      } else assert.deepEqual(frames, []);
    },
    async initialize(id = 'init') {
      child.stdin.write(JSON.stringify({jsonrpc: '2.0', id, method: 'initialize', params: {protocol_versions: ['agent-host/1.0']}}) + '\n');
      const reply = await this.next();
      assert.equal(reply.id, id);
      assert.equal(reply.result.protocol_version, 'agent-host/1.0');
      initialized = true;
      return reply;
    },
  };
}
const rpc = (id, method, params = {}) => JSON.stringify({jsonrpc: '2.0', id, method, params}) + '\n';
try {
  assert.match(execFileSync(binary, ['--help'], options), /serve --transport stdio/);
  const manifest = JSON.parse(execFileSync(binary, ['describe-build'], options));
  assert.equal(manifest.format, 'agent-native-build/v1');
  assert.equal(manifest.protocol, 'agent-host/1.0');
  assert.equal(manifest.compiler.version, '0.17.0');
  assert(!JSON.stringify(manifest).includes(process.cwd()));
  assert.equal(manifest.dependencies.sqlite.version, '3.53.4');
  assert.deepEqual(manifest.licenses.map(item => item.component).sort(), ['Agent', 'World', 'Boundary', 'Zig standard library', 'SQLite', ...(manifest.target.includes('linux') ? ['musl libc'] : [])].sort());
  assert(manifest.licenses.some(item => item.component === 'SQLite' && item.text.includes('disclaims copyright')));
  const demo = JSON.parse(execFileSync(binary, ['demo', '--offline', '--state-dir', 'demo state'], options));
  assert.match(demo.task_id, /^[a-f0-9]{32}$/);
  const {task_id: demoTask, ...demoOutput} = demo;
  assert.deepEqual(demoOutput, {mode: 'offline-demo', persistence: 'durable', effects: 3, yields: 1, output: {value: 41, answer: 'offline answer'}});
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
  assert.equal(description.application.application_id, 'native-minimal');
  assert.equal(description.application.input.json.additionalProperties, false);
  assert.equal(description.methods.length, 15);
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
  await oversized.end(64);

  const taskPeer = launch('protocol state');
  assert.equal((await taskPeer.initialize()).result.capabilities.task_execution, true);
  assert.throws(() => execFileSync(binary, ['serve', '--transport', 'stdio', '--offline', '--state-dir', 'protocol state'], options), error => error.status === 75);
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
  resumed.write(rpc('answer-conflict', 'task.respond', {...answer, client_operation_id: 'different-answer', answer: {...answer.answer, value: {message: 'different'}}}));
  assert.equal((await resumed.next()).error.data.kind, 'AnswerConflict');
  resumed.write(rpc('events', 'task.events', {task_id: receipt.task_id, after_seq: '0', limit: 128}));
  const events = (await resumed.next()).result;
  assert.deepEqual(events.events.map(event => event.type), ['accepted', 'input_required', 'input_accepted', 'completed']);
  assert.deepEqual(events.events.map(event => event.seq), ['1', '2', '3', '4']);
  assert.equal(events.has_more, false);
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
  await cancelling.end();
  console.log(JSON.stringify({check: 'native-build-and-discovery', result: 'passed', target: manifest.target, program: manifest.program_sha256, scope: 'embedded durable demo, framing, negotiation, discovery, client question, restart, stable admissions, typed result and event replay; provider/platform qualification remains open'}));
} finally {
  rmSync(directory, {recursive: true, force: true});
}
