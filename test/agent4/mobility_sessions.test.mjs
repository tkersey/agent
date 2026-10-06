import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:https';
import { BrowserSessions } from '../../runtime/mobility/sessions.mjs';
import { serveBrowser } from '../../runtime/mobility/browser.mjs';
import { certificates } from './mobility_tls_fixture.mjs';

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'agent-browser-sessions-'));
  let clock = 1000000, granted = true;
  const config = { directory, authorize: value => granted && value.principal === 'user' && value.tenant === 'tenant' && value.audiences[0] === 'human-A', clock: () => clock, ...options };
  let sessions = new BrowserSessions({ ...config, create: true });
  t.after(async () => { sessions.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, get sessions() { return sessions; }, advance: ms => { clock += ms; }, revokeGrant: () => { granted = false; },
    restart() { sessions.close(); sessions = new BrowserSessions(config); } };
}
const granted = { principal: 'user', tenant: 'tenant', audience: 'human-A' };
const cookieRequest = cookie => ({ headers: { cookie: cookie.split(';')[0] } });

test('operator logins are one-use, restart durable, scoped, bounded and stored only as verifiers', async t => {
  const f = await fixture(t, { maximum: 2 });
  assert.throws(() => f.sessions.issue({ ...granted, principal: 'invented' }), { code: 'UserDenied' });
  const issued = f.sessions.issue(granted);
  assert.equal((await readFile(join(f.directory, 'browser-sessions.sqlite'))).includes(Buffer.from(issued.credential)), false);
  f.restart();
  assert.throws(() => f.sessions.redeem(issued.credential, 'other'), { code: 'UserDenied' });
  const session = f.sessions.redeem(issued.credential, granted.audience);
  assert.match(session.cookie, /^__Host-agent-session=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800$/);
  assert.throws(() => f.sessions.redeem(issued.credential, granted.audience), { code: 'InvalidLogin' });
  const identity = f.sessions.authenticate(cookieRequest(session.cookie));
  assert.equal(identity.principal, 'user'); assert.equal(identity.tenant, 'tenant'); assert.deepEqual(identity.audiences, ['human-A']);
  const secret = session.cookie.split('=')[1].split(';')[0];
  assert.equal((await readFile(join(f.directory, 'browser-sessions.sqlite'))).includes(Buffer.from(secret)), false);
  f.restart(); assert.deepEqual(f.sessions.authenticate(cookieRequest(session.cookie)), identity);
  assert.throws(() => f.sessions.authenticate({ headers: { cookie: session.cookie.split(';')[0] + '; ' + session.cookie.split(';')[0] } }), { code: 'UserDenied' });
  f.sessions.issue(granted); assert.throws(() => f.sessions.issue(granted), { code: 'SessionCapacity' });
  assert.deepEqual(f.sessions.revoke(identity.sessionId), { removed: 1 });
  assert.throws(() => f.sessions.authenticate(cookieRequest(session.cookie)), { code: 'UserDenied' });
  f.advance(10 * 60 * 1000); const fresh = f.sessions.issue(granted);
  f.advance(10 * 60 * 1000); assert.throws(() => f.sessions.redeem(fresh.credential, granted.audience), { code: 'InvalidLogin' });
});

test('session expiry and live grant revocation are checked on every authentication', async t => {
  const f = await fixture(t, { sessionMs: 2000 });
  const session = f.sessions.redeem(f.sessions.issue(granted).credential, granted.audience);
  f.advance(1999); assert.equal(f.sessions.authenticate(cookieRequest(session.cookie)).principal, 'user');
  f.advance(1); assert.throws(() => f.sessions.authenticate(cookieRequest(session.cookie)), { code: 'UserDenied' });
  const fresh = f.sessions.redeem(f.sessions.issue(granted).credential, granted.audience);
  f.revokeGrant(); assert.throws(() => f.sessions.authenticate(cookieRequest(fresh.cookie)), { code: 'UserDenied' });
});

test('reference TLS login requires exact origin, rejects minting and URL credentials, and returns an HttpOnly cookie', async t => {
  const f = await fixture(t), tls = await certificates(f.directory);
  const server = await serveBrowser({ hostId: 'A' }, { ...tls.A, audience: 'human-A', runtimePath: f.directory, kernelBytes: new Uint8Array(),
    authenticate: req => f.sessions.authenticate(req), redeem: (credential, audience) => f.sessions.redeem(credential, audience) });
  t.after(() => server.close());
  async function api(path, { method = 'GET', origin = server.url, cookie, data = null, host } = {}) {
    const bytes = data === null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(data));
    return new Promise((resolve, reject) => {
      const headers = { origin, 'content-type': 'application/json', 'content-length': bytes.length, ...(cookie ? { cookie } : {}), ...(host ? { host } : {}) };
      const req = request(server.url + path, { method, headers, ca: tls.ca, servername: 'localhost' }, res => {
        const chunks = []; res.on('data', value => chunks.push(value)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
      }); req.on('error', reject); req.end(bytes);
    });
  }
  assert.equal((await api('/login')).status, 200);
  assert.equal((await api('/v1/browser/session')).status, 403);
  const credential = f.sessions.issue(granted).credential;
  assert.equal((await api('/v1/browser/login', { method: 'POST', origin: 'https://evil.invalid', data: { credential } })).status, 403);
  assert.equal((await api('/v1/browser/login', { method: 'POST', origin: 'https://127.0.0.1:1', data: { credential } })).status, 403);
  assert.equal((await api('/v1/browser/login', { method: 'POST', host: 'evil.invalid', data: { credential } })).status, 403);
  assert.equal((await api(`/v1/browser/login?credential=${credential}`, { method: 'POST', data: { credential } })).status, 409);
  const redeemed = await api('/v1/browser/login', { method: 'POST', data: { credential } });
  assert.equal(redeemed.status, 200); assert.match(redeemed.headers['set-cookie'][0], /Secure; HttpOnly; SameSite=Strict/);
  const cookie = redeemed.headers['set-cookie'][0].split(';')[0];
  assert.equal((await api('/v1/browser/session', { cookie })).status, 200);
  assert.equal((await api('/v1/browser/login', { method: 'POST', data: { credential } })).status, 409);
  assert.equal((await api('/v1/browser/login-issue', { method: 'POST', cookie, data: granted })).status, 409);
  f.revokeGrant(); assert.equal((await api('/v1/browser/session', { cookie })).status, 403);
});
