// Isolated, matched qualification workloads. No production credentials or load.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cpus, platform, release, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import { hostFixture } from './mobility_host_fixture.mjs';
import { certificates } from './mobility_tls_fixture.mjs';
import { PeerClient, servePeers } from '../../runtime/mobility/transport.mjs';
import { encodeValue, decodeValue, decodeSchema } from '../../runtime/values.mjs';
import { parse, signRecord, runId, hash } from '../../runtime/mobility/protocol.mjs';
import { observationValue } from '../../runtime/mobility/values.mjs';

const expected = [123n, 9001n, { tag: 0, value: [42n, 4n] }, 91n];
function probe() {
  let active = false, serial = 0, live = new Map(), peak = 0, maxLive = 0, memory = 0, methods = {}, journals = {}, commits = 0, traffic = { body: 0, metadata: 0, image: 0, outcome: 0 }, beforeCommit = new Map(), transaction = new Map();
  const add = (target, name, value) => { (target[name] ??= { calls: 0, ms: 0 }).calls++; target[name].ms += value; };
  function usage(id, kernel) {
    if (!active) return;
    const value = kernel.usage(), prior = [...live].filter(([key]) => key !== id).reduce((sum, [, bytes]) => sum + bytes, 0);
    live.set(id, Number(value.workingLive)); maxLive = Math.max(maxLive, prior + Number(value.workingLive)); peak = Math.max(peak, prior + Number(value.workingPeak)); memory = Math.max(memory, Number(value.memoryBytes));
  }
  return {
    start() { active = true; live = new Map(); peak = maxLive = memory = commits = 0; methods = {}; journals = {}; traffic = { body: 0, metadata: 0, image: 0, outcome: 0 }; beforeCommit.clear(); transaction.clear(); },
    stop() { active = false; },
    get active() { return active; },
    instrumentWorld(world) { return { ...world, Kernel: { async create(options) {
      const begin = performance.now(), kernel = await world.Kernel.create(options), id = ++serial;
      if (active) { add(methods, 'create', performance.now() - begin); usage(id, kernel); }
      return new Proxy(kernel, { get(target, name) {
        const value = target[name]; if (typeof value !== 'function') return value;
        if (name === 'usage' || name === 'setLimits') return value.bind(target);
        return (...args) => { const start = performance.now(); try { return value.apply(target, args); } finally { if (active) { add(methods, name, performance.now() - start); usage(id, target); } } };
      } });
    } } }; },
    journalFault(host, point) {
      if (!active) return; const key = `${host}:${point.split('.')[0]}`, now = performance.now();
      if (point.endsWith('.begin')) transaction.set(key, now);
      if (point.endsWith('.before_commit')) beforeCommit.set(key, now);
      if (point.endsWith('.after_commit')) { commits++; add(journals, 'commit', now - beforeCommit.get(key)); add(journals, point.split('.')[0], now - transaction.get(key)); }
    },
    onTraffic(row) {
      if (!active) return; traffic.body += row.body_bytes; traffic.metadata += row.metadata_bytes;
      if (row.direction === 'send' && row.path.endsWith('/artifacts/image')) traffic.image += row.body_bytes;
      if (row.direction === 'send' && row.path.endsWith('/artifacts/outcome')) traffic.outcome += row.body_bytes;
    },
    result() { return { working_live_end_bytes: [...live.values()].reduce((sum, value) => sum + value, 0), working_live_max_bytes: maxLive, working_peak_bytes: peak, kernel_memory_max_bytes: memory, kernel_methods: methods, journal_operations: journals, journal_commits: commits, protocol_bytes: traffic }; },
  };
}

