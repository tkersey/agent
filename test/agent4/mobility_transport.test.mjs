import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:https';
import { parse, canonical, hash } from '../../runtime/mobility/protocol.mjs';
import { PeerClient, servePeers } from '../../runtime/mobility/transport.mjs';
import { decodeValue } from '../../runtime/values.mjs';
import { canonicalRequirements } from '../../runtime/mobility/admission.mjs';
import { hostFixture } from './mobility_host_fixture.mjs';
import { certificates } from './mobility_tls_fixture.mjs';

async function network(t, options = {}) {
  const fixture = await hostFixture(t, options), tls = await certificates(fixture.area), servers = {}, clients = {}, uploads = { A: [], B: [] };
  let dropped = false;
  for (const host of ['A', 'B']) {
    const other = host === 'A' ? 'B' : 'A';
    servers[host] = await servePeers(fixture.hosts[host], { ...tls[host], ca: tls.ca, peerCertificates: new Map([[tls[other].fingerprint256, other], [tls.C.fingerprint256, 'C']]),
      fault(point, event) {
        if (point === 'stage.before_body') uploads[host].push(event.kind);
        if (options.dropStage === event.kind && host === 'B' && point === (options.dropWhen === 'before' ? 'stage.before_body' : 'stage.after_commit') && !dropped) {
          dropped = true; event.response.destroy(); throw new Error('injected artifact disconnect');
        }
        if (options.dropReceipt && host === 'B' && point === 'decision.after_commit' && !dropped) { dropped = true; event.response.destroy(); }
        if (options.badReply && host === 'B' && point === 'decision.after_commit' && !dropped) {
          dropped = true;
          const saved = parse(fixture.journals.B.transfer(event.id).receipt);
          let status = 200, body;
          if (options.badReply === 'http202') { status = 202; body = canonical({ accepted: true }); }
          else if (options.badReply === 'http503') { status = 503; body = canonical({ error: 'Unavailable' }); }
          else if (options.badReply === 'redirect') { status = 307; body = canonical({}); }
          else if (options.badReply === 'malformedJSON') body = Buffer.from('{');
          else {
            const changed = options.badReply === 'unknownField' ? { ...saved, unknown: true } : { ...saved, signature: (saved.signature[0] === 'A' ? 'B' : 'A') + saved.signature.slice(1) };
            body = canonical({ state: 'terminal', receipt: Buffer.from(canonical(changed)).toString('base64url') });
          }
          event.response.writeHead(status, { 'content-type': 'application/json', 'content-length': body.length, ...(status === 307 ? { location: 'https://unconfigured.invalid' } : {}) });
          event.response.end(body);
        }
      } });
  }
  for (const [from, to] of [['A', 'B'], ['B', 'A']]) {
    clients[from] = new PeerClient({ url: servers[to].url, servername: 'localhost', fingerprint256: tls[to].fingerprint256, ca: tls.ca, key: tls[from].key, cert: tls[from].cert });
    fixture.peerMaps[from].set(to, clients[from]);
  }
  t.after(async () => { for (const client of Object.values(clients)) client.close(); await Promise.all(Object.values(servers).map(server => server.close())); });
  return { ...fixture, tls, servers, clients, uploads };
}
function raw(url, tls, { method = 'POST', body = new Uint8Array(), headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, ...tls, servername: 'localhost', agent: false, headers: { 'content-type': 'application/json', 'content-length': body.length, ...headers } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.end(body);
  });
}

test('mutually authenticated peers stage exact bytes and complete two-hop custody with warm image reuse', async t => {
  const f = await network(t);
  const out = await f.hosts.A.run(f.id); assert.equal((await f.hosts.A.retryTransfer(out.transfer_id)).kind, 'accepted');
  assert.deepEqual(f.uploads.B, ['image', 'outcome']);
  const back = await f.hosts.B.run(f.id); assert.equal((await f.hosts.B.retryTransfer(back.transfer_id)).kind, 'accepted');
  assert.deepEqual(f.uploads.A, ['outcome']);
  assert.equal((await f.hosts.A.run(f.id)).kind, 'terminal');
  assert.deepEqual(decodeValue(f.schemas.report, f.result('A').value), [123n, 9001n, { tag: 0, value: [42n, 4n] }, 91n]);
  const original = f.journals.A.transfer(out.transfer_id).offer;
  const receipt = await f.clients.A.status(original); assert.equal(parse(receipt).decision, 'accepted');
  assert.deepEqual(await f.clients.A.decide(original), receipt);
});

test('lost TLS response after durable acceptance leaves source frozen until exact status reconciliation', async t => {
  const f = await network(t, { dropReceipt: true });
  const out = await f.hosts.A.run(f.id);
  assert.equal((await f.hosts.A.retryTransfer(out.transfer_id)).kind, 'unknown');
  assert.equal(f.hosts.A.status(f.id).custody, 'OFFERED'); assert.equal(f.hosts.B.status(f.id).custody, 'ACTIVE');
  const back = await f.hosts.B.run(f.id); assert.equal(back.kind, 'offered'); // Target does not await source acknowledgment.
  assert.equal((await f.hosts.A.retryTransfer(out.transfer_id)).kind, 'accepted');
  assert.equal((await f.hosts.B.retryTransfer(back.transfer_id)).kind, 'accepted');
  assert.equal((await f.hosts.A.run(f.id)).kind, 'terminal');
});

