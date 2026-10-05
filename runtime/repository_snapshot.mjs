// Immutable managed Git objects and conditional publication under the trusted
// adapter's admission. This owner cannot approve or choose application steps.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { admitDocumentPath } from './document.mjs';
import { canonical } from './mobility/canonical.mjs';
import { withPublicationGate } from './repository_publication_gate.mjs';

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encoded = value => Buffer.from(JSON.stringify(value));
// Large tree inventories are ordered arrays of scalar rows. Ordinary records
// use the existing canonical owner, so JSON member order grants no identity.
const canonicalBytes = value => Array.isArray(value) ? encoded(value) : Buffer.from(canonical(value, 2 << 20));
const digest = value => hash(canonicalBytes(value));
const same = (a, b) => canonicalBytes(a).equals(canonicalBytes(b));
const fail = code => { throw Object.assign(new Error(code), { code }); };
const require = (condition, code) => { if (!condition) fail(code); };
const text = (value, maximum) => typeof value === 'string' && value.isWellFormed() && Buffer.byteLength(value) <= maximum;
const identity = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':');
const modes = new Map([['40000', 'tree'], ['100644', 'blob'], ['100755', 'blob'], ['120000', 'blob'], ['160000', 'commit']]);
const defaults = Object.freeze({ entries: 16384, bytes: 128 << 20, blobBytes: 16 << 20, commandMs: 30000 });
const gitArgs = (root, args) => ['--no-replace-objects',
  '-c', 'core.hooksPath=/dev/null', '-c', 'core.attributesFile=/dev/null',
  '-c', 'credential.helper=', '-c', 'protocol.allow=never', '-c', 'gc.auto=0',
  '-c', 'maintenance.auto=false', ...(root ? [`--git-dir=${root}`] : []), ...args];