async function sample(mode, cache, requirements) {
  const p = probe(), cleanup = [], t = { after: fn => cleanup.push(fn) };
  const f = await hostFixture(t, { register: false, cleanup: false, localData: mode === 'stationary', imageMode: mode === 'fixed' ? 'fixed' : 'ensure', explicitDestination: true, requirementCount: requirements, instrumentWorld: p.instrumentWorld, journalFault: p.journalFault });
  const clients = [], services = [], transferred = [], spans = {}; let firstRead = null, started = 0;
  for (const host of ['A', 'B']) {
    if (process.env.AGENT_MOBILITY_PROFILE_POLICY === '1') for (const name of ['preflight', 'dispatch']) {
      const original = f.policies[host][name].bind(f.policies[host]);
      f.policies[host][name] = (...args) => { const begin = performance.now(); try { return original(...args); } finally { if (p.active) spans[`policy.${name}`] = (spans[`policy.${name}`] ?? 0) + performance.now() - begin; } };
    }
    for (const binding of f.bindings[host]) if (binding.operation === 'agent.text.read-chunk.v1') {
      const handle = binding.handle; binding.handle = async args => { if (p.active && firstRead === null) firstRead = performance.now() - started; return handle(args); };
    }
    for (const name of ['parked', 'stored', 'resume', 'start']) {
      const original = f.admissions[host][name].bind(f.admissions[host]);
      f.admissions[host][name] = async (...args) => { const begin = performance.now(); try { return await original(...args); } finally { if (p.active) spans[name] = (spans[name] ?? 0) + performance.now() - begin; } };
    }
  }
  if (mode !== 'manual') {
    const tls = await certificates(f.area), servers = {};
    for (const host of ['A', 'B']) { const other = host === 'A' ? 'B' : 'A'; servers[host] = await servePeers(f.hosts[host], { ...tls[host], ca: tls.ca, peerCertificates: new Map([[tls[other].fingerprint256, other]]) }); services.push(servers[host]); }
    for (const [from, to] of [['A', 'B'], ['B', 'A']]) {
      const peer = new PeerClient({ url: servers[to].url, servername: 'localhost', fingerprint256: tls[to].fingerprint256, ca: tls.ca, key: tls[from].key, cert: tls[from].cert, onTraffic: p.onTraffic });
      const deliver = peer.deliver.bind(peer);
      peer.deliver = envelope => { if (p.active) transferred.push({ image: envelope.image, outcome: envelope.outcome }); return deliver(envelope); };
      clients.push(peer); f.peerMaps[from].set(to, peer);
    }
  }
  const base = parse(f.registration), kernelBytes = await readFile(f.identity.kernelPath), cacheHosts = new Set(['A']);
  async function durable() {
    const { signature: _, ...record } = base, id = runId('issuer'), registration = signRecord('run', { ...record, run_id: id }, f.pairs.issuer.privateKey);
    await f.hosts.A.registerRun(registration, f.image, encodeValue(f.schemas.integer, 123n));
    let host = 'A', moves = 0;
    for (let i = 0; i < 4; i++) {
      const result = await f.hosts[host].run(id);
      if (result.kind === 'terminal') {
        const run = f.journals[host].run(id), output = f.world.decodeOutcome(f.journals[host].artifact('tenant', run.outcome_digest));
        assert.deepEqual(decodeValue(f.schemas.report, output.value), expected); assert.equal(moves, mode === 'stationary' ? 0 : 2); return;
      }
      assert.equal(result.kind, 'offered');
      const target = parse(f.journals[host].transfer(result.transfer_id).offer).destination_host_id;
      assert.equal((await f.hosts[host].retryTransfer(result.transfer_id)).kind, 'accepted'); host = target; moves++;
    }
    assert.fail('bounded benchmark did not complete');
  }
  async function manual() {
    let kernel = await f.world.Kernel.create({ bytes: kernelBytes, expectedSha256: f.identity.kernelSha256 }); kernel.setLimits({ input: 8 << 20, working: 64 << 20, output: 8 << 20 });
    let prepared = kernel.prepare(f.image), session = kernel.start(prepared, encodeValue(f.schemas.integer, 123n)), output = kernel.drive(session, { checkpoint: true }), host = 'A', moves = 0;
    for (let i = 0; i < 32; i++) {
      const decoded = f.world.decodeOutcome(output);
      if (decoded.kind === 'completed') { assert.deepEqual(decodeValue(f.schemas.report, decoded.value), expected); assert.equal(moves, 2); kernel.close(session); kernel.releasePrepared(prepared); return; }
      const request = await f.world.decodeRequest(decoded.request), payload = decodeValue(decodeSchema(request.payloadSchema), request.payload);
      let reply;
      if (request.semanticIdentity === 'agent.mobility.resolve.v1') {
        const target = payload[1][1].value, observation = f.policies[target].preflight(base, payload[0], payload[1], ['shared']);
        reply = encodeValue(decodeSchema(request.resumeSchema), { tag: 1, value: [[observationValue(observation), 'fixture', { tag: 1, value: 1n }, { tag: 1, value: 1n }, { tag: 1, value: 1n }, 'p1']] });
      } else if (request.semanticIdentity === 'agent.mobility.relocate.v1') {
        const target = payload[0], observation = f.policies[target].preflight(base, payload[1], [[], { tag: 1, value: target }, { tag: 0, value: null }, 8388608n], ['shared']);
        if (p.active) {
          transferred.push({ image: f.image, outcome: output });
          p.onTraffic({ direction: 'send', path: '/artifacts/outcome', body_bytes: output.length, metadata_bytes: 0 });
          if (!cacheHosts.has(target)) p.onTraffic({ direction: 'send', path: '/artifacts/image', body_bytes: f.image.length, metadata_bytes: 0 });
        }
        cacheHosts.add(target); assert.deepEqual(kernel.checkpoint(session, { transfer: true }), decoded.state); kernel.releasePrepared(prepared);
        kernel = await f.world.Kernel.create({ bytes: kernelBytes, expectedSha256: f.identity.kernelSha256 }); kernel.setLimits({ input: 8 << 20, working: 64 << 20, output: 8 << 20 });
        prepared = kernel.prepare(f.image); session = kernel.restore(prepared, decoded.state); host = target; moves++;
        reply = encodeValue(decodeSchema(request.resumeSchema), { tag: 0, value: [host, BigInt(moves), `manual-${moves}`, Array(32).fill(0), observationValue(observation)] });
      } else {
        const selected = f.policies[host].dispatch({ ...base, classification: ['shared'] }, request);
        reply = await selected.binding.handle({ payload: selected.payload, request });
      }
      output = kernel.drive(session, { control: 'reply', value: await f.world.encodeResult(decoded.request, reply), checkpoint: true });
    }
    assert.fail('manual workload did not complete');
  }
  const execute = mode === 'manual' ? manual : durable;
  try {
    if (cache === 'warm') await execute();
    const prior = f.file.counts(); p.start(); started = performance.now(); await execute();
    const elapsed = performance.now() - started; p.stop();
    assert.deepEqual(f.file.counts().reads.slice(prior.reads.length), [0n, 16n, 32n]); assert.equal(f.file.counts().releases - prior.releases, 1);
    const measured = p.result(), encoding = [], recovery = [];
    assert.equal(measured.working_live_end_bytes, 0); assert.ok(measured.working_peak_bytes <= 1 << 20, 'fixture working-memory regression');
    assert.ok(measured.kernel_methods.create.calls <= (mode === 'manual' ? 3 : mode === 'stationary' ? 1 : 9), 'resident reconstruction regression');
    for (const item of transferred) {
      const decoded = f.world.decodeOutcome(item.outcome), kernel = await f.world.Kernel.create({ bytes: kernelBytes, expectedSha256: f.identity.kernelSha256 });
      kernel.setLimits({ input: 8 << 20, working: 64 << 20, output: 8 << 20 }); const prepared = kernel.prepare(item.image);
      let begin = performance.now(); const session = kernel.restore(prepared, decoded.state); recovery.push(performance.now() - begin);
      begin = performance.now(); const encoded = kernel.checkpoint(session); encoding.push(performance.now() - begin); assert.deepEqual(encoded, decoded.state);
      kernel.checkpoint(session, { transfer: true }); kernel.releasePrepared(prepared);
    }
    if (mode === 'stationary') assert.equal(measured.protocol_bytes.body + measured.protocol_bytes.metadata, 0);
    if (cache === 'warm') assert.equal(measured.protocol_bytes.image, 0);
    return { mode, cache, requirements, image_bytes: f.image.length, image_sha256: hash(f.image), initial_args_sha256: hash(encodeValue(f.schemas.integer, 123n)), task_reply_sha256: hash(encodeValue(f.schemas.task, f.taskValue)),
      kernel_sha256: f.identity.kernelSha256, runtime_inventory_sha256: f.identity.inventorySha256,
      total_ms: elapsed, first_read_dispatch_ms: firstRead, checkpoint_bytes: transferred.map(item => f.world.decodeOutcome(item.outcome).state.length), outcome_bytes: transferred.map(item => item.outcome.length),
      encode_probe_ms: encoding, recovery_restore_probe_ms: recovery, admission_spans_ms: spans, ...measured };
  } finally { clients.forEach(client => client.close()); await Promise.all(services.map(server => server.close())); await f.dispose(); }
}

