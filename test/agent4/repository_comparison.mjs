// Qualification-only authenticated leaf proxy and measurement profile.
// Neither profile changes the image or interprets application control.
import assert from 'node:assert/strict';
import { createServer, request, Agent } from 'node:https';
import { randomBytes } from 'node:crypto';
import { checkServerIdentity } from 'node:tls';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { certificates } from './mobility_tls_fixture.mjs';
import { PeerClient, servePeers } from '../../runtime/mobility/transport.mjs';
import { canonical, hash } from '../../runtime/mobility/protocol.mjs';
import { decodeSchema, decodeValue } from '../../runtime/values.mjs';

export function comparisonProfile(t, { topology, latencyMs = 0, bytesPerSecond = Infinity, corruptFirstProxyRequest = false,
  workload = { repositoryBytes: 64, extraReads: 0, replayPaddingBytes: 0 } }) {
  assert(['mobile', 'stationary'].includes(topology));
  assert(Number.isFinite(latencyMs) && latencyMs >= 0 && latencyMs <= 200);
  assert(bytesPerSecond === Infinity || (Number.isFinite(bytesPerSecond) && bytesPerSecond >= (128 << 10)));
  for (const [name, maximum] of [['repositoryBytes', 256 << 10], ['extraReads', 3], ['replayPaddingBytes', 16384]]) assert(Number.isInteger(workload[name]) && workload[name] >= 0 && workload[name] <= maximum);
  const pending = new Map(), closes = [], calls = {};
  let active = false, started, registrationMs, evidenceMs, modelDispatchMs, proposalMs, url, agent, before, corrupted = false;
  let traffic, kernelMethods, journalMethods, leafMethods, leafTrace, transactions, kernelLive, transfers, peak, memory, serial = 0;
  const add = (map, name, ms) => { const row = map[name] ??= { calls: 0, ms: 0 }; row.calls++; row.ms += ms; };
  const account = row => { if (!active) return; traffic.body += row.body_bytes; traffic.metadata += row.metadata_bytes;
    if (row.direction === 'send') { traffic.requests++; if (row.path.endsWith('/artifacts/image')) traffic.image += row.body_bytes; if (row.path.endsWith('/artifacts/outcome')) traffic.outcome += row.body_bytes; } };
  const pause = async (bytes, requests = 1) => { const ms = 2 * latencyMs * requests + 1000 * bytes / bytesPerSecond; if (ms > 0) await delay(ms); };
  const profile = { topology, workload: structuredClone(workload),
    begin() { active = true; started = performance.now(); registrationMs = evidenceMs = modelDispatchMs = proposalMs = null; traffic = { body: 0, metadata: 0, requests: 0, image: 0, outcome: 0 }; kernelMethods = {}; journalMethods = {}; leafMethods = {}; leafTrace = []; transactions = new Map(); kernelLive = new Map(); transfers = []; peak = memory = 0; for (const name of Object.keys(calls)) delete calls[name]; },
    registered() { registrationMs = performance.now() - started; },
    question() { proposalMs ??= performance.now() - started; },
    instrumentWorld(original) { return { ...original, Kernel: { async create(options) {
      const begin = performance.now(), kernel = await original.Kernel.create(options), id = ++serial;
      if (active) add(kernelMethods, 'create', performance.now() - begin);
      return new Proxy(kernel, { get(target, name) {
        const value = Reflect.get(target, name, target); if (typeof value !== 'function') return value;
        if (name === 'usage' || name === 'setLimits') return value.bind(target);
        return (...args) => { const begin = performance.now(); try { return value.apply(target, args); } finally {
          if (active) { add(kernelMethods, name, performance.now() - begin); const u = target.usage();
            kernelLive.set(id, Number(u.workingLive)); peak = Math.max(peak, [...kernelLive.values()].reduce((a,b)=>a+b,0)); memory = Math.max(memory, Number(u.memoryBytes)); }
        } };
      } });
    } } }; },
    journalFault(host, point) { if (!active) return; const operation = point.split('.')[0], key = host + ':' + operation;
      if (point.endsWith('.begin')) transactions.set(key, performance.now());
      if (point.endsWith('.after_commit')) add(journalMethods, key, performance.now() - transactions.get(key)); },
    leaf(binding) {
      if (binding.operation === 'agent.model.invoke.v4') { const charge = binding.charge; binding.charge = context => { if (active) modelDispatchMs ??= performance.now() - started; return charge(context); }; }
      const handle = binding.handle; binding.handle = async context => {
      const start = performance.now(); if (active) leafTrace.push(binding.operation); try { return await handle(context); } finally {
        if (active) { add(leafMethods, binding.operation, performance.now() - start); if (binding.operation === 'agent.repository.read.v1') evidenceMs ??= performance.now() - started; }
      }
    }; },
    proxy(binding, authorizeCurrent) {
      const handle = binding.handle;
      binding.handle = async context => {
        const id = randomBytes(24).toString('hex'); assert(pending.size < 8);
        const packet = canonical({ id, run: context.run.run_id, occurrence: context.occurrence.id, request: context.run.request_digest,
          operation: context.request.semanticIdentity, inputSchema: hash(context.request.payloadSchema), outputSchema: hash(context.request.resumeSchema) }, 8192);
        const header = Buffer.from(packet).toString('base64url'), payload = Uint8Array.from(context.request.payload);
        pending.set(id, { header, payload, context, handle, authorizeCurrent });
        let wire = payload;
        if (corruptFirstProxyRequest && !corrupted) { corrupted = true; wire = Buffer.from('wrong request'); }
        try {
          const start = performance.now();
          const result = await new Promise((resolve, reject) => {
            const req = request(url, { agent, method: 'POST', headers: { 'content-type': 'application/octet-stream', 'content-length': wire.length, 'x-agent-leaf': header } }, res => {
              const chunks = []; let size = 0;
              res.on('data', chunk => { size += chunk.length; if (size > 4 << 20) res.destroy(Error('ProxyReplyCapacity')); else chunks.push(chunk); });
              res.on('error', reject); res.on('end', () => {
                const bytes = Buffer.concat(chunks); account({ direction: 'receive', path: '/leaf', body_bytes: bytes.length, metadata_bytes: 0 });
                if (res.statusCode !== 200) reject(Object.assign(Error('ProxyRejected'), { detail: bytes.toString() })); else resolve(bytes);
              });
            });
            req.on('error', reject); req.end(wire);
            account({ direction: 'send', path: '/leaf', body_bytes: wire.length, metadata_bytes: Buffer.byteLength(header) });
          });
          await pause(wire.length + result.length + Buffer.byteLength(header));
          if (active) add(calls, context.request.semanticIdentity, performance.now() - start);
          return new Uint8Array(result);
        } finally { pending.delete(id); }
      };
    },
    async transport(context) {
      const tls = await certificates(context.root), servers = {};
      for (const host of ['U', 'W']) {
        const own = host === 'U' ? tls.A : tls.B, other = host === 'U' ? tls.B : tls.A;
        servers[host] = await servePeers(context.hosts[host], { ...own, ca: tls.ca, peerCertificates: new Map([[other.fingerprint256, host === 'U' ? 'W' : 'U']]) });
        closes.push(() => servers[host].close());
      }
      for (const [from, to] of [['U','W'],['W','U']]) {
        const own = from === 'U' ? tls.A : tls.B, other = to === 'U' ? tls.A : tls.B;
        const peer = new PeerClient({ url: servers[to].url, servername: 'localhost', fingerprint256: other.fingerprint256, ca: tls.ca, key: own.key, cert: own.cert, onTraffic: account });
        for (const name of ['preflight','status','deliver','withdraw','control']) {
          const original = peer[name].bind(peer);
          peer[name] = async (...args) => { const prior = active ? { ...traffic } : null;
            if (active && name === 'deliver') transfers.push({ image: args[0].image, outcome: args[0].outcome });
            const result = await original(...args);
            if (prior) await pause(traffic.body + traffic.metadata - prior.body - prior.metadata, traffic.requests - prior.requests); return result; };
        }
        context.peers[from].set(to, peer); closes.push(() => peer.close());
      }
      const server = createServer({ ...tls.B, ca: tls.ca, requestCert: true, rejectUnauthorized: true, minVersion: 'TLSv1.3' }, async (req, res) => {
        try {
          assert(req.socket.authorized && req.socket.getPeerCertificate().fingerprint256 === tls.A.fingerprint256);
          assert(req.method === 'POST' && req.url === '/leaf');
          const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; assert(size <= 4 << 20); chunks.push(chunk); }
          const bytes = Buffer.concat(chunks), header = req.headers['x-agent-leaf']; assert(typeof header === 'string' && header.length <= 8192);
          const packet = JSON.parse(Buffer.from(header, 'base64url')), admitted = pending.get(packet.id);
          assert(admitted); assert.equal(header, admitted.header); assert.equal(Buffer.compare(bytes, Buffer.from(admitted.payload)), 0); pending.delete(packet.id); admitted.authorizeCurrent(admitted.context);
          const payloadBytes = bytes, requestValue = { ...admitted.context.request, payload: payloadBytes };
          const reply = await admitted.handle({ ...admitted.context, request: requestValue, payload: decodeValue(decodeSchema(requestValue.payloadSchema), payloadBytes) });
          assert(reply instanceof Uint8Array && reply.length <= 4 << 20); res.writeHead(200, { 'content-length': reply.length }); res.end(reply);
        } catch (error) { res.writeHead(409); res.end(String(error.code ?? error.name) + ': ' + error.message); }
      });
      await new Promise(resolve => server.listen(0,'127.0.0.1',resolve)); url = `https://127.0.0.1:${server.address().port}/leaf`;
      agent = new Agent({ keepAlive: true, ca: tls.ca, key: tls.A.key, cert: tls.A.cert, servername: 'localhost',
        checkServerIdentity: (name, cert) => checkServerIdentity(name, cert) ?? (cert.fingerprint256 === tls.B.fingerprint256 ? undefined : Error('ProxyPeerMismatch')) });
      closes.push(() => { agent.destroy(); server.closeAllConnections(); return new Promise(resolve=>server.close(resolve)); });
      t.after(async () => { for (const close of closes.reverse()) await close(); });
      before = context;
    },
    result() {
      const elapsedMs = performance.now() - started; active = false;
      return structuredClone({ topology, elapsedMs, registrationMs, firstEvidenceLeafCompletionMs: evidenceMs, firstModelDispatchMs: modelDispatchMs, proposalMs, traffic, kernelMethods, journalMethods, leafMethods, leafTrace, proxyCalls: calls,
        checkpointBytes: transfers.map(row => before.world.decodeOutcome(row.outcome).state.length), outcomeBytes: transfers.map(row => row.outcome.length),
        maximumObservedWorkingLiveBytes: peak, maximumKernelMemoryBytes: memory, endingWorkingLiveBytes: [...kernelLive.values()].reduce((a,b)=>a+b,0) });
    },
    assertStationary(id) { if (topology === 'stationary') assert.equal(before.journals.W.run(id), null, 'proxy cannot create a second computation owner'); },
  };
  return profile;
}