test('withdrawal over mTLS wins before a delayed offer and preserves its tombstone through staging retries', async t => {
  const f = await network(t), out = await f.hosts.A.run(f.id), saved = f.journals.A.transfer(out.transfer_id);
  assert.equal(await f.clients.A.status(saved.offer), null); assert.equal(f.hosts.A.status(f.id).custody, 'OFFERED');
  const receipt = await f.clients.A.withdraw({ offer: saved.offer, registration: f.registration });
  assert.equal(parse(receipt).decision, 'refused'); assert.deepEqual(await f.clients.A.decide(saved.offer), receipt);
  f.journals.A.receiveDecision(saved.offer, receipt);
  assert.equal((await f.hosts.A.run(f.id)).kind, 'terminal'); assert.equal(f.counters.A.cleanup, 1);
  assert.equal(f.journals.B.run(f.id), null); assert.deepEqual(f.uploads.B, []);
});

test('TLS identity, certificate pin, body bounds and unsolicited encoding reject before state admission', async t => {
  const f = await network(t);
  const noCertificate = new PeerClient({ url: f.servers.B.url, servername: 'localhost', fingerprint256: f.tls.B.fingerprint256, ca: f.tls.ca });
  const wrongPin = new PeerClient({ url: f.servers.B.url, servername: 'localhost', fingerprint256: f.tls.A.fingerprint256, ca: f.tls.ca, key: f.tls.A.key, cert: f.tls.A.cert });
  t.after(() => { noCertificate.close(); wrongPin.close(); });
  const out = await f.hosts.A.run(f.id), offer = f.journals.A.transfer(out.transfer_id).offer;
  await assert.rejects(noCertificate.status(offer)); await assert.rejects(wrongPin.status(offer));
  const auth = { ca: f.tls.ca, key: f.tls.A.key, cert: f.tls.A.cert };
  const oversized = await raw(`${f.servers.B.url}/v1/mobility/preflight`, auth, { body: new Uint8Array(65537) }); assert.equal(oversized.status, 413);
  const compressed = await raw(`${f.servers.B.url}/v1/mobility/preflight`, auth, { body: canonical({}), headers: { 'content-encoding': 'gzip' } }); assert.equal(compressed.status, 400);
  assert.equal(f.journals.B.run(f.id), null); assert.equal(f.hosts.A.status(f.id).custody, 'OFFERED'); assert.deepEqual(f.uploads.B, []);
  assert.throws(() => new PeerClient({ url: 'http://localhost:80', fingerprint256: f.tls.A.fingerprint256 }), { code: 'PeerEndpointRejected' });
});

test('server-only classification prevents network upload even with an explicit public policy request', async t => {
  const f = await network(t, { privateData: true });
  const out = await f.hosts.A.run(f.id); await f.hosts.A.retryTransfer(out.transfer_id);
  assert.equal((await f.hosts.B.run(f.id)).kind, 'terminal');
  assert.deepEqual(f.uploads.A, []); assert.equal(f.counters.A.present, 0); assert.equal(f.counters.B.cleanup, 1);
});

test('staging is inert and collection retains pending/accepted recovery inputs and terminal receipts', async t => {
  const f = await network(t), out = await f.hosts.A.run(f.id), envelope = await f.hosts.A.transferEnvelope(out.transfer_id);
  const token = await f.admissions.A.parked(envelope.image, envelope.outcome);
  envelope.requirements = canonicalRequirements(f.admissions.A.read(token).relocation.requirements);
  envelope.constraints = Buffer.from(f.journals.A.run(f.id).placement_evidence.constraints, 'base64url');
  await f.clients.A.stage(envelope, 'image', envelope.image); await f.clients.A.stage(envelope, 'outcome', envelope.outcome);
  const otherPeer = new PeerClient({ url: f.servers.B.url, servername: 'localhost', fingerprint256: f.tls.B.fingerprint256, ca: f.tls.ca, key: f.tls.C.key, cert: f.tls.C.cert });
  t.after(() => otherPeer.close());
  await assert.rejects(otherPeer.status(envelope.offer), { code: 'TransportStatus' });
  assert.equal(f.journals.B.run(f.id), null); assert.equal(await f.clients.A.status(envelope.offer), null);
  f.journals.B.collectArtifacts('tenant'); f.journals.A.collectArtifacts('tenant');
  assert.ok(f.journals.B.hasArtifact('tenant', hash(envelope.outcome))); assert.ok(f.journals.A.hasArtifact('tenant', hash(envelope.outcome)));
  const refused = await f.clients.A.withdraw(envelope);
  assert.ok(f.journals.B.collectArtifacts('tenant').removed >= 2);
  assert.equal(f.journals.B.hasArtifact('tenant', hash(envelope.outcome)), false);
  assert.deepEqual(await f.clients.A.decide(envelope.offer), refused); assert.equal(f.hosts.A.status(f.id).custody, 'OFFERED');
  assert.ok(f.journals.A.hasArtifact('tenant', hash(envelope.outcome)));
});