if (process.argv[2] === '--sample') console.log(JSON.stringify(await sample(process.argv[3], process.argv[4], Number(process.argv[5]))));
else {
  const output = process.argv[2]; assert.ok(output, 'usage: mobility_measure.mjs OUTPUT.json [SAMPLES]');
  const samples = Number(process.argv[3] ?? 10); assert.ok(Number.isInteger(samples) && samples >= 3 && samples <= 30);
  const rows = [], modes = ['manual', 'fixed', 'ensure', 'stationary'];
  for (let iteration = 0; iteration < samples; iteration++) for (const requirements of [1, 16]) for (const cache of ['cold', 'warm']) for (let j = 0; j < modes.length; j++) {
    const mode = modes[(j + iteration) % modes.length];
    const child = spawnSync(process.execPath, [import.meta.filename, '--sample', mode, cache, String(requirements)], { encoding: 'utf8', maxBuffer: 4 << 20, timeout: 60000 });
    assert.equal(child.status, 0, child.stderr); rows.push({ iteration, ...JSON.parse(child.stdout) });
    console.error(`measured ${iteration + 1}/${samples} ${mode}/${cache}/requirements=${requirements}`);
  }
  const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)];
  const summary = [];
  for (const mode of modes) for (const cache of ['cold', 'warm']) for (const requirements of [1, 16]) {
    const selected = rows.filter(row => row.mode === mode && row.cache === cache && row.requirements === requirements), values = selected.map(row => row.total_ms);
    summary.push({ mode, cache, requirements, samples: selected.length, total_ms: { min: Math.min(...values), median: percentile(values, .5), p95_observed: percentile(values, .95), max: Math.max(...values) },
      first_read_ms_median: percentile(selected.map(row => row.first_read_dispatch_ms), .5), working_peak_bytes_max: Math.max(...selected.map(row => row.working_peak_bytes)),
      image_bytes: selected[0].image_bytes, checkpoint_bytes_max: Math.max(0, ...selected.flatMap(row => row.checkpoint_bytes)), protocol_bytes_median: percentile(selected.map(row => row.protocol_bytes.body + row.protocol_bytes.metadata), .5),
      journal_commits: selected[0].journal_commits });
  }
  const git = args => spawnSync('git', args, { encoding: 'utf8' }).stdout.trim();
  await writeFile(resolve(output), JSON.stringify({ format: 'agent-mobility-measurements/v1', source: { head: git(['rev-parse', 'HEAD']), dirty: git(['status', '--porcelain']).length > 0 },
    environment: { node: process.version, platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model, runtime: process.env.AGENT_MOBILITY_RUNTIME },
    limits: '8 MiB input/output/artifact; 64 MiB working; one run at a time; local SQLite EXTRA and loopback mTLS',
    method: 'Fresh Node process per sample; warm includes an unmeasured identical run. TLS/key/journal provisioning excluded; World startup included. Manual has no durability or network protocol. Protocol byte counts exclude HTTP framing and TLS overhead. Working peaks sampled after every public Kernel call before reset/teardown. Restore/encode probes are separate from end-to-end time. Observed p95 is descriptive, not a service-tail estimate.',
    summary, rows }, null, 2) + '\n');
}
