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
function launch() {
  const child = spawn(binary, ['serve', '--transport', 'stdio', '--offline'], {cwd: directory, env: options.env, stdio: ['pipe', 'pipe', 'pipe']});
  const frames = [], waiters = [];
  let output = '', diagnostic = '', failure;
  const ended = once(child, 'exit');
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
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
  return {
    child,
    write: bytes => child.stdin.write(bytes),
    async next() {
      if (failure) throw failure;
      if (frames.length) return frames.shift();
      return Promise.race([new Promise(resolve => waiters.push(resolve)), new Promise((_, reject) => { const timeout = setTimeout(() => reject(new Error('native response timeout')), 5000); timeout.unref(); })]);
    },
    async end(code = 0) {
      child.stdin.end();
      const [actual, signal] = await ended;
      clearTimeout(timer);
      assert.equal(signal, null, diagnostic);
      assert.equal(actual, code, diagnostic);
      assert.equal(output, '');
      assert.deepEqual(frames, []);
    },
    async initialize(id = 'init') {
      child.stdin.write(JSON.stringify({jsonrpc: '2.0', id, method: 'initialize', params: {protocol_versions: ['agent-host/1.0']}}) + '\n');
      const reply = await this.next();
      assert.equal(reply.id, id);
      assert.equal(reply.result.protocol_version, 'agent-host/1.0');
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
  assert.equal(manifest.licenses.length, 4);
  const demo = JSON.parse(execFileSync(binary, ['demo', '--offline'], options));
  assert.deepEqual(demo, {mode: 'offline-demo', persistence: 'none', effects: 3, yields: 1, output: {value: 41, answer: 'offline answer'}});

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
  console.log(JSON.stringify({check: 'native-build-and-discovery', result: 'passed', target: manifest.target, program: manifest.program_sha256, scope: 'embedded authored demo, framing, negotiation, discovery; durable tasks not yet qualified'}));
} finally {
  rmSync(directory, {recursive: true, force: true});
}
