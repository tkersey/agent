// Authenticated origin bridge. The deployer supplies session authentication;
// browser reports cannot mint replies, authority, images or successor tokens.
import { createServer } from 'node:https';
import { randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonical, parse, requireThat, CONTROL_LIMIT } from './canonical.mjs';
import { version } from './custody.mjs';
const opaque = () => randomBytes(32).toString('hex');
const same = (a, b) => { const x = canonical(a), y = canonical(b); return x.length === y.length && timingSafeEqual(x, y); };
const json = (res, value, status = 200, maximum = CONTROL_LIMIT) => { const bytes = canonical(value, maximum); res.writeHead(status, { 'content-type': 'application/json', 'content-length': bytes.length, 'cache-control': 'no-store' }); res.end(bytes); };
const binary = (res, bytes, type = 'application/octet-stream') => { res.writeHead(200, { 'content-type': type, 'content-length': bytes.length, 'cache-control': 'no-store' }); res.end(bytes); };
async function body(req, maximum) {
  requireThat(req.headers['content-encoding'] === undefined, 'EncodingRejected');
  const length = req.headers['content-length']; requireThat(typeof length === 'string' && /^(0|[1-9][0-9]*)$/.test(length) && BigInt(length) <= BigInt(maximum), 'BodyCapacity');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; requireThat(size <= maximum, 'BodyCapacity'); chunks.push(chunk); }
  requireThat(size === Number(length), 'TruncatedBody'); return Buffer.concat(chunks, size);
}
export async function serveBrowser(custodian, { key, cert, authenticate, redeem = null, catalogue = null, audience, runtimePath, kernelBytes, host = '127.0.0.1', port = 0, publicOrigin = null, maximumAssignments = 64 }) {
  requireThat(typeof authenticate === 'function' && typeof audience === 'string', 'BrowserAuthenticationRequired');
  requireThat(Number.isSafeInteger(maximumAssignments) && maximumAssignments > 0, 'AssignmentCapacity');
  const csrfKey = randomBytes(32), assignments = new Map(); let origin;
  // Authentication is checked on every request. A session-bound token needs no
  // historical session table and carries no authority after logout.
  const csrf = identity => createHmac('sha256', csrfKey).update(canonical([identity.sessionId, identity.principal, identity.tenant, audience])).digest('hex');
  const modules = new Set(['index.mjs', 'kernel.mjs', 'codec.mjs', 'errors.mjs', 'values.mjs', 'wire.mjs', 'wasm.mjs']);
  const worker = await readFile(new URL('./worker.mjs', import.meta.url));
  const assets = new Map(await Promise.all([['/client.mjs', './client.mjs'], ['/canonical.mjs', './canonical.mjs'], ['/agent-values.mjs', '../values.mjs']].map(async ([route, path]) => [route, await readFile(new URL(path, import.meta.url))])));
  const server = createServer({ key, cert, minVersion: 'TLSv1.3', maxHeaderSize: 16384 }, async (req, res) => {
    try {
      requireThat(req.headers.host === new URL(origin).host, 'OriginDenied');
      requireThat(req.url.length <= 1024 && !req.url.includes('?') && !req.url.includes('#'), 'InvalidRoute');
      if (redeem !== null && req.method === 'GET' && req.url === '/login') return binary(res, Buffer.from('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Sign in</title><main><h1>Sign in</h1><form id="login"><label>One-use credential <input id="credential" type="password" autocomplete="off" required></label><button>Sign in</button></form><p id="status" role="status"></p></main><script type="module" src="/login.mjs"></script>'), 'text/html; charset=utf-8');
      if (redeem !== null && req.method === 'GET' && req.url === '/login.mjs') return binary(res, Buffer.from(`document.querySelector('#login').addEventListener('submit', async event => {
        event.preventDefault(); const input = document.querySelector('#credential'), credential = input.value; input.value = '';
        const response = await fetch('/v1/browser/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }) });
        if (response.ok) location.replace('/'); else document.querySelector('#status').textContent = 'Sign-in failed. Request a new credential from your operator.';
      });`), 'text/javascript');
      if (redeem !== null && req.method === 'POST' && req.url === '/v1/browser/login') {
        requireThat(req.headers.origin === origin && req.headers['content-type'] === 'application/json', 'OriginDenied');
        const value = parse(await body(req, 256));
        requireThat(Object.keys(value).length === 1 && typeof value.credential === 'string', 'InvalidLogin');
        const result = await redeem(value.credential, audience);
        res.setHeader('set-cookie', result.cookie); return json(res, { expires: result.expires });
      }
      const identity = await authenticate(req);
      requireThat(identity && typeof identity.sessionId === 'string' && identity.sessionId.length > 0 && identity.sessionId.length <= 256 && Array.isArray(identity.audiences) && identity.audiences.includes(audience), 'UserDenied');
      requireThat(req.url.length <= 1024 && !req.url.includes('?') && !req.url.includes('#'), 'InvalidRoute');
      if (req.method === 'GET' && req.url === '/') return binary(res, Buffer.from('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Mobile Agent</title><main><h1>Mobile Agent</h1><form id="start-task" hidden><h2>New repository task</h2><label>Repository configuration <select id="task-entry" required></select></label><pre id="task-scope"></pre><label>Mode <select id="task-mode" required></select></label><label>Goal and acceptance expectations <textarea id="task-goal" required></textarea></label><button>Start task</button></form><label>Run <input id="run" autocomplete="off"></label> <button id="connect">Connect</button> <button id="continue">Continue</button> <button id="cancel">Cancel</button><p id="status" role="status">Ready</p><pre id="request"></pre><a id="export-result" hidden download="repository-task-result.json">Download task result and proposal</a><form id="answer" hidden><h2>Pending question</h2><div id="question"></div><label>Response <select id="choice" required></select></label><label>Text <textarea id="answer-text"></textarea></label><button>Send response</button></form></main><script type="module" src="/client.mjs"></script>'), 'text/html; charset=utf-8');
      if (req.method === 'GET' && assets.has(req.url)) return binary(res, assets.get(req.url), 'text/javascript');
      if (req.method === 'GET' && req.url === '/worker.mjs') return binary(res, worker, 'text/javascript');
      if (req.method === 'GET' && req.url === '/kernel.wasm') return binary(res, kernelBytes, 'application/wasm');
      const asset = /^\/world\/([a-z-]+\.mjs)$/.exec(req.url);
      if (req.method === 'GET' && asset && modules.has(asset[1])) return binary(res, await readFile(join(runtimePath, 'src/embedding', asset[1])), 'text/javascript');
      if (req.method === 'GET' && req.url === '/v1/browser/session') {
        return json(res, { csrf: csrf(identity), host_id: custodian.hostId });
      }
      if (req.method === 'GET' && req.url === '/v1/browser/tasks') return json(res, catalogue?.list(identity) ?? [], 200, 1 << 20);
      if (req.method === 'POST' && req.url === '/v1/browser/tasks') {
        requireThat(catalogue !== null, 'TaskIntakeUnavailable');
        requireThat(req.headers.origin === origin && typeof req.headers['x-agent-csrf'] === 'string' && same(req.headers['x-agent-csrf'], csrf(identity)), 'CsrfDenied');
        return json(res, await catalogue.start(identity, parse(await body(req, 32768))));
      }
      const route = /^\/v1\/browser\/runs\/([^/]+)\/(attach|command|report|image|outcome|reply|status|metrics|retry|cancel|question|answer|result-schema|result)$/.exec(req.url);
      requireThat(route !== null, 'UnknownRoute'); const id = decodeURIComponent(route[1]), operation = route[2];
      const run = custodian.authorizeUser(id, identity, { cleanup: ['cancel', 'status', 'metrics'].includes(operation),
        executor: ['attach', 'command', 'report', 'image', 'outcome', 'reply'].includes(operation) });
      if (catalogue && !['cancel', 'metrics', 'retry'].includes(operation)) catalogue.authorizeView(identity, run);
      if (req.method === 'POST') {
        requireThat(req.headers.origin === origin && typeof req.headers['x-agent-csrf'] === 'string' && same(req.headers['x-agent-csrf'], csrf(identity)), 'CsrfDenied');
      }
      if (req.method === 'GET' && operation === 'result-schema') {
        const schema = catalogue?.resultSchema(run.image_digest); requireThat(schema, 'ResultSchemaUnavailable'); return binary(res, schema);
      }
      if (req.method === 'GET' && operation === 'result') {
        requireThat(catalogue, 'ResultSchemaUnavailable');
        return json(res, await catalogue.exportResult(identity, id), 200, 8 << 20);
      }
      if (req.method === 'GET' && operation === 'status') return json(res, custodian.status(id));
      if (req.method === 'GET' && operation === 'question') return json(res, custodian.pendingQuestion(id, identity), 200, (2 << 20) + 8192);
      if (req.method === 'POST' && operation === 'answer') return json(res, await custodian.answerQuestion(id, identity, parse(await body(req, CONTROL_LIMIT))));
      if (req.method === 'GET' && operation === 'metrics') return json(res, custodian.metrics(id));
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
        for (const [nonce, assigned] of assignments) {
          requireThat(assigned.id !== id || !assigned.pending, 'ExecutorBusy');
          if (!assigned.pending && (assigned.id === id || ['TERMINAL', 'DEPARTED'].includes(custodian.status(assigned.id).custody))) assignments.delete(nonce);
        }
        requireThat(assignments.size < maximumAssignments, 'AssignmentCapacity');
        const nonce = opaque(); assignments.set(nonce, { id, pending: true });
        try {
          const data = await custodian.executorAssignment(id);
          assignments.set(nonce, { ...data, id, session: identity.sessionId, reply: null });
          return json(res, { nonce, version: data.version, runtime_profile: data.runtime_profile, quantum: '10000' });
        } catch (error) { assignments.delete(nonce); throw error; }
      }
      const nonce = req.headers['x-agent-assignment'], assigned = assignments.get(nonce);
      const encodedVersion = req.headers['x-agent-version'];
      requireThat(typeof encodedVersion === 'string' && /^[A-Za-z0-9_-]{1,4096}$/.test(encodedVersion), 'StaleAssignment');
      const wanted = parse(Buffer.from(encodedVersion, 'base64url'));
      const current = assigned && assigned.id === id && assigned.session === identity.sessionId && same(wanted, assigned.version) && same(assigned.version, version(run)) && ['ACTIVE', 'TERMINAL'].includes(run.status);
      if (!current && req.method === 'POST' && operation === 'command') custodian.noteStaleDispatch(id);
      requireThat(current, 'StaleAssignment');
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
        if (result.status.custody === 'TERMINAL') assignments.delete(nonce);
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
