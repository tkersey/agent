// Test-only provisioning and oracle. The extracted production route never
// imports this file and receives no function, continuation or phase inventory.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { packageArtifacts } from '../../tools/agent4/package.mjs';
import { canonical, hash } from '../../runtime/mobility/protocol.mjs';
import { encodeValue } from '../../runtime/values.mjs';
import { schemas as mobilitySchemas } from '../../runtime/mobility/values.mjs';
import { READ, CLOSE } from '../../runtime/text_inspection.mjs';
import { hostFixture } from './mobility_host_fixture.mjs';
import { certificates } from './mobility_tls_fixture.mjs';

export async function packageFixture(t) {
  const f = await hostFixture(t, { register: false, cleanup: false }), tls = await certificates(f.area);
  f.stop('A'); f.stop('B');
  const input = join(f.area, 'inputs'), output = join(f.area, 'archive'), extracted = join(f.area, 'extracted');
  await mkdir(input); await mkdir(extracted);
  const rows = [];
  async function asset(path, role, bytes) { await writeFile(join(input, path), bytes); rows.push({ path, role, sha256: hash(bytes) }); }
  await asset('mobility.bpi3', 'image', f.image);
  await asset('initial.args', 'initial-args', encodeValue(f.schemas.integer, 123n));
  await asset('contract.txt', 'contract', Buffer.from('Compiled mobility fixture: typed task, immutable text inspection, typed presentation and owned cleanup.\n'));
  await asset('story.txt', 'synthetic-fixture', await readFile(join(f.area, 'story.txt')));
  for (const [name, bytes] of Object.entries(f.schemaBytes)) await asset(`${name}.bin`, 'schema', bytes);
  await asset('subject-value.bin', 'synthetic-fixture', encodeValue(f.schemas.subject, f.declared));
  await asset('task-reply.bin', 'synthetic-fixture', encodeValue(f.schemas.task, f.taskValue));
  await asset('unit-reply.bin', 'synthetic-fixture', encodeValue(f.schemas.unit, null));
  await asset('cleanup.bin', 'synthetic-fixture', encodeValue(mobilitySchemas.requirements, f.deployment.cleanup));
  await writeFile(join(input, 'inventory.json'), JSON.stringify({ format: 'agent4-use-inventory/v1', examples: [{ name: 'mobility', image: 'mobility.bpi3', initialArgs: 'initial.args' }], files: rows }));
  const version = (await readFile('build.zig.zon', 'utf8')).match(/\.version\s*=\s*"([^"]+)"/)[1];
  const receipt = packageArtifacts(['--images-dir', input, '--output-dir', output, '--version', version, '--world-runtime', resolve(process.env.AGENT_MOBILITY_RUNTIME)]);
  execFileSync('tar', ['-xzf', join(output, receipt.archive.name), '-C', extracted]);
  const root = join(extracted, receipt.archive.name.slice(0, -7));
  // Optional conformance oracles are absent during actual execution.
  await rm(join(root, 'test'), { recursive: true, force: true });
  for (const row of receipt.files) assert.ok(!/\.(zig|wasm)$/.test(row.path), `unexpected authoring/kernel input: ${row.path}`);
  assert.ok(!(await readdir(root)).includes('src'));
  const examples = join(root, 'examples'), secrets = join(f.area, 'secrets'); await mkdir(secrets, { mode: 0o700 });
  for (const [name, pair] of Object.entries(f.pairs)) {
    await writeFile(join(secrets, `${name}.public.pem`), pair.publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o600 });
    await writeFile(join(secrets, `${name}.private.pem`), pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  }
  const configs = {};
  for (const host of ['A', 'B']) {
    const peer = host === 'A' ? 'B' : 'A';
    configs[host] = {
      format: 'agent-mobility-deployment/v1', hostId: host, trustDomain: 'fixture', revision: 'p1', worldRuntime: resolve(process.env.AGENT_MOBILITY_RUNTIME),
      directory: join(f.area, `deployed-${host}`), deploymentGeneration: 'generation-1', execution: host === 'A' ? 'browser' : 'node',
      keys: Object.keys(f.pairs).map(owner => ({ keyId: owner, owner, status: 'active', publicKey: join(secrets, `${owner}.public.pem`) })),
      signer: { keyId: host, privateKey: join(secrets, `${host}.private.pem`), policyRevision: 'p1' },
      deployments: [{ ...f.deployment, cleanup: join(examples, 'cleanup.bin') }],
      labelDestinations: { shared: ['A', 'B'], 'server-only': ['B'], 'origin-only': ['A'] }, revoked: [],
      peers: [{ hostId: peer, url: 'https://127.0.0.1:1', servername: 'localhost', fingerprint256: tls[peer].fingerprint256 }],
      tls: { key: join(f.area, 'tls', `${host}.key`), cert: join(f.area, 'tls', `${host}.pem`), ca: join(f.area, 'tls', 'ca.pem'), host: '127.0.0.1', port: 0 },
      bindings: f.bindings[host].map(binding => {
        const { authorize, handle, id, payloadSchema, resultSchema, ...metadata } = binding;
        const nameFor = bytes => Object.entries(f.schemaBytes).find(([, value]) => hash(bytes) === hash(value))[0];
        let adapter;
        if ([READ, CLOSE].includes(binding.operation)) adapter = { kind: binding.operation === READ ? 'text-file' : 'text-close', subject: join(examples, 'subject-value.bin'),
          ...(binding.operation === READ ? { root: examples, path: 'story.txt' } : {}) };
        else {
          const payload = binding.operation.endsWith('.task.v1') ? 123n : binding.operation.endsWith('.child-resumed.v1') ? 77n : binding.operation.endsWith('.child-cleanup.v1') ? 9001n : { tag: 0, value: [42n, 4n] };
          adapter = { kind: 'fixed-reply', payloadDigest: hash(encodeValue(f.schemas[nameFor(payloadSchema)], payload)), reply: join(examples, binding.operation.endsWith('.task.v1') ? 'task-reply.bin' : 'unit-reply.bin') };
        }
        return { ...metadata, payloadSchema: join(examples, `${nameFor(payloadSchema)}.bin`), resultSchema: join(examples, `${nameFor(resultSchema)}.bin`), adapter };
      }),
    };
  }
  const configPaths = Object.fromEntries(['A', 'B'].map(host => [host, join(f.area, `${host}.json`)]));
  const writeConfig = host => writeFile(configPaths[host], canonical(configs[host]), { mode: 0o600 });
  await writeConfig('A');
  const { openDeployment } = await import(pathToFileURL(join(root, 'runtime/mobility/deployment.mjs')));
  const { PeerClient } = await import(pathToFileURL(join(root, 'runtime/mobility/transport.mjs')));
  const { serveBrowser } = await import(pathToFileURL(join(root, 'runtime/mobility/browser.mjs')));
  const a = await openDeployment(configPaths.A, { create: true });
  const service = await a.serve(); configs.B.peers[0].url = service.url; await writeConfig('B');
  const cli = join(root, 'runtime/mobility/cli.mjs');
  execFileSync(process.execPath, [cli, 'init', configPaths.B], { cwd: root, env: { ...process.env, PATH: '/nonexistent' } });
  let child = null, exit = null, outputText = '', errorText = '', statistics = null;
  async function startB() {
    outputText = ''; errorText = '';
    child = spawn(process.execPath, [cli, 'serve', configPaths.B], { cwd: root, env: { ...process.env, PATH: '/nonexistent' }, stdio: ['ignore', 'pipe', 'pipe'] });
    exit = once(child, 'exit');
    const url = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`host startup timeout: ${errorText}`)), 20000);
      child.once('exit', () => { clearTimeout(timeout); reject(new Error(`host startup failed: ${errorText}`)); });
      child.stderr.on('data', bytes => { errorText += bytes; });
      child.stdout.on('data', bytes => {
        outputText += bytes;
        for (const line of outputText.trim().split('\n')) { try { const row = JSON.parse(line); if (row.listening) { clearTimeout(timeout); resolve(row.listening); } } catch {} }
      });
    });
    a.peers.get('B').close();
    a.peers.set('B', new PeerClient({ url, servername: 'localhost', fingerprint256: tls.B.fingerprint256, ca: tls.ca, key: tls.A.key, cert: tls.A.cert }));
    return child.pid;
  }
  async function stopB() {
    if (!child) return;
    const pid = child.pid; child.kill('SIGTERM');
    const [code, signal] = await exit; child = null;
    assert.equal(code, 0, errorText); assert.equal(signal, null); assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    statistics = JSON.parse(outputText.trim().split('\n').at(-1)).statistics;
  }
  t.after(async () => { await stopB(); a.peers.get('B').close(); await a.close(); await f.dispose(); });
  const pid = await startB();
  await a.custodian.registerRun(f.registration, await readFile(join(examples, 'mobility.bpi3')), await readFile(join(examples, 'initial.args')));
  return { ...f, hosts: { A: a.custodian }, journals: { A: a.journal }, tls, serveBrowser, deploymentA: a, root, receipt, pid, stopB, startB,
    archiveContents: gunzipSync(await readFile(join(output, receipt.archive.name))), processLogs: () => ({ stdout: outputText, stderr: errorText }),
    dataStatistics: () => statistics,
    async waitForReturn() {
      for (let i = 0; i < 200; i++) { const run = a.custodian.status(f.id); if (run.custody === 'ACTIVE' && run.epoch === '2') return; await new Promise(resolve => setTimeout(resolve, 50)); }
      assert.fail(`data host failed to return: ${errorText}`);
    },
    statusB() { return JSON.parse(execFileSync(process.execPath, [cli, 'status', configPaths.B, f.id], { cwd: root, encoding: 'utf8' })); },
  };
}
