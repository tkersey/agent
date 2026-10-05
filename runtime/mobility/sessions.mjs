// Reference operator-issued browser sessions. Only a local owner can issue a
// login credential; the public bridge exposes redemption, never issuance.
import { DatabaseSync } from 'node:sqlite';
import { constants, lstatSync, openSync, closeSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { canonical, parse, requireThat, identifier } from './canonical.mjs';
const token = () => randomBytes(32).toString('base64url');
const verifier = value => createHash('sha256').update(value).digest('hex');
const COOKIE = '__Host-agent-session';
export class BrowserSessions {
  #db; #authorize; #clock; #maximum; #loginMs; #sessionMs;
  constructor({ directory, authorize, create = false, clock = Date.now, maximum = 256, loginMs = 10 * 60 * 1000, sessionMs = 8 * 60 * 60 * 1000 }) {
    requireThat(typeof authorize === 'function' && typeof clock === 'function', 'SessionGrantRequired');
    requireThat(Number.isSafeInteger(maximum) && maximum > 0 && maximum <= 10000, 'SessionCapacity');
    requireThat(Number.isSafeInteger(loginMs) && loginMs > 0 && loginMs <= 60 * 60 * 1000 && Number.isSafeInteger(sessionMs) && sessionMs > 0 && sessionMs <= 24 * 60 * 60 * 1000, 'SessionLifetime');
    const root = resolve(directory), path = join(root, 'browser-sessions.sqlite');
    if (create) mkdirSync(root, { recursive: true, mode: 0o700 });
    const privateFile = (value, directory = false) => {
      const stat = lstatSync(value);
      requireThat(!stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1) && stat.uid === process.getuid() && (stat.mode & 0o077) === 0, 'PrivateSessionStorageRequired');
    };
    privateFile(root, true); let fresh = false;
    try { privateFile(path); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      requireThat(create, 'MissingSessionStorage');
      closeSync(openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY, 0o600)); fresh = true;
    }
    this.#authorize = authorize; this.#clock = clock; this.#maximum = maximum; this.#loginMs = loginMs; this.#sessionMs = sessionMs;
    this.#db = new DatabaseSync(path, { timeout: 5000, allowExtension: false });
    try {
      this.#db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=EXTRA; PRAGMA fullfsync=ON; PRAGMA trusted_schema=OFF;');
      if (fresh) this.#db.exec('BEGIN IMMEDIATE; CREATE TABLE logins (verifier TEXT PRIMARY KEY, expires INTEGER NOT NULL, identity BLOB NOT NULL) STRICT; CREATE TABLE sessions (verifier TEXT PRIMARY KEY, expires INTEGER NOT NULL, identity BLOB NOT NULL) STRICT; COMMIT;');
      this.#sql('get', 'SELECT (SELECT count(*) FROM logins)+(SELECT count(*) FROM sessions) AS count');
      requireThat(this.#sql('get', 'PRAGMA quick_check').quick_check === 'ok', 'CorruptSessionStorage');
    } catch (error) { this.#db.close(); throw error; }
  }
  #sql(method, sql, ...parameters) {
    const statement = this.#db.prepare(sql);
    try { return statement[method](...parameters); } finally { statement.close(); }
  }
  #transaction(action) {
    this.#db.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.#db.exec('COMMIT'); return result; }
    catch (error) { if (this.#db.isTransaction) this.#db.exec('ROLLBACK'); throw error; }
  }
  #now() { const now = this.#clock(); requireThat(Number.isSafeInteger(now) && now >= 0, 'SessionClock'); return now; }
  #grant(identity) {
    identifier(identity.principal); identifier(identity.tenant);
    requireThat(Array.isArray(identity.audiences) && identity.audiences.length === 1, 'SessionAudience');
    identifier(identity.audiences[0]);
    const granted = this.#authorize(identity);
    requireThat(granted === true, 'UserDenied');
  }
  #prune(now) {
    this.#sql('run', 'DELETE FROM logins WHERE expires<=?', now);
    this.#sql('run', 'DELETE FROM sessions WHERE expires<=?', now);
  }
  issue({ principal, tenant, audience }) {
    const identity = { principal, tenant, audiences: [audience] }; this.#grant(identity);
    return this.#transaction(() => {
      const now = this.#now(); this.#prune(now);
      requireThat(this.#sql('get', 'SELECT (SELECT count(*) FROM logins)+(SELECT count(*) FROM sessions) AS count').count < this.#maximum, 'SessionCapacity');
      const credential = token(), expires = now + this.#loginMs;
      this.#sql('run', 'INSERT INTO logins VALUES (?,?,?)', verifier(credential), expires, canonical(identity));
      return { credential, expires };
    });
  }
  redeem(credential, audience) {
    requireThat(typeof credential === 'string' && /^[A-Za-z0-9_-]{43}$/.test(credential), 'InvalidLogin');
    return this.#transaction(() => {
      const now = this.#now(), row = this.#sql('get', 'SELECT * FROM logins WHERE verifier=?', verifier(credential));
      requireThat(row && row.expires > now, 'InvalidLogin');
      const identity = parse(row.identity); this.#grant(identity);
      requireThat(identity.audiences.includes(audience), 'UserDenied');
      const secret = token(), expires = now + this.#sessionMs, value = { ...identity, sessionId: token() };
      this.#sql('run', 'DELETE FROM logins WHERE verifier=?', verifier(credential));
      this.#sql('run', 'INSERT INTO sessions VALUES (?,?,?)', verifier(secret), expires, canonical(value));
      return { expires, cookie: `${COOKIE}=${secret}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(this.#sessionMs / 1000)}` };
    });
  }
  authenticate(request) {
    const cookies = request.headers.cookie;
    requireThat(typeof cookies === 'string' && cookies.length <= 8192, 'UserDenied');
    const matching = cookies.split(';').map(value => value.trim()).filter(value => value.startsWith(`${COOKIE}=`));
    requireThat(matching.length === 1, 'UserDenied');
    const secret = matching[0].slice(COOKIE.length + 1);
    requireThat(/^[A-Za-z0-9_-]{43}$/.test(secret), 'UserDenied');
    const row = this.#sql('get', 'SELECT * FROM sessions WHERE verifier=?', verifier(secret));
    requireThat(row && row.expires > this.#now(), 'UserDenied');
    const identity = parse(row.identity); this.#grant(identity); return identity;
  }
  revoke(sessionId) {
    return this.#transaction(() => {
      let removed = 0;
      for (const row of this.#sql('all', 'SELECT verifier,identity FROM sessions')) if (parse(row.identity).sessionId === sessionId)
        removed += this.#sql('run', 'DELETE FROM sessions WHERE verifier=?', row.verifier).changes;
      return { removed };
    });
  }
  close() { this.#db.close(); }
}
