// Authenticated origin bridge. The deployer supplies session authentication;
// browser reports cannot mint replies, authority, images or successor tokens.
import { createServer } from 'node:https';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonical, parse, requireThat, CONTROL_LIMIT } from './canonical.mjs';
import { version } from './custody.mjs';
const opaque = () => randomBytes(32).toString('hex');
const same = (a, b) => { const x = canonical(a), y = canonical(b); return x.length === y.length && timingSafeEqual(x, y); };
const json = (res, value, status = 200) => { const bytes = canonical(value); res.writeHead(status, { 'content-type': 'application/json', 'content-length': bytes.length, 'cache-control': 'no-store' }); res.end(bytes); };
const binary = (res, bytes, type = 'application/octet-stream') => { res.writeHead(200, { 'content-type': type, 'content-length': bytes.length, 'cache-control': 'no-store' }); res.end(bytes); };
async function body(req, maximum) {
  requireThat(req.headers['content-encoding'] === undefined, 'EncodingRejected');
  const length = req.headers['content-length']; requireThat(typeof length === 'string' && /^(0|[1-9][0-9]*)$/.test(length) && BigInt(length) <= BigInt(maximum), 'BodyCapacity');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; requireThat(size <= maximum, 'BodyCapacity'); chunks.push(chunk); }
  requireThat(size === Number(length), 'TruncatedBody'); return Buffer.concat(chunks, size);
}
export async function serveBrowser(custodian, { key, cert, authenticate, audience, runtimePath, kernelBytes, host = '127.0.0.1', port = 0, publicOrigin = null, maximumAssignments = 64 }) {
  requireThat(typeof authenticate === 'function' && typeof audience === 'string', 'BrowserAuthenticationRequired');
  const csrf = new Map(), assignments = new Map(); let origin;
  const modules = new Set(['index.mjs', 'kernel.mjs', 'codec.mjs', 'errors.mjs', 'values.mjs', 'wire.mjs', 'wasm.mjs']);
  const worker = await readFile(new URL('./worker.mjs', import.meta.url));
  const server = createServer({ key, cert, minVersion: 'TLSv1.3', maxHeaderSize: 16384 }, async (req, res) => {
    try {
      requireThat(req.headers.host === new URL(origin).host, 'OriginDenied');
      const identity = await authenticate(req);
      requireThat(identity && typeof identity.sessionId === 'string' && identity.sessionId.length > 0 && identity.sessionId.length <= 256 && Array.isArray(identity.audiences) && identity.audiences.includes(audience), 'UserDenied');
      requireThat(req.url.length <= 1024 && !req.url.includes('?') && !req.url.includes('#'), 'InvalidRoute');
      if (req.method === 'GET' && req.url === '/') return binary(res, Buffer.from('<!doctype html><meta charset="utf-8"><title>Mobile Agent</title><main id="result">Ready</main>'), 'text/html; charset=utf-8');
      if (req.method === 'GET' && req.url === '/worker.mjs') return binary(res, worker, 'text/javascript');
      if (req.method === 'GET' && req.url === '/kernel.wasm') return binary(res, kernelBytes, 'application/wasm');
      const asset = /^\/world\/([a-z-]+\.mjs)$/.exec(req.url);
      if (req.method === 'GET' && asset && modules.has(asset[1])) return binary(res, await readFile(join(runtimePath, 'src/embedding', asset[1])), 'text/javascript');
      if (req.method === 'GET' && req.url === '/v1/browser/session') {
        if (!csrf.has(identity.sessionId)) { requireThat(csrf.size < maximumAssignments, 'SessionCapacity'); csrf.set(identity.sessionId, opaque()); }
        return json(res, { csrf: csrf.get(identity.sessionId), host_id: custodian.hostId });
      }
      const route = /^\/v1\/browser\/runs\/([^/]+)\/(attach|command|report|image|outcome|reply|status|retry|cancel)$/.exec(req.url);
      requireThat(route !== null, 'UnknownRoute'); const id = decodeURIComponent(route[1]), operation = route[2];
      const run = custodian.authorizeUser(id, identity, operation === 'cancel' || operation === 'status');
      if (req.method === 'POST') {
        requireThat(req.headers.origin === origin && req.headers['x-agent-csrf'] === csrf.get(identity.sessionId) && csrf.has(identity.sessionId), 'CsrfDenied');
      }
      if (req.method === 'GET' && operation === 'status') return json(res, custodian.status(id));
      if (req.method === 'POST' && operation === 'cancel') {
        const value = parse(await body(req, CONTROL_LIMIT)); requireThat(Object.keys(value).length === 1 && typeof value.reason === 'string', 'InvalidControl');
        return json(res, await custodian.cancelRun(id, value.reason));
      }
      if (req.method === 'POST' && operation === 'retry') {
        await body(req, 0); requireThat(run.status === 'OFFERED' && run.transfer_id !== null, 'TransferNotPending');
        return json(res, await custodian.retryTransfer(run.transfer_id));
      }
      if (req.method === 'POST' && operation === 'attach') {
        await body(req, 0);
        for (const [nonce, assigned] of assignments) if (assigned.id === id) assignments.delete(nonce);
        requireThat(assignments.size < maximumAssignments, 'AssignmentCapacity');
        const data = await custodian.executorAssignment(id), nonce = opaque();
        assignments.set(nonce, { ...data, id, session: identity.sessionId, reply: null });
        return json(res, { nonce, version: data.version, runtime_profile: data.runtime_profile, quantum: '10000' });
      }
      const nonce = req.headers['x-agent-assignment'], assigned = assignments.get(nonce);
      const encodedVersion = req.headers['x-agent-version'];
      requireThat(typeof encodedVersion === 'string' && /^[A-Za-z0-9_-]{1,4096}$/.test(encodedVersion), 'StaleAssignment');
      const wanted = parse(Buffer.from(encodedVersion, 'base64url'));
      requireThat(assigned && assigned.id === id && assigned.session === identity.sessionId && same(wanted, assigned.version) && same(assigned.version, version(run)) && ['ACTIVE', 'TERMINAL'].includes(run.status), 'StaleAssignment');
      if (req.method === 'GET' && ['image', 'outcome', 'reply'].includes(operation)) {
        requireThat(assigned[operation] instanceof Uint8Array, 'ReplyNotAcquired'); return binary(res, assigned[operation]);
      }
      if (req.method === 'POST' && operation === 'command') {
        await body(req, 0); const result = await custodian.executorCommand(id, assigned.version);
        if (result.kind !== 'drive') { if (['offered', 'unknown'].includes(result.kind)) assignments.delete(nonce); return json(res, result); }
        assigned.reply = result.command.kind === 'reply' ? result.command.value : null;
        return json(res, { kind: 'drive', control: result.command.kind, reason: result.command.reason ?? null, version: assigned.version });
      }
      if (req.method === 'POST' && operation === 'report') {
        const output = await body(req, 8 << 20);
        const result = await custodian.publishExecutor(id, assigned.version, output);
        assigned.version = result.version; assigned.outcome = Uint8Array.from(output); assigned.reply = null;
        return json(res, result);
      }
      requireThat(false, 'UnknownRoute');
    } catch (error) {
      if (!res.headersSent && !res.destroyed) json(res, { error: /^[A-Za-z0-9_]{1,80}$/.test(error.code ?? '') ? error.code : 'BrowserRequestRejected' }, ['UserDenied', 'CsrfDenied', 'OriginDenied'].includes(error.code) ? 403 : error.code === 'BodyCapacity' ? 413 : 409);
      req.resume();
    }
  });
  server.headersTimeout = 10000; server.requestTimeout = 15000; server.keepAliveTimeout = 1000; server.maxConnections = 32;
  server.on('clientError', (_, socket) => socket.destroy()); server.on('tlsClientError', () => {});
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  origin = publicOrigin ?? `https://${host.includes(':') ? `[${host}]` : host}:${server.address().port}`;
  requireThat(new URL(origin).origin === origin && new URL(origin).protocol === 'https:', 'OriginDenied');
  return { url: origin, server, close: () => new Promise((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); }) };
}
