// A local admission gate whose process becomes the sole Git ref writer.
// The caller owns proposal/policy admission. This owner supplies exclusion and
// proves completion by reaping, never by a deadline or a persisted PID.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const require = (condition, code) => { if (!condition) fail(code); };

async function pinnedExecutable(filename, sha256) {
  require(isAbsolute(filename) && /^[a-f0-9]{64}$/.test(sha256), 'PublicationGateExecutable');
  const path = await realpath(filename), fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await fd.stat({ bigint: true });
    require(before.isFile() && before.size > 0n && before.size <= 128n << 20n, 'PublicationGateExecutable');
    const bytes = await fd.readFile(), after = await fd.stat({ bigint: true });
    require(before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs &&
      createHash('sha256').update(bytes).digest('hex') === sha256, 'PublicationGateExecutableChanged');
    return path;
  } finally { await fd.close(); }
}

/** Trusted adapter API. `body` runs under the lock and may invoke the exact
 * predeclared command once, or inspect history without writing. Parent death
 * before exec gives EOF and no write; after exec Git retains the flock itself.
 * This mechanism is qualified for the pinned Git executable on macOS. */
export async function withPublicationGate({ helper, lock, command, timeoutMs = 30000 }, body) {
  require(process.platform === 'darwin', 'PublicationGateUnavailable');
  require(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 30000 &&
    isAbsolute(lock.path) && /^\d+$/.test(lock.dev) && /^\d+$/.test(lock.ino), 'PublicationGateConfiguration');
  const executable = await pinnedExecutable(helper.path, helper.sha256);
  const git = await pinnedExecutable(command.path, command.sha256);
  require(Array.isArray(command.args) && command.args.length > 0 && command.args.length <= 110 &&
    command.args.every(arg => typeof arg === 'string' && !arg.includes('\0')) &&
    Buffer.isBuffer(command.input) && command.input.length <= (16 << 20), 'PublicationGateCommand');
  const input = Buffer.from(command.input);
  const child = spawn(executable, [lock.path, lock.dev, lock.ino, git, ...command.args], {
    env: { ...command.env }, stdio: ['pipe', 'pipe', 'pipe'], detached: true,
  });
  let closed = false, used = false, ready = false, reason = null, bytes = 0;
  let resolveReady, rejectReady;
  const acquired = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const stop = code => {
    if (closed) return;
    reason ??= code;
    // The helper execs rather than spawning. Killing this still-owned process
    // kills the writer itself; close below is the completion witness.
    child.kill('SIGKILL');
  };
  const timer = setTimeout(() => stop('PublicationGateTimeout'), timeoutMs);
  let prefix = Buffer.alloc(0);
  child.stdout.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > 65536) return stop('PublicationGateOutputCapacity');
    if (!ready) {
      prefix = Buffer.concat([prefix, chunk]);
      if (prefix.length >= 7) {
        if (!prefix.subarray(0, 7).equals(Buffer.from('LOCKED\n'))) return stop('PublicationGateProtocol');
        ready = true; resolveReady();
      }
    }
  });
  child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > 65536) stop('PublicationGateOutputCapacity'); });
  child.stdin.on('error', () => {});
  child.on('error', () => { reason ??= 'PublicationGateUnavailable'; });
  const completion = new Promise(resolve => child.on('close', (code, signal) => {
    closed = true; clearTimeout(timer);
    const result = { code, signal, reason };
    if (!ready) rejectReady(Object.assign(new Error(reason ?? (code === 123 ? 'PublicationGateBusy' : 'PublicationGateUnavailable')),
      { code: reason ?? (code === 123 ? 'PublicationGateBusy' : 'PublicationGateUnavailable') }));
    resolve(result);
  }));
  try {
    await acquired;
    const value = await body(async () => {
      require(!used && !closed && reason === null, 'PublicationGateExpired');
      used = true;
      child.stdin.end(Buffer.concat([Buffer.from('R'), input]));
      const result = await completion;
      if (result.code !== 0 || result.reason !== null) fail('PublicationDeliveryUnknown');
    });
    require(reason === null && (used || !closed), 'PublicationGateExpired');
    return value;
  } finally {
    if (!closed) child.stdin.end();
    await completion;
  }
}
