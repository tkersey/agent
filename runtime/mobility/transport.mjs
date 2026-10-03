// Configured HTTPS peers only. HTTP success is never a custody decision: only
// a matching signed terminal receipt can authorize journal transitions.
import { createServer, request, Agent } from 'node:https';
import { checkServerIdentity } from 'node:tls';
import { canonical, parse, closed, requireThat, CONTROL_LIMIT, digest, identifier, counter } from './canonical.mjs';
import { observationValue } from './values.mjs';
const b64 = value => Buffer.from(value).toString('base64url');
function binary(value, maximum = CONTROL_LIMIT) {
  requireThat(typeof value === 'string' && /^[A-Za-z0-9_-]*$/.test(value) && value.length <= Math.ceil(maximum * 4 / 3), 'InvalidBinary');
  const result = Buffer.from(value, 'base64url'); requireThat(result.length <= maximum && b64(result) === value, 'InvalidBinary'); return result;
}
const fingerprint = value => value?.replaceAll(':', '').toLowerCase();
const envelopeFields = ['offer', 'registration', 'predecessor', 'observation', 'requirements', 'constraints'];
export function encodeEnvelope(envelope) {
  return canonical({ offer: b64(envelope.offer), registration: b64(envelope.registration), predecessor: envelope.predecessor === null ? null : b64(envelope.predecessor),
    observation: envelope.observation, requirements: b64(envelope.requirements), constraints: b64(envelope.constraints) });
}
function decodeEnvelope(bytes) {
  const value = parse(bytes); closed(value, envelopeFields);
  return { offer: binary(value.offer), registration: binary(value.registration), predecessor: value.predecessor === null ? null : binary(value.predecessor),
    observation: value.observation, requirements: binary(value.requirements), constraints: binary(value.constraints) };
}
async function readBody(stream, maximum, exact = null) {
  requireThat(stream.headers['content-encoding'] === undefined, 'EncodingRejected');
  const length = stream.headers['content-length'];
  requireThat(typeof length === 'string' && /^(0|[1-9][0-9]*)$/.test(length) && BigInt(length) <= BigInt(maximum) && (exact === null || BigInt(length) === BigInt(exact)), 'BodyCapacity');
  const chunks = []; let count = 0;
  for await (const chunk of stream) { count += chunk.length; requireThat(count <= maximum, 'BodyCapacity'); chunks.push(chunk); }
  requireThat(count === Number(length), 'TruncatedBody'); return Buffer.concat(chunks, count);
}
function response(stream, value, status = 200) {
  const bytes = canonical(value); stream.writeHead(status, { 'content-type': 'application/json', 'content-length': bytes.length, 'cache-control': 'no-store' }); stream.end(bytes);
}
function terminal(receipt) { return { state: 'terminal', receipt: b64(receipt) }; }
export async function servePeers(custodian, { key, cert, ca, peerCertificates, host = '127.0.0.1', port = 0, maximumConcurrent = 4, fault = () => {} }) {
  let active = 0;
  const peers = new Map([...peerCertificates].map(([certHash, id]) => [fingerprint(certHash), id]));
  const server = createServer({ key, cert, ca, requestCert: true, rejectUnauthorized: true, minVersion: 'TLSv1.3', maxHeaderSize: 96 * 1024 }, async (req, res) => {
    let counted = false;
    try {
      requireThat(req.socket.authorized, 'PeerDenied');
      const peer = peers.get(fingerprint(req.socket.getPeerCertificate().fingerprint256)); requireThat(peer !== undefined, 'PeerDenied');
      requireThat(active < maximumConcurrent, 'HostBusy'); active++; counted = true;
      requireThat(req.headers['content-encoding'] === undefined, 'EncodingRejected');
      if (req.method === 'POST' || (req.method === 'PUT' && !req.url.includes('/artifacts/'))) requireThat(req.headers['content-type'] === 'application/json', 'EncodingRejected');
      requireThat(req.url.length <= 1024 && !req.url.includes('?') && !req.url.includes('#'), 'InvalidRoute');
      if (req.method === 'POST' && req.url === '/v1/mobility/preflight') {
        const value = parse(await readBody(req, CONTROL_LIMIT)); closed(value, ['registration', 'requirements', 'constraints', 'classification']);
        return response(res, custodian.preflight(peer, { registration: binary(value.registration), requirements: binary(value.requirements), constraints: binary(value.constraints), classification: value.classification }));
      }
      const path = /^\/v1\/mobility\/transfers\/([0-9a-f]{64})(?:\/(artifacts\/(image|outcome)|decision|withdraw))?$/.exec(req.url);
      if (path) {
        const [, id, operation, kind] = path;
        if (req.method === 'GET' && operation === undefined) {
          const state = custodian.transferStatus(peer, id); return response(res, state.receipt ? terminal(state.receipt) : state);
        }
        if (req.method === 'PUT' && kind !== undefined) {
          requireThat(req.headers['content-type'] === 'application/octet-stream', 'EncodingRejected');
          const envelope = decodeEnvelope(binary(req.headers['x-agent-mobility']));
          const metadata = custodian.admitTransferMetadata(peer, envelope); requireThat(metadata.offer.transfer_id === id, 'TransferMismatch');
          if (metadata.receipt !== null) { req.resume(); return response(res, terminal(metadata.receipt)); }
          // Authenticate, authorize metadata and check declared size before
          // buffering any image/checkpoint bytes.
          fault('stage.before_body', { id, kind });
          const bytes = await readBody(req, metadata.offer.artifact_lengths[kind], metadata.offer.artifact_lengths[kind]);
          const staged = custodian.stageArtifact(peer, envelope, kind, bytes);
          fault('stage.after_commit', { id, kind });
          return response(res, staged.receipt ? terminal(staged.receipt) : { state: 'staged', artifact: staged.stored, digest: staged.digest });
        }
        if (req.method === 'PUT' && operation === 'decision') {
          const value = parse(await readBody(req, CONTROL_LIMIT)); closed(value, ['offer']);
          const offer = binary(value.offer); requireThat(parse(offer).transfer_id === id, 'TransferMismatch');
          const receipt = await custodian.decideStaged(peer, offer);
          fault('decision.after_commit', { id, response: res });
          return response(res, terminal(receipt));
        }
        if (req.method === 'POST' && operation === 'withdraw') {
          const value = parse(await readBody(req, CONTROL_LIMIT)); closed(value, ['offer', 'registration']);
          const offer = binary(value.offer); requireThat(parse(offer).transfer_id === id, 'TransferMismatch');
          const receipt = custodian.withdraw(peer, { offer, registration: binary(value.registration) });
          fault('withdraw.after_commit', { id, response: res }); return response(res, terminal(receipt));
        }
      }
      const control = /^\/v1\/runs\/([^/]{1,1024})\/control$/.exec(req.url);
      if (req.method === 'POST' && control) {
        const value = parse(await readBody(req, CONTROL_LIMIT)); closed(value, ['registration', 'action', 'reason']);
        return response(res, custodian.control(peer, binary(value.registration), decodeURIComponent(control[1]), value.action, value.reason));
      }
      response(res, { error: 'UnknownRoute' }, 404);
    } catch (error) {
      if (!res.destroyed && !res.headersSent) response(res, { error: /^[A-Za-z0-9_]{1,80}$/.test(error.code ?? '') ? error.code : 'ProtocolRejected' }, error.code === 'PeerDenied' ? 403 : error.code === 'BodyCapacity' ? 413 : error.code === 'HostBusy' ? 503 : 400);
      req.resume();
    } finally { if (counted) active--; }
  });
  server.headersTimeout = 10000; server.requestTimeout = 15000; server.keepAliveTimeout = 1000; server.maxConnections = 32;
  server.on('clientError', (_, socket) => socket.destroy()); server.on('tlsClientError', () => {});
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return { url: `https://${host.includes(':') ? `[${host}]` : host}:${server.address().port}`, server,
    close: () => new Promise((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); }) };
}
export class PeerClient {
  #url; #agent; #timeout;
  constructor({ url, servername, fingerprint256, key, cert, ca, timeout = 10000 }) {
    this.#url = new URL(url);
    requireThat(this.#url.protocol === 'https:' && this.#url.pathname === '/' && !this.#url.username && !this.#url.password && !this.#url.search && !this.#url.hash, 'PeerEndpointRejected');
    digest(fingerprint(fingerprint256)); requireThat(Number.isInteger(timeout) && timeout > 0 && timeout <= 60000, 'InvalidTimeout'); this.#timeout = timeout;
    this.#agent = new Agent({ key, cert, ca, servername, rejectUnauthorized: true, minVersion: 'TLSv1.3', keepAlive: true, maxSockets: 4, maxFreeSockets: 2, proxyEnv: {},
      checkServerIdentity(name, remote) { return checkServerIdentity(name, remote) ?? (fingerprint(remote.fingerprint256) === fingerprint(fingerprint256) ? undefined : Object.assign(new Error('PeerCertificateMismatch'), { code: 'PeerCertificateMismatch' })); } });
  }
  close() { this.#agent.destroy(); }
  #request(method, path, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = request(new URL(path, this.#url), { method, agent: this.#agent, signal: AbortSignal.timeout(this.#timeout),
        headers: { 'content-type': 'application/json', 'content-length': body?.length ?? 0, ...headers } }, async res => {
        try {
          // Redirects and HTTP 202 are not protocol decisions. Never follow a
          // server-provided endpoint, forward credentials, or infer refusal.
          requireThat(res.statusCode === 200, 'TransportStatus');
          requireThat(res.headers['content-type'] === 'application/json', 'TransportEncoding');
          const bytes = await readBody(res, CONTROL_LIMIT); resolve(parse(bytes));
        } catch (error) { res.destroy(); reject(error); }
      });
      req.on('error', reject); req.end(body);
    });
  }
  async preflight(metadata) {
    const value = await this.#request('POST', '/v1/mobility/preflight', canonical({ registration: b64(metadata.registration), requirements: b64(metadata.requirements), constraints: b64(metadata.constraints), classification: metadata.classification }));
    closed(value, ['observation', 'trust_domain', 'cost', 'cost_revision', 'has_image']);
    closed(value.observation, ['host_id', 'requirements_digest', 'binding_digest', 'policy_revision', 'runtime_profile']); observationValue(value.observation);
    closed(value.cost, ['transfer', 'startup', 'capability']); for (const cost of Object.values(value.cost)) if (cost !== null) counter(cost);
    identifier(value.trust_domain); identifier(value.cost_revision); requireThat(typeof value.has_image === 'boolean', 'InvalidObservation'); return value;
  }
  async status(offerBytes) {
    const id = parse(offerBytes).transfer_id; digest(id);
    const value = await this.#request('GET', `/v1/mobility/transfers/${id}`);
    if (value.state === 'terminal') { closed(value, ['state', 'receipt']); return binary(value.receipt); }
    closed(value, ['state']); requireThat(['unseen', 'pending'].includes(value.state), 'UnknownTransferStatus'); return null;
  }
  async stage(envelope, kind, bytes) {
    const id = parse(envelope.offer).transfer_id; digest(id); requireThat(['image', 'outcome'].includes(kind), 'UnknownArtifact');
    return this.#request('PUT', `/v1/mobility/transfers/${id}/artifacts/${kind}`, bytes, { 'content-type': 'application/octet-stream', 'x-agent-mobility': b64(encodeEnvelope(envelope)) });
  }
  async decide(offerBytes) {
    const id = parse(offerBytes).transfer_id; digest(id);
    const result = await this.#request('PUT', `/v1/mobility/transfers/${id}/decision`, canonical({ offer: b64(offerBytes) }));
    closed(result, ['state', 'receipt']); requireThat(result.state === 'terminal', 'UnknownDecision'); return binary(result.receipt);
  }
  async deliver(envelope) {
    // A staged image is cached by exact tenant/digest; repeated uploads are inert
    // and idempotent. The warm-cache lane may call stage(outcome) then decide.
    if (!envelope.image_cached) await this.stage(envelope, 'image', envelope.image);
    await this.stage(envelope, 'outcome', envelope.outcome); return this.decide(envelope.offer);
  }
  async withdraw(envelope) {
    const id = parse(envelope.offer).transfer_id; digest(id);
    const result = await this.#request('POST', `/v1/mobility/transfers/${id}/withdraw`, canonical({ offer: b64(envelope.offer), registration: b64(envelope.registration) }));
    closed(result, ['state', 'receipt']); requireThat(result.state === 'terminal', 'UnknownDecision'); return binary(result.receipt);
  }
  async control(registration, runId, action, reason = null) {
    return this.#request('POST', `/v1/runs/${encodeURIComponent(runId)}/control`, canonical({ registration: b64(registration), action, reason }));
  }
}