const gitEnv = () => ({ PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC', GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
  GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0' });

function path(value) {
  admitDocumentPath(value);
  require(text(value, 256) && !/[\x00-\x1f\x7f]/u.test(value), 'RepositoryPath');
  require(value.split('/').every(part => part.normalize('NFD').toLowerCase() !== '.git'), 'RepositoryPath');
  return value;
}
function paths(values, maximum) {
  require(Array.isArray(values) && values.length <= maximum, 'RepositoryScope');
  const result = values.map(path).sort();
  require(new Set(result).size === result.length, 'RepositoryScope');
  return result;
}
// The qualified filesystem, rather than a guessed Unicode case-fold table,
// decides the remaining aliases. Empty private directories exercise its actual
// name lookup without materializing any repository-controlled bytes or links.
async function filesystemAliases(directory, names, maximumEntries) {
  const scratch = await mkdtemp(join(directory, '.path-admission-'));
  const declared = new Set(), physical = new Map();
  try {
    for (const name of names) {
      const parts = name.split('/');
      for (let length = 1; length <= parts.length; length++) {
        const prefix = parts.slice(0, length).join('/');
        if (declared.has(prefix)) continue;
        require(declared.size < maximumEntries, 'RepositoryTreeCapacity');
        const filename = join(scratch, prefix);
        try { await mkdir(filename, { mode: 0o700 }); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
        const stat = await lstat(filename, { bigint: true });
        require(stat.isDirectory() && !stat.isSymbolicLink(), 'RepositoryPathAlias');
        const key = `${stat.dev}:${stat.ino}`;
        require(!physical.has(key) || physical.get(key) === prefix, 'RepositoryPathAlias');
        physical.set(key, prefix); declared.add(prefix);
      }
    }
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
function oid(value, format) {
  require(typeof value === 'string' && (format === 'sha1' ? /^[a-f0-9]{40}$/ : /^[a-f0-9]{64}$/).test(value), 'RepositoryObjectIdentity');
  return value;
}
function ref(value) {
  require(typeof value === 'string' && /^refs\/heads\/agent\/[a-z0-9][a-z0-9-]{0,63}$/.test(value), 'RepositoryManagedRef');
  return value;
}
function objectId(format, type, bytes) {
  return createHash(format).update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
}
async function readRegular(filename, maximum) {
  const fd = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await fd.stat({ bigint: true });
    require(before.isFile() && before.size <= BigInt(maximum), 'RepositoryStorage');
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await fd.read(bytes, length, bytes.length - length, null);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const after = await fd.stat({ bigint: true });
    require(length === Number(before.size) && identity(before) === identity(after) && identity(after) === identity(await lstat(filename, { bigint: true })), 'RepositoryStorageChanged');
    return bytes.subarray(0, length);
  } finally { await fd.close(); }
}

async function gitExecutable(filename) {
  require(isAbsolute(filename), 'RepositoryGitExecutable');
  const executable = await realpath(filename), before = await lstat(executable, { bigint: true });
  require(before.isFile() && before.size < 128n << 20n, 'RepositoryGitExecutable');
  const sha256 = hash(await readRegular(executable, 128 << 20));
  return { executable, sha256, async unchanged() {
    require(identity(await lstat(executable, { bigint: true })) === identity(before), 'RepositoryGitChanged');
  } };
}

async function command(git, root, args, { input = Buffer.alloc(0), maximum = 4 << 20, timeout = 30000, allowMissing = false } = {}) {
  await git.unchanged();
  return new Promise((resolve, reject) => {
    const child = spawn(git.executable, gitArgs(root, args), {
      env: gitEnv(),
      stdio: ['pipe', 'pipe', 'pipe'], detached: true,
    });
    const chunks = []; let count = 0, stopped = null;
    const stop = code => {
      if (stopped) return;
      stopped = code;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    };
    const timer = setTimeout(() => stop('RepositoryGitTimeout'), timeout);
    for (const [stream, save] of [[child.stdout, true], [child.stderr, false]]) stream.on('data', bytes => {
      count += bytes.length;
      if (count > maximum) stop('RepositoryGitOutputCapacity');
      else if (save) chunks.push(bytes);
    });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stdin.on('error', () => {});
    child.on('close', code => {
      clearTimeout(timer);
      if (stopped || (code !== 0 && !(allowMissing && code === 1))) reject(Object.assign(new Error(stopped ?? 'RepositoryGitFailed'), { code: stopped ?? 'RepositoryGitFailed' }));
      else resolve(code === 0 ? Buffer.concat(chunks) : null);
    });
    child.stdin.end(input);
  });
}

async function objects(git, root, format, limits) {
  async function read(type, name) {
    oid(name, format);
    const size = Number((await command(git, root, ['cat-file', '-s', name], { timeout: limits.commandMs })).toString().trim());
    require(Number.isSafeInteger(size) && size >= 0 && size <= limits.blobBytes, 'RepositoryObjectCapacity');
    const bytes = await command(git, root, ['cat-file', type, name], { maximum: limits.blobBytes + 65536, timeout: limits.commandMs });
    require(bytes.length === size && objectId(format, type, bytes) === name, 'RepositoryObjectIntegrity');
    return bytes;
  }
  async function write(type, bytes) {
    require(bytes.length <= limits.blobBytes, 'RepositoryObjectCapacity');
    const name = (await command(git, root, ['hash-object', '-w', '-t', type, '--stdin'], { input: bytes, timeout: limits.commandMs })).toString().trim();
    require(name === objectId(format, type, bytes), 'RepositoryObjectIntegrity');
    return name;
  }
  async function tree(name, copy = null) {
    const rows = [], names = [], budget = { entries: 0, bytes: 0 };
    async function walk(id, prefix, depth) {
      require(depth <= 32, 'RepositoryTreeCapacity');
      const bytes = await read('tree', id);
      budget.bytes += bytes.length;
      require(budget.bytes <= limits.bytes, 'RepositoryTreeCapacity');
      if (copy) require(await copy.write('tree', bytes) === id, 'RepositoryObjectIntegrity');
      const entries = new Map();
      for (let offset = 0; offset < bytes.length;) {
        require(++budget.entries <= limits.entries, 'RepositoryTreeCapacity');
        const space = bytes.indexOf(32, offset), zero = bytes.indexOf(0, space + 1), width = format === 'sha1' ? 20 : 32;
        require(space > offset && zero > space && zero + 1 + width <= bytes.length, 'RepositoryTreeInvalid');
        const mode = bytes.subarray(offset, space).toString('ascii'), leaf = utf8.decode(bytes.subarray(space + 1, zero));
        require(modes.has(mode) && !leaf.includes('/') && !entries.has(leaf), 'RepositoryTreeInvalid');
        const filename = path(prefix ? `${prefix}/${leaf}` : leaf), object = bytes.subarray(zero + 1, zero + 1 + width).toString('hex');
        offset = zero + 1 + width; names.push(filename);
        if (mode === '40000') entries.set(leaf, { mode, oid: object, children: await walk(object, filename, depth + 1) });
        else if (mode === '160000') {
          rows.push([filename, mode, object, 0, null]); entries.set(leaf, { mode, oid: object });
        } else {
          const content = await read('blob', object);
          budget.bytes += content.length;
          require(budget.bytes <= limits.bytes, 'RepositoryTreeCapacity');
          if (copy) require(await copy.write('blob', content) === object, 'RepositoryObjectIntegrity');
          rows.push([filename, mode, object, content.length, hash(content)]);
          entries.set(leaf, { mode, oid: object });
        }
      }
      return entries;
    }
    const entries = await walk(name, '', 0);
    rows.sort((a, b) => Buffer.compare(Buffer.from(a[0]), Buffer.from(b[0])));
    return { entries, rows, names, bytes: budget.bytes };
  }
  async function saveTree(entries, persist = true) {
    const rows = [...entries].sort(([an, a], [bn, b]) => Buffer.compare(Buffer.from(an + (a.children ? '/' : '')), Buffer.from(bn + (b.children ? '/' : ''))));
    const bytes = [];
    for (const [name, entry] of rows) {
      const id = entry.children ? await saveTree(entry.children, persist) : entry.oid;
      bytes.push(Buffer.from(`${entry.mode} ${name}\0`), Buffer.from(id, 'hex'));
    }
    const content = Buffer.concat(bytes);
    return persist ? write('tree', content) : objectId(format, 'tree', content);
  }
  return { read, write, tree, saveTree };
}

/** Privileged local provisioning, never reachable from a model leaf. The source
 * is an existing Git directory and an exact commit, not a URL or fetch ref. */
export async function provisionRepository({ directory, sourceGitDirectory, base, gitExecutable: executable, repository, generation, managedRef, readPaths, writablePaths, protectedPaths = [], limits = defaults }) {
  require(isAbsolute(directory) && isAbsolute(sourceGitDirectory), 'RepositoryDirectory');
  require(text(repository, 128) && repository && text(generation, 128) && generation, 'RepositoryIdentity');
  ref(managedRef);
  const reads = paths(readPaths, 4096), writes = paths(writablePaths, 4), protectedSet = paths(protectedPaths, 4096);
  require(writes.every(name => reads.includes(name) && !protectedSet.includes(name)), 'RepositoryScope');
  for (const key of Object.keys(defaults)) require(Number.isSafeInteger(limits[key]) && limits[key] > 0 && limits[key] <= defaults[key], 'RepositoryLimits');
  require(Object.keys(limits).length === Object.keys(defaults).length, 'RepositoryLimits');
  const git = await gitExecutable(executable);
  const source = await realpath(sourceGitDirectory);
  require((await lstat(source)).isDirectory(), 'RepositoryDirectory');
  const format = (await command(git, source, ['rev-parse', '--show-object-format'])).toString().trim();
  require(['sha1', 'sha256'].includes(format), 'RepositoryObjectFormat'); oid(base, format);
  const input = await objects(git, source, format, limits);
  const commit = await input.read('commit', base);
  const tree = oid(commit.toString('utf8').match(/^tree ([a-f0-9]+)\n/)?.[1], format);
  // Only a freshly reserved directory may be initialized or removed on failure.
  await mkdir(directory, { mode: 0o700 });
  try {
    const destination = join(directory, 'objects.git');
    await command(git, null, ['init', '--bare', '--template=', `--object-format=${format}`, destination]);
    const output = await objects(git, destination, format, limits);
    const imported = await input.tree(tree, output), byPath = new Map(imported.rows.map(row => [row[0], row]));
    await filesystemAliases(directory, [...imported.names, ...reads], limits.entries);
    for (const name of reads) {
      const entry = byPath.get(name);
      if (!entry) continue; // An explicitly absent write path supports create.
      require(['100644', '100755'].includes(entry[1]), 'RepositoryUnsupportedMode');
      const content = await output.read('blob', entry[2]);
      require(!content.includes(0), 'RepositoryBinary'); utf8.decode(content);
      if (writes.includes(name)) require(entry[1] === '100644' && content.length <= 32768, 'RepositoryEditableCapacity');
    }
    require(await output.write('commit', commit) === base, 'RepositoryObjectIntegrity');
    await writeFile(join(destination, 'shallow'), `${base}\n`, { flag: 'wx', mode: 0o600 });
    await command(git, destination, ['update-ref', '--no-deref', managedRef, base, '0'.repeat(base.length)]);
    const gate = await open(join(directory, 'publication.lock'), 'wx', 0o600);
    let publicationLock;
    try {
      await gate.sync();
      const stat = await gate.stat({ bigint: true });
      publicationLock = { dev: String(stat.dev), ino: String(stat.ino) };
    } finally { await gate.close(); }
    const metadata = { format: 'agent-managed-repository/v1', repository, generation, objectFormat: format, base, managedRef,
      readPaths: reads, writablePaths: writes, protectedPaths: protectedSet, limits, gitSha256: git.sha256,
      gitConfigSha256: hash(await readRegular(join(destination, 'config'), 65536)), publicationLock };
    const fd = await open(join(directory, 'repository.json'), 'wx', 0o600);
    try { await fd.writeFile(encoded(metadata)); await fd.sync(); } finally { await fd.close(); }
    return { repository, generation, base, managedRef, manifestSha256: hash(encoded(metadata)) };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}

export async function openRepositorySnapshotStore({ directory, gitExecutable: executable, repository, generation, manifestSha256 }) {
  require(isAbsolute(directory), 'RepositoryDirectory');
  const root = await lstat(directory, { bigint: true });
  require(root.isDirectory() && !root.isSymbolicLink() && (root.mode & 0o077n) === 0n, 'RepositoryDirectory');
  const metadataBytes = await readRegular(join(directory, 'repository.json'), 8 << 20);
  require(hash(metadataBytes) === manifestSha256, 'RepositoryMetadataIntegrity');
  const metadata = JSON.parse(utf8.decode(metadataBytes));
  require(metadata.format === 'agent-managed-repository/v1' && metadata.repository === repository && metadata.generation === generation, 'RepositoryIdentity');
  const git = await gitExecutable(executable);
  require(git.sha256 === metadata.gitSha256, 'RepositoryGitChanged');
  const gitRoot = join(directory, 'objects.git'), object = await objects(git, gitRoot, metadata.objectFormat, metadata.limits);
  const directories = await Promise.all([gitRoot, join(gitRoot, 'objects')].map(async path => {
    const stat = await lstat(path, { bigint: true });
    require(stat.isDirectory() && !stat.isSymbolicLink(), 'RepositoryStorageChanged');
    return { path, stat };
  }));
  const scopeDigest = digest([metadata.readPaths, metadata.writablePaths, metadata.protectedPaths]);
  async function unchanged() {
    const now = await lstat(directory, { bigint: true });
    require(now.dev === root.dev && now.ino === root.ino && now.isDirectory() && !now.isSymbolicLink(), 'RepositoryStorageChanged');
    for (const entry of directories) {
      const actual = await lstat(entry.path, { bigint: true });
      require(actual.dev === entry.stat.dev && actual.ino === entry.stat.ino && actual.isDirectory() && !actual.isSymbolicLink(), 'RepositoryStorageChanged');
    }
    require((await readRegular(join(directory, 'repository.json'), 8 << 20)).equals(metadataBytes), 'RepositoryStorageChanged');
    require(hash(await readRegular(join(gitRoot, 'config'), 65536)) === metadata.gitConfigSha256, 'RepositoryStorageChanged');
    require((await readRegular(join(gitRoot, 'shallow'), 256)).toString() === `${metadata.base}\n`, 'RepositoryStorageChanged');
    for (const path of ['objects/info/alternates', 'info/grafts', 'config.worktree', 'worktrees']) {
      try { await lstat(join(gitRoot, path)); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      fail('RepositoryStorageChanged');
    }
  }
  async function current() {
    await unchanged();
    const symbolic = await command(git, gitRoot, ['symbolic-ref', '-q', ref(metadata.managedRef)], { allowMissing: true });
    require(symbolic === null, 'RepositorySymbolicRef');
    return oid((await command(git, gitRoot, ['show-ref', '--verify', '--hash', metadata.managedRef])).toString().trim(), metadata.objectFormat);
  }
  async function snapshot(base) {
    await unchanged(); oid(base, metadata.objectFormat);
    require(base === metadata.base || base === await current(), 'RepositoryBaseDenied');
    const commit = await object.read('commit', base), tree = oid(commit.toString('utf8').match(/^tree ([a-f0-9]+)\n/)?.[1], metadata.objectFormat);
    const observed = await object.tree(tree);
    return { repository, generation, objectFormat: metadata.objectFormat, base, tree,
      manifest: digest([tree, observed.rows]), scopeManifest: scopeDigest };
  }
  async function admitSnapshot(value) {
    await unchanged();
    require(value && value.repository === repository && value.generation === generation && value.objectFormat === metadata.objectFormat && value.scopeManifest === scopeDigest, 'RepositorySnapshotMismatch');
    const base = oid(value.base, metadata.objectFormat), commit = await object.read('commit', base);
    const tree = oid(commit.toString('utf8').match(/^tree ([a-f0-9]+)\n/)?.[1], metadata.objectFormat);
    require(value.tree === tree, 'RepositorySnapshotMismatch');
    const observed = await object.tree(tree);
    require(same(value, { repository, generation, objectFormat: metadata.objectFormat, base, tree, manifest: digest([tree, observed.rows]), scopeManifest: scopeDigest }), 'RepositorySnapshotMismatch');
    return observed;
  }
  function admittedPath(name, writable = false) {
    path(name); require((writable ? metadata.writablePaths : metadata.readPaths).includes(name), 'RepositoryPathDenied');
    return name;
  }
  function cursor(snapshot, query, value) {
    if (value === null) return 0;
    require(text(value, 2048), 'RepositoryCursor');
    let decoded;
    try { decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); } catch { fail('RepositoryCursor'); }
    require(Array.isArray(decoded) && decoded.length === 3 && decoded[0] === digest(snapshot) && decoded[1] === digest(query) && Number.isSafeInteger(decoded[2]) && decoded[2] >= 0, 'RepositoryCursor');
    return decoded[2];
  }
  const nextCursor = (snapshot, query, position) => encoded([digest(snapshot), digest(query), position]).toString('base64url');
  async function list(selected, { prefix = '', after = null } = {}) {
    require(text(prefix, 256), 'RepositoryQuery');
    const view = await admitSnapshot(selected), query = ['list', prefix], offset = cursor(selected, query, after);
    const rows = view.rows.filter(row => metadata.readPaths.includes(row[0]) && row[0].startsWith(prefix));
    require(offset <= rows.length, 'RepositoryCursor');
    const entries = rows.slice(offset, offset + 32), end = offset + entries.length;
    return { entries, cursor: end < rows.length ? nextCursor(selected, query, end) : null, total: rows.length };
  }
  async function read(selected, name, { offset = 0, maximum = 32768 } = {}) {
    admittedPath(name);
    require(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(maximum) && maximum > 0 && maximum <= 32768, 'RepositoryReadBounds');
    const view = await admitSnapshot(selected), row = view.rows.find(row => row[0] === name);
    require(row && ['100644', '100755'].includes(row[1]), 'RepositoryFileUnavailable');
    const bytes = await object.read('blob', row[2]);
    require(!bytes.includes(0), 'RepositoryBinary'); utf8.decode(bytes);
    require(offset <= bytes.length && (offset === bytes.length || (bytes[offset] & 0xc0) !== 0x80), 'RepositoryReadBounds');
    let end = Math.min(bytes.length, offset + maximum);
    while (end > offset && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    require(end > offset || offset === bytes.length, 'RepositoryReadBounds');
    return { snapshot: selected.manifest, path: name, digest: row[4], content: utf8.decode(bytes.subarray(offset, end)), offset, nextOffset: end, bytes: bytes.length, truncated: offset !== 0 || end !== bytes.length };
  }
  async function prepare(selected, edits, persist = true) {
    const view = await admitSnapshot(selected);
    require(Array.isArray(edits) && edits.length > 0 && edits.length <= 4, 'RepositoryEdits');
    require(new Set(edits.map(edit => edit?.path)).size === edits.length, 'RepositoryDuplicateEdit');
    let replacementBytes = 0;
    const canonicalEdits = [];
    for (const edit of edits) {
      require(edit && same(Object.keys(edit).sort(), ['content', 'oldDigest', 'oldMode', 'operation', 'path']), 'RepositoryEditShape');
      const name = admittedPath(edit.path, true), original = view.rows.find(row => row[0] === name);
      require(['create', 'replace', 'delete'].includes(edit.operation), 'RepositoryEditOperation');
      require(edit.operation === 'create' ? !original && edit.oldDigest === null && edit.oldMode === null : original?.[1] === '100644' && edit.oldMode === '100644' && original[4] === edit.oldDigest, 'RepositoryPreimage');
      if (edit.operation === 'delete') require(edit.content === null, 'RepositoryEditShape');
      else {
        require(text(edit.content, 32768) && !edit.content.includes('\0'), 'RepositoryReplacement');
        replacementBytes += Buffer.byteLength(edit.content);
        require(replacementBytes <= 128 << 10, 'RepositoryReplacementCapacity');
      }
      const newDigest = edit.content === null ? null : hash(Buffer.from(edit.content));
      require(newDigest !== edit.oldDigest, 'RepositoryNoChange');
      canonicalEdits.push({ operation: edit.operation, path: name, oldDigest: edit.oldDigest, oldMode: edit.oldMode,
        content: edit.content, newMode: edit.operation === 'delete' ? null : '100644', newDigest });
    }
    canonicalEdits.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
    for (const edit of canonicalEdits) {
      const parts = edit.path.split('/'), parents = []; let entries = view.entries;
      for (const part of parts.slice(0, -1)) {
        if (!entries.has(part)) entries.set(part, { mode: '40000', children: new Map() });
        const entry = entries.get(part); require(entry.children, 'RepositoryPathConflict');
        parents.push([entries, part]); entries = entry.children;
      }
      const leaf = parts.at(-1);
      require(!entries.get(leaf)?.children, 'RepositoryPathConflict');
      if (edit.operation === 'delete') {
        entries.delete(leaf);
        for (const [parent, part] of parents.reverse()) {
          if (parent.get(part).children.size) break;
          parent.delete(part);
        }
      } else {
        const bytes = Buffer.from(edit.content);
        entries.set(leaf, { mode: '100644', oid: persist ? await object.write('blob', bytes) : objectId(metadata.objectFormat, 'blob', bytes) });
      }
    }
    const tree = await object.saveTree(view.entries, persist), result = await object.tree(tree);
    const before = new Map(view.rows.map(row => [row[0], row])), after = new Map(result.rows.map(row => [row[0], row]));
    const changed = [...new Set([...before.keys(), ...after.keys()])].filter(name => !same(before.get(name) ?? null, after.get(name) ?? null)).sort();
    require(same(changed, canonicalEdits.map(edit => edit.path).sort()), 'RepositoryTreeDelta');
    for (const edit of canonicalEdits) require(edit.operation === 'delete' ? !after.has(edit.path) : after.get(edit.path)?.[1] === edit.newMode && after.get(edit.path)?.[4] === edit.newDigest, 'RepositoryTreeDelta');
    const core = { snapshot: selected, edits: canonicalEdits, tree, manifest: digest([tree, result.rows]) };
    return { ...core, id: digest(core) };
  }
  async function search(selected, { query, prefix = '', after = null }) {
    require(text(query, 256) && query.length > 0 && text(prefix, 256), 'RepositoryQuery');
    const view = await admitSnapshot(selected), binding = ['search', query, prefix], offset = cursor(selected, binding, after);
    const entries = []; let found = 0;
    for (const row of view.rows) {
      if (!metadata.readPaths.includes(row[0]) || !row[0].startsWith(prefix)) continue;
      require(['100644', '100755'].includes(row[1]), 'RepositoryUnsupportedMode');
      const bytes = await object.read('blob', row[2]); require(!bytes.includes(0), 'RepositoryBinary');
      const content = utf8.decode(bytes);
      for (let start = 0, line = 1; start <= content.length; line++) {
        const newline = content.indexOf('\n', start), end = newline < 0 ? content.length : newline;
        const text = content.slice(start, end);
        if (text.includes(query)) {
          if (found++ >= offset) {
            if (entries.length === 32) return { entries, cursor: nextCursor(selected, binding, offset + entries.length), truncated: true };
            let excerpt = '', length = 0;
            for (const scalar of text) {
              length += Buffer.byteLength(scalar); if (length > 256) break;
              excerpt += scalar;
            }
            entries.push({ path: row[0], digest: row[4], line, excerpt, truncated: excerpt.length !== text.length });
          }
        }
        if (newline < 0) break;
        start = newline + 1;
      }
    }
    require(offset <= found, 'RepositoryCursor');
    return { entries, cursor: null, truncated: entries.some(entry => entry.truncated) };
  }
  async function verifyCandidate(candidate) {
    require(candidate && Array.isArray(candidate.edits), 'RepositoryCandidate');
    const rebuilt = await prepare(candidate.snapshot, candidate.edits.map(edit => ({
      operation: edit.operation, path: edit.path, oldDigest: edit.oldDigest, oldMode: edit.oldMode, content: edit.content,
    })), false);
    require(same(candidate, rebuilt), 'RepositoryCandidateMismatch');
    return rebuilt;
  }
  // Check inputs come from the same authenticated object view as evidence and
  // candidate preparation. Never reconstruct them from a mutable checkout or
  // a truncated read response. The deployment chooses the finite required set.
  async function checkInputs({ snapshot: selected, candidate = null, requiredPaths }) {
    const names = paths(requiredPaths, 4096);
    require(names.length > 0, 'RepositoryScope');
    const view = candidate ? await object.tree((await verifyCandidate(candidate)).tree) : await admitSnapshot(selected);
    if (candidate) require(same(candidate.snapshot, selected), 'RepositorySnapshotMismatch');
    const files = Object.create(null);
    let bytes = 0;
    for (const name of names) {
      admittedPath(name);
      const row = view.rows.find(row => row[0] === name);
      require(row && ['100644', '100755'].includes(row[1]), 'RepositoryFileUnavailable');
      const content = await object.read('blob', row[2]);
      bytes += content.length;
      require(bytes <= metadata.limits.bytes, 'RepositoryTreeCapacity');
      require(!content.includes(0), 'RepositoryBinary'); utf8.decode(content);
      files[name] = content;
    }
    return { snapshot: selected, candidate: candidate?.id ?? null, tree: candidate?.tree ?? selected.tree, files };
  }
  async function publicationCore(candidate, binding, validation, commit) {
    const fields = (value, names) => value && same(Object.keys(value).sort(), [...names].sort());
    require(fields(binding, ['run', 'task', 'generation', 'principal', 'tenant', 'intent', 'policyRevision', 'authorizationDigest', 'validationPolicyDigest']), 'RepositoryPublicationBinding');
    for (const [name, value] of Object.entries(binding)) require(text(value, 128) && value.length > 0 &&
      (name.endsWith('Digest') ? /^[a-f0-9]{64}$/.test(value) : !/[\x00-\x1f\x7f]/u.test(value)), 'RepositoryPublicationBinding');
    require(/^[a-f0-9]{64}$/.test(binding.intent), 'RepositoryPublicationIntent');
    require(fields(commit, ['author', 'committer', 'timestamp', 'message']), 'RepositoryCommitMetadata');
    for (const person of [commit.author, commit.committer]) require(fields(person, ['name', 'email']) &&
      text(person.name, 128) && person.name.trim() === person.name && person.name.length > 0 &&
      text(person.email, 254) && /^[^\s<>@]+@[^\s<>@]+$/.test(person.email) &&
      !/[<>\x00-\x1f\x7f]/u.test(person.name), 'RepositoryCommitMetadata');
    require(Number.isSafeInteger(commit.timestamp) && commit.timestamp >= 0 && commit.timestamp <= 253402300799 &&
      text(commit.message, 4096) && commit.message.length > 0 && !commit.message.includes('\0'), 'RepositoryCommitMetadata');
    require(Array.isArray(validation) && validation.length > 0 && validation.length <= 16 &&
      new Set(validation.map(row => row.profile)).size === validation.length, 'RepositoryPublicationValidation');
    for (const record of validation) {
      const { id, ...body } = record;
      require(record.format === 'agent.repository.check/v1' && digest(body) === id && record.status === 'Passed' &&
        record.candidate === candidate.id && record.tree === candidate.tree && same(record.snapshot, candidate.snapshot) &&
        same(record.completedChecks, [record.profile]), 'RepositoryPublicationValidation');
    }
    const before = await admitSnapshot(candidate.snapshot), diff = [];
    for (const edit of candidate.edits) {
      const row = before.rows.find(row => row[0] === edit.path);
      diff.push({ path: edit.path, operation: edit.operation, oldContent: row ? utf8.decode(await object.read('blob', row[2])) : null, newContent: edit.content });
    }
    return { format: 'agent.repository.proposal-core/v1', candidate, binding, validation, diff,
      destination: { repository, generation, managedRef: metadata.managedRef, expectedBase: candidate.snapshot.base }, commit };
  }
  function publicationCommit(core, coreDigest) {
    const { commit, candidate, binding } = core;
    const who = person => `${person.name} <${person.email}> ${commit.timestamp} +0000`;
    return Buffer.from(`tree ${candidate.tree}\nparent ${candidate.snapshot.base}\nauthor ${who(commit.author)}\ncommitter ${who(commit.committer)}\nagent-proposal-core ${coreDigest}\nagent-publication-intent ${binding.intent}\n\n${commit.message}\n`);
  }
  // Preparation precedes protected approval. This constructs immutable data;
  // neither an OID nor a self-consistent digest grants publication authority.
  async function preparePublication(input) {
    const { candidate, binding, validation, commit } = structuredClone(input);
    await verifyCandidate(candidate);
    const core = await publicationCore(candidate, binding, validation, commit), coreDigest = digest(core);
    const bytes = publicationCommit(core, coreDigest), commitOid = await object.write('commit', bytes);
    const proposal = { core, coreDigest, commitOid, commitSha256: hash(bytes) };
    return { ...proposal, digest: digest(proposal) };
  }
  async function verifyPublication(input) {
    const proposal = structuredClone(input);
    require(proposal?.core?.candidate, 'RepositoryPublicationProposal');
    const { candidate, binding, validation, commit } = proposal.core;
    await verifyCandidate(candidate);
    const core = await publicationCore(candidate, binding, validation, commit), coreDigest = digest(core);
    const bytes = publicationCommit(core, coreDigest), commitOid = objectId(metadata.objectFormat, 'commit', bytes);
    const expected = { core, coreDigest, commitOid, commitSha256: hash(bytes) };
    require(same(proposal, { ...expected, digest: digest(expected) }) &&
      (await object.read('commit', commitOid)).equals(bytes), 'RepositoryPublicationMismatch');
    return proposal;
  }
  // Trusted publisher-only operations. The application receives neither this
  // store nor a callable commit capability. Its one protected publication leaf
  // supplies the current-custody admission callback; Git itself owns the gate
  // after that callback persists the occurrence's exact intent.
  async function publicationGate(proposal, helper, body) {
    require(metadata.publicationLock && /^\d+$/.test(metadata.publicationLock.dev) && /^\d+$/.test(metadata.publicationLock.ino), 'RepositoryPublicationUnavailable');
    await unchanged();
    return withPublicationGate({ helper, lock: { path: join(directory, 'publication.lock'), ...metadata.publicationLock },
      command: { path: git.executable, sha256: git.sha256, args: gitArgs(gitRoot, ['update-ref', '--no-deref', '--stdin']),
        env: gitEnv(), input: Buffer.from(`update ${ref(metadata.managedRef)} ${oid(proposal.commitOid, metadata.objectFormat)} ${oid(proposal.core.candidate.snapshot.base, metadata.objectFormat)}\n`) },
      timeoutMs: metadata.limits.commandMs }, body);
  }
  async function publishManaged(input, helper, admit, history) {
    const proposal = structuredClone(input);
    return publicationGate(proposal, helper, async publish => {
      await verifyPublication(proposal);
      require(typeof history === 'function', 'RepositoryPublicationHistory');
      const records = await history();
      const { head: actual } = await publicationHistory(proposal, records.proposals, records.publishedCommits);
      if (actual !== proposal.core.destination.expectedBase) return { status: 'Conflict', proposal: proposal.digest, current: actual };
      // Admission and cancellation serialize in the custody journal. Returning
      // from admission means the immutable intent is durable before Git starts.
      const admission = await admit(proposal);
      await publish();
      // A completed Git write remains published even if its later observation
      // fails. Verification is evidence about that write, never another write.
      const observed = await publicationVerification(proposal);
      return { status: 'Published', proposal: proposal.digest, commit: proposal.commitOid, ...observed, admission };
    });
  }
  async function publicationVerification(proposal, historicalHead = null) {
    let head = null;
    try {
      head = historicalHead ?? await current();
      if (historicalHead === null && head !== proposal.commitOid)
        return { current: head, verification: { status: 'PublishedVerificationFailed', reason: 'ManagedRefMismatch' } };
      const commit = await object.read('commit', proposal.commitOid);
      require(hash(commit) === proposal.commitSha256 &&
        commit.toString('utf8').startsWith(`tree ${proposal.core.candidate.tree}\n`), 'RepositoryPublicationMismatch');
      await object.tree(proposal.core.candidate.tree);
      return { current: head, verification: { status: 'PublishedVerified' } };
    } catch (error) {
      const failed = ['RepositoryObjectIntegrity', 'RepositoryPublicationMismatch', 'RepositoryTreeInvalid'].includes(error.code);
      return { current: head, verification: { status: failed ? 'PublishedVerificationFailed' : 'PublishedVerificationUnavailable',
        reason: /^[A-Za-z0-9_]{1,80}$/.test(error.code ?? '') ? error.code : 'VerificationReadFailed' } };
    }
  }
  async function publicationHistory(proposal, knownProposals, publishedCommits) {
    require(Array.isArray(knownProposals) && knownProposals.length <= 10000 &&
      Array.isArray(publishedCommits) && publishedCommits.length <= 10000, 'RepositoryPublicationHistory');
    const known = new Map(knownProposals.map(row => [row.commitOid, structuredClone(row)]));
    require(known.size === knownProposals.length, 'RepositoryPublicationHistory');
    const head = await current();
    let cursor = head, found = false;
    const seen = new Set();
    while (cursor !== metadata.base) {
      require(seen.size < 10000 && !seen.has(cursor), 'RepositoryPublicationHistory'); seen.add(cursor);
      const entry = known.get(cursor);
      require(entry, 'RepositoryPublicationHistory');
      // Each ancestor must be a saved exact intent with one bound parent.
      await verifyPublication(entry);
      if (cursor === proposal.commitOid) found = true;
      cursor = entry.core.destination.expectedBase;
    }
    require(publishedCommits.every(commit => seen.has(commit)), 'RepositoryPublicationHistory');
    return { head, found };
  }
  async function reconcilePublication(input, helper, knownProposals, publishedCommits = []) {
    const proposal = structuredClone(input);
    require(Array.isArray(knownProposals) && knownProposals.some(row => same(row, proposal)), 'RepositoryPublicationHistory');
    return publicationGate(proposal, helper, async () => {
      await verifyPublication(proposal);
      const { head, found } = await publicationHistory(proposal, knownProposals, publishedCommits);
      return { status: found ? 'Published' : head === proposal.core.destination.expectedBase ? 'NotApplied' : 'Conflict',
        proposal: proposal.digest, commit: found ? proposal.commitOid : null,
        ...(found ? await publicationVerification(proposal, head) : { current: head }) };
    });
  }
  await current();
  return Object.freeze({ snapshot, list, read, search, prepare, verifyCandidate, checkInputs, current,
    preparePublication, verifyPublication, publishManaged, reconcilePublication });
}