test('mTLS cancellation reconciles ambiguous custody and reaches only the accepted owner', async t => {
  const f = await network(t, { dropReceipt: true }), offered = await f.hosts.A.run(f.id);
  assert.equal((await f.hosts.A.retryTransfer(offered.transfer_id)).kind, 'unknown');
  assert.equal((await f.hosts.A.cancelRun(f.id, 'stop')).kind, 'cancel_forwarded');
  assert.equal((await f.hosts.B.run(f.id)).kind, 'terminal'); assert.equal(f.result('B').kind, 'cancelled');
  assert.equal(f.counters.A.cleanup, 0); assert.equal(f.counters.B.cleanup, 1);
});

for (const badReply of ['http202', 'http503', 'redirect', 'malformedJSON', 'unknownField', 'badSignature']) test(`${badReply} after target commit preserves unknown source custody until exact reconciliation`, async t => {
  const f = await network(t, { badReply }), out = await f.hosts.A.run(f.id);
  assert.equal((await f.hosts.A.retryTransfer(out.transfer_id)).kind, 'unknown');
  assert.equal(f.hosts.A.status(f.id).custody, 'OFFERED'); assert.equal(f.hosts.B.status(f.id).custody, 'ACTIVE');
  assert.deepEqual(f.file.counts().reads, []); assert.equal(f.counters.A.cleanup, 0);
  assert.equal((await f.hosts.A.retryTransfer(out.transfer_id)).kind, 'accepted');
  assert.equal(f.hosts.A.status(f.id).custody, 'DEPARTED'); assert.equal(f.hosts.B.status(f.id).epoch, '1');
});

test('duplicate and reordered artifact/decision messages preserve one saved target decision', async t => {
  const f = await network(t), out = await f.hosts.A.run(f.id), envelope = await f.hosts.A.transferEnvelope(out.transfer_id);
  const token = await f.admissions.A.parked(envelope.image, envelope.outcome);
  envelope.requirements = canonicalRequirements(f.admissions.A.read(token).relocation.requirements);
  envelope.constraints = Buffer.from(f.journals.A.run(f.id).placement_evidence.constraints, 'base64url');
  await f.clients.A.stage(envelope, 'outcome', envelope.outcome);
  await f.clients.A.stage(envelope, 'outcome', envelope.outcome);
  assert.equal(await f.clients.A.status(envelope.offer), null); assert.equal(f.journals.B.run(f.id), null);
  await f.clients.A.stage(envelope, 'image', envelope.image);
  const receipts = await Promise.all([f.clients.A.decide(envelope.offer), f.clients.A.decide(envelope.offer)]);
  assert.deepEqual(receipts[0], receipts[1]);
  const staleUpload = await f.clients.A.stage(envelope, 'outcome', envelope.outcome);
  assert.deepEqual(Buffer.from(staleUpload.receipt, 'base64url'), Buffer.from(receipts[0]));
  assert.equal(f.journals.B.run(f.id).executor_incarnation, '0'); assert.deepEqual(f.file.counts().reads, []);
  f.journals.A.receiveDecision(envelope.offer, receipts[0]); assert.equal(f.hosts.A.status(f.id).custody, 'DEPARTED');
});

for (const dropStage of ['image', 'outcome']) for (const dropWhen of ['before', 'after']) test(`mTLS artifact disconnect ${dropStage}.${dropWhen} leaves inert recoverable staging and frozen source`, async t => {
  const f = await network(t, { dropStage, dropWhen }), offered = await f.hosts.A.run(f.id);
  const offer = parse(f.journals.A.transfer(offered.transfer_id).offer);
  assert.equal((await f.hosts.A.retryTransfer(offered.transfer_id)).kind, 'unknown');
  assert.equal(f.hosts.A.status(f.id).custody, 'OFFERED'); assert.equal(f.journals.B.run(f.id), null);
  assert.equal(f.journals.B.hasArtifact('tenant', offer.image_digest), dropStage === 'outcome' || dropWhen === 'after');
  assert.equal(f.journals.B.hasArtifact('tenant', offer.outcome_digest), dropStage === 'outcome' && dropWhen === 'after');
  assert.equal((await f.hosts.A.retryTransfer(offered.transfer_id)).kind, 'accepted');
  assert.equal(f.hosts.A.status(f.id).custody, 'DEPARTED'); assert.equal(f.hosts.B.status(f.id).custody, 'ACTIVE'); assert.deepEqual(f.file.counts().reads, []);
});
