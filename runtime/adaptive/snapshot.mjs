// Linux snapshot admission; later work reads only the resulting immutable bytes.
import assert from 'node:assert/strict';
import {openSync, closeSync, fstatSync, readSync, readdirSync, constants} from 'node:fs';
import {digest, same} from './admission.mjs';

export const maximumSnapshotBytes = 16 * 1024 * 1024;
export function pathAllowed(path) {
  return typeof path === 'string' && path.isWellFormed() && path.length > 0 && Buffer.byteLength(path) <= 256 &&
    !/[\x00-\x1f\x7f\\]/.test(path) && path.split('/').every(segment => segment && segment !== '.' && segment !== '..');
}
const order = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));
const unchanged = (left, right) => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => left[key] === right[key]);

export function capture(codec, root) {
  assert.equal(process.platform, 'linux', 'snapshot capture is Linux-qualified only');
  const files = []; let bytes = 0, visited = 0, excluded = 0;
  const flags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | constants.O_NOCTTY;
  function walk(fd, prefix, depth) {
    assert(depth <= 32, 'snapshot depth capacity');
    for (const nameBytes of readdirSync(`/proc/self/fd/${fd}`, {encoding: 'buffer'})) {
      assert(++visited <= 4096, 'snapshot entry capacity');
      const name = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(nameBytes);
      if (['.git', '.zig-cache', 'zig-out', 'node_modules'].includes(name)) { excluded++; continue; }
      const path = prefix ? `${prefix}/${name}` : name;
      assert(pathAllowed(path), 'invalid snapshot path');
      const child = openSync(`/proc/self/fd/${fd}/${name}`, flags);
      try {
        const before = fstatSync(child, {bigint: true});
        if (before.isDirectory()) { walk(child, path, depth + 1); continue; }
        assert(before.isFile(), 'unsupported snapshot entry');
        assert(files.length < 512 && before.size <= 256n * 1024n && before.size <= BigInt(maximumSnapshotBytes - bytes), 'snapshot byte capacity');
        const content = Buffer.alloc(Number(before.size) + 1); let offset = 0;
        while (offset < content.length) { const n = readSync(child, content, offset, content.length - offset, null); if (!n) break; offset += n; }
        assert(BigInt(offset) === before.size && unchanged(before, fstatSync(child, {bigint: true})), 'snapshot changed');
        const contents = content.subarray(0, offset); bytes += offset;
        files.push({path, sha256: digest(contents), contents});
      } finally { closeSync(child); }
    }
  }
  const fd = openSync(root, flags | constants.O_DIRECTORY);
  try { walk(fd, '', 0); } finally { closeSync(fd); }
  files.sort((left, right) => order(left.path, right.path));
  const encoded = codec.encode('Snapshot', {version: 1, excluded_entries: excluded, files});
  assert(encoded.length <= maximumSnapshotBytes, 'snapshot capacity'); return encoded;
}

export function open(codec, bytes) {
  assert(bytes.length <= maximumSnapshotBytes, 'snapshot capacity');
  const record = codec.decode('Snapshot', bytes);
  assert.equal(record.version, 1);
  let previous = null;
  for (const file of record.files) {
    assert(pathAllowed(file.path) && (previous === null || order(previous, file.path) < 0) && same(digest(file.contents), file.sha256), 'invalid snapshot');
    previous = file.path;
  }
  return Object.freeze({identity: digest(bytes), excluded_entries: record.excluded_entries, files: record.files,
    get: path => pathAllowed(path) ? record.files.find(file => file.path === path) ?? null : null});
}

export function list(snapshot, request) {
  const matching = snapshot.files.filter(file => file.path.startsWith(request.prefix) && order(request.after, file.path) < 0);
  const entries = matching.slice(0, 32).map(file => ({path: file.path, bytes: file.contents.length}));
  const truncated = matching.length > entries.length;
  return {entries, truncated, next: truncated ? entries.at(-1).path : ''};
}
export function read(snapshot, request) {
  const invalid = value => ({tag: 'invalid', value});
  if (!pathAllowed(request.path)) return invalid('Invalid logical snapshot path.');
  const file = snapshot.get(request.path);
  if (file === null) return {tag: 'missing', value: request.path};
  if (request.maximum === 0 || request.maximum > 4096 || BigInt(request.start) > BigInt(file.contents.length)) return invalid('Read requires maximum 1..4096 and an offset within the file.');
  const start = Number(request.start), end = start + Math.min(request.maximum, file.contents.length - start);
  let content;
  try { content = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(file.contents.subarray(start, end)); }
  catch { return invalid('Selected byte window is not complete UTF-8; adjust its boundaries.'); }
  return {tag: 'found', value: {snapshot: snapshot.identity, path: file.path, sha256: Buffer.from(file.sha256).toString('hex'),
    start, end, file_bytes: file.contents.length, content}};
}
