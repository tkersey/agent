import { repositoryWriteHelper } from './repository_storage_fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { link, mkdtemp, mkdir, readdir, writeFile, readFile, rm, realpath, symlink, access, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { reserveRepositoryScratch } from '../../runtime/repository_zig_sandbox.mjs';
import { provisionRepository, openRepositorySnapshotStore } from '../../runtime/repository_snapshot.mjs';
import { createManagedRepositoryEnvironment } from '../../runtime/repository.mjs';
import { canonical } from '../../runtime/mobility/canonical.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' } }).trim();
async function fixture(t, { format = 'sha1', extra = null, configure = null, storage = undefined, fileCount = 4 } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'repository snapshot-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source'); await mkdir(source);
  git(source, 'init', '--quiet', `--object-format=${format}`);
  const contents = new Map(Array.from({ length: fileCount }, (_, i) => [`file-${String(i).padStart(2, '0')}.txt`, `line ${i}: needle\n`]));
  contents.set('protected.test.mjs', 'throw new Error("independent check");\n');
  contents.set('unicode.txt', '🙂'.repeat(9000));
  for (const [name, content] of contents) await writeFile(join(source, name), content);
  await extra?.(source);
  git(source, 'add', '.'); git(source, 'commit', '--quiet', '-m', 'immutable fixture');
  const base = git(source, 'rev-parse', 'HEAD');
  await configure?.(source);
  const executable = await realpath(execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim());
  const options = { ...(storage ? { storage } : {}), writeHelper: await repositoryWriteHelper(), directory: join(root, 'managed'), sourceGitDirectory: join(source, '.git'), base,
    gitExecutable: executable, repository: 'fixture', generation: 'generation-1', managedRef: 'refs/heads/agent/delivery',
    readPaths: [...contents.keys(), 'new/nested.txt'], writablePaths: ['file-00.txt', 'file-01.txt', 'file-03.txt', 'new/nested.txt'], protectedPaths: ['protected.test.mjs'] };
  const receipt = await provisionRepository(options);
  const store = await openRepositorySnapshotStore({ writeHelper: await repositoryWriteHelper(), ...options, ...receipt });
  return { root, source, contents, base, options, receipt, store };
}
const replacement = (f, path, content) => ({ operation: 'replace', path, oldDigest: hash(f.contents.get(path)), oldMode: '100644', content });

test('immutable snapshots and portable queries paginate, bind cursors and retain exact source after a live branch moves', async t => {
  const f = await fixture(t, { fileCount: 33 }), selected = await f.store.snapshot(f.base);
  const first = await f.store.list(selected); assert.equal(first.entries.length, 32); assert(first.cursor);
  const second = await f.store.list(selected, { after: first.cursor });
  assert.equal(first.entries.length + second.entries.length, 35); assert.equal(second.cursor, null);
  assert.equal(new Set([...first.entries, ...second.entries].map(row => row[0])).size, 35);
  await assert.rejects(f.store.list(selected, { prefix: 'file-', after: first.cursor }), { code: 'RepositoryCursor' });
  await assert.rejects(f.store.list({ ...selected, generation: 'different' }, { after: first.cursor }), { code: 'RepositorySnapshotMismatch' });
  const search = await f.store.search(selected, { query: 'needle' }); assert.equal(search.entries.length, 32); assert(search.cursor);
  const rest = await f.store.search(selected, { query: 'needle', after: search.cursor }); assert.equal(rest.entries.length, 1); assert.equal(rest.cursor, null);
  await assert.rejects(f.store.search(selected, { query: 'another', after: search.cursor }), { code: 'RepositoryCursor' });
  const excerpt = await f.store.read(selected, 'unicode.txt'); assert.equal(excerpt.truncated, true); assert.equal(excerpt.nextOffset, 32768); assert.equal(excerpt.content, '🙂'.repeat(8192));
  const tail = await f.store.read(selected, 'unicode.txt', { offset: excerpt.nextOffset }); assert.equal(tail.content, '🙂'.repeat(808)); assert.equal(tail.truncated, true);
  await assert.rejects(f.store.read(selected, 'unicode.txt', { offset: 1 }), { code: 'RepositoryReadBounds' });
  await writeFile(join(f.source, 'file-00.txt'), 'later checkout content\n');
  git(f.source, 'add', '.'); git(f.source, 'commit', '--quiet', '-m', 'advance original');
  assert.equal((await f.store.read(selected, 'file-00.txt')).content, f.contents.get('file-00.txt'));
  assert.equal(await f.store.current(), f.base);
  {
    const leaf = await createManagedRepositoryEnvironment({ ...f.options, ...f.receipt, resourceOwner: 'workspace', classification: ['shared'] });
    const selected = await leaf.snapshot(['fixture', f.base]);
    const first = await leaf.list([selected, '', '']);
    const last = await leaf.list([selected, '', first[2]]);
    assert.deepEqual(first[0], selected[5]);
    assert.equal(first[1].length, 32); assert.equal(last[1].length, 3);
    assert.equal(last[2], ''); assert.equal(last[3], 35);
    const entry = first[1].find(row => row[0] === 'file-00.txt');
    assert.equal(entry[1], '100644');
    assert.equal(entry[3], Buffer.byteLength(f.contents.get(entry[0])));
    assert.equal(Buffer.from(entry[4]).toString('hex'), hash(f.contents.get(entry[0])));
    await assert.rejects(leaf.list([selected, 'file-', first[2]]), { code: 'RepositoryCursor' });
    const hits = await leaf.search([selected, 'needle', '', '']);
    const tail = await leaf.search([selected, 'needle', '', hits[2]]);
    assert.deepEqual(hits[0], selected[5]); assert.equal(hits[1].length + tail[1].length, 33);
    assert.equal(tail[2], ''); assert.equal(tail[3], false);
    await assert.rejects(leaf.search([selected, 'changed', '', hits[2]]), { code: 'RepositoryCursor' });
    const head = await leaf.readWindow([selected, 'unicode.txt', 0n, 32767]);
    const rest = await leaf.readWindow([selected, 'unicode.txt', BigInt(head[2]), 32768]);
    assert.equal(head[2], 32764); assert.equal(rest[2], 36000); assert.equal(rest[3], 36000);
    assert.equal(head[0][3] + rest[0][3], f.contents.get('unicode.txt'));
    await assert.rejects(leaf.readWindow([selected, 'unicode.txt', 1n, 32768]), { code: 'RepositoryReadBounds' });
    await assert.rejects(leaf.readWindow([selected, 'unicode.txt', 2n ** 63n, 32768]), /query bounds/);
    for (const method of ['list', 'search', 'readWindow']) {
      const forged = structuredClone(selected); forged[8] = 'other-owner';
      const input = method === 'list' ? [forged, '', ''] : method === 'search' ? [forged, 'needle', '', ''] : [forged, 'unicode.txt', 0, 1];
      await assert.rejects(leaf[method](input), /binding mismatch/);
    }
  }
});

for (const format of ['sha1', 'sha256']) test(`${format}: create/replace/delete construct exactly one candidate tree without changing either delivery target or checkout`, async t => {
  const f = await fixture(t, { format }), selected = await f.store.snapshot(f.base);
  const edits = [replacement(f, 'file-00.txt', 'replacement\n'),
    replacement(f, 'file-03.txt', 'another source\n'),
    { operation: 'delete', path: 'file-01.txt', oldDigest: hash(f.contents.get('file-01.txt')), oldMode: '100644', content: null },
    { operation: 'create', path: 'new/nested.txt', oldDigest: null, oldMode: null, content: 'new source\n' }];
  const candidate = await f.store.prepare(selected, edits);
  assert.deepEqual(await f.store.verifyCandidate(candidate), candidate);
  assert.deepEqual(await f.store.verifyCandidate(Object.fromEntries(Object.entries(candidate).reverse())), candidate);
  const forged = { ...candidate, tree: selected.tree, manifest: selected.manifest };
  const { id: _, ...core } = forged; forged.id = hash(canonical(core, 2 << 20));
  await assert.rejects(f.store.verifyCandidate(forged), { code: 'RepositoryCandidateMismatch' });
  assert.deepEqual(await f.store.prepare(selected, edits.toReversed()), candidate, 'input order cannot change candidate identity');
  assert.equal(candidate.tree.length, format === 'sha1' ? 40 : 64);
  const managed = join(f.options.directory, 'objects.git');
  const observed = git(managed, 'diff-tree', '--no-commit-id', '--name-status', '-r', selected.tree, candidate.tree).split('\n');
  assert.deepEqual(observed, ['M\tfile-00.txt', 'D\tfile-01.txt', 'M\tfile-03.txt', 'A\tnew/nested.txt']);
  assert.equal(git(managed, 'show', `${candidate.tree}:file-00.txt`), 'replacement');
  assert.equal(git(managed, 'show', `${candidate.tree}:new/nested.txt`), 'new source');
  assert.equal(git(managed, 'show', `${candidate.tree}:protected.test.mjs`), f.contents.get('protected.test.mjs').trim());
  assert.equal(await readFile(join(f.source, 'file-00.txt'), 'utf8'), f.contents.get('file-00.txt'));
  assert.equal(git(f.source, 'status', '--porcelain'), ''); assert.equal(await f.store.current(), f.base);
});

test('managed leaf wire binds repository, generation, classification and owner while raw Git ignores filters and hooks', async t => {
  let sentinel;
  const f = await fixture(t, {
    extra: source => writeFile(join(source, '.gitattributes'), '*.txt filter=trap\n'),
    configure: async source => {
      sentinel = join(source, 'executed');
      const quoted = `'${sentinel.replaceAll("'", "'\\''")}'`;
      const hooks = join(source, '.git', 'trap-hooks'); await mkdir(hooks);
      await writeFile(join(hooks, 'reference-transaction'), `#!/bin/sh\necho unsafe > ${quoted}\n`, { mode: 0o700 });
      git(source, 'config', 'core.hooksPath', hooks);
      git(source, 'config', 'filter.trap.smudge', `echo unsafe > ${quoted}`);
      git(source, 'config', 'filter.trap.clean', `echo unsafe > ${quoted}`);
    },
  });
  const leaf = await createManagedRepositoryEnvironment({ ...f.options, ...f.receipt, resourceOwner: 'workspace', classification: ['shared'] });
  const selected = await leaf.snapshot(['fixture', f.base]);
  const observed = await leaf.read([selected, 'file-00.txt']); assert.equal(observed[3], f.contents.get('file-00.txt'));
  assert.deepEqual(observed[0], selected[5]);
  for (const [index, value] of [[0, 'another-repository'], [1, 'another-generation'], [7, ['public']], [8, 'other-owner']]) {
    const forged = structuredClone(selected); forged[index] = value;
    await assert.rejects(leaf.read([forged, 'file-00.txt']), /binding mismatch/);
  }
  await f.store.prepare(await f.store.snapshot(f.base), [replacement(f, 'file-00.txt', 'changed\n')]);
  selected[7].push('public');
  assert.deepEqual((await leaf.snapshot(['fixture', f.base]))[7], ['shared'], 'returned labels cannot mutate adapter policy');
  await assert.rejects(access(sentinel), { code: 'ENOENT' });
});


test('candidate preimages, scopes, modes, binary replacements and forged snapshots reject before publication', async t => {
  const f = await fixture(t), selected = await f.store.snapshot(f.base), edit = replacement(f, 'file-00.txt', 'changed\n');
  for (const [edits, code] of [
    [[{ ...edit, oldDigest: '0'.repeat(64) }], 'RepositoryPreimage'],
    [[{ ...edit, oldMode: '100755' }], 'RepositoryPreimage'],
    [[edit, edit], 'RepositoryDuplicateEdit'],
    [[{ ...edit, path: 'protected.test.mjs' }], 'RepositoryPathDenied'],
    [[{ ...edit, path: 'file-02.txt' }], 'RepositoryPathDenied'],
    [[{ ...edit, content: '\0binary' }], 'RepositoryReplacement'],
    [[{ ...edit, content: 'x'.repeat(32769) }], 'RepositoryReplacement'],
    [[{ ...edit, content: f.contents.get('file-00.txt') }], 'RepositoryNoChange'],
  ]) await assert.rejects(f.store.prepare(selected, edits), { code });
  await assert.rejects(f.store.prepare({ ...selected, tree: '0'.repeat(40) }, [edit]), { code: 'RepositorySnapshotMismatch' });
  for (const name of ['/tmp/escape', '../escape', 'a/../escape', '.git/config', '.GiT/config', 'x\\y', 'a//b', 'a\u0001b'])
    await assert.rejects(f.store.read(selected, name));
  assert.equal(await f.store.current(), f.base);
});

test('provisioning rejects path aliases, symlink grants and changing the pinned store metadata', async t => {
  const f = await fixture(t), original = await readFile(join(f.options.directory, 'repository.json'));
  for (const [index, pair] of [['A', 'a'], ['Å', 'A\u030a'], ['Σ', 'ς']].entries()) {
    const probe = join(f.root, `names-${index}`); await mkdir(probe);
    for (const name of pair) await mkdir(join(probe, name), { recursive: true });
    const [first, second] = await Promise.all(pair.map(name => lstat(join(probe, name))));
    const operation = provisionRepository({ ...f.options, directory: join(f.root, `alias-${index}`), readPaths: pair.map((name, i) => `${name}/file-${i}`), writablePaths: [] });
    if (first.ino === second.ino) await assert.rejects(operation, { code: 'RepositoryPathAlias' });
    else await operation;
  }
  await symlink('/etc/passwd', join(f.source, 'linked')); git(f.source, 'add', '.'); git(f.source, 'commit', '--quiet', '-m', 'symlink input');
  await assert.rejects(provisionRepository({ ...f.options, directory: join(f.root, 'links'), base: git(f.source, 'rev-parse', 'HEAD'), readPaths: ['linked'], writablePaths: [] }), { code: 'RepositoryUnsupportedMode' });
  const changed = JSON.parse(original); changed.writablePaths.push('protected.test.mjs');
  await writeFile(join(f.options.directory, 'repository.json'), JSON.stringify(changed));
  await assert.rejects(f.store.current(), { code: 'RepositoryStorageChanged' });
  await assert.rejects(openRepositorySnapshotStore({ ...f.options, ...f.receipt }), { code: 'RepositoryMetadataIntegrity' });
});

test('managed Git configuration corruption is rejected on use and on reopen', async t => {
  const f = await fixture(t);
  const filename = join(f.options.directory, 'objects.git', 'config');
  await writeFile(filename, `${await readFile(filename, 'utf8')}\n[core]\n\thooksPath = /tmp\n`);
  await assert.rejects(f.store.snapshot(f.base), { code: 'RepositoryStorageChanged' });
  await assert.rejects(openRepositorySnapshotStore({ ...f.options, ...f.receipt }), { code: 'RepositoryStorageChanged' });
});

test('provisioning rejects binary tracked source before it can become a candidate preimage', async t => {
  await assert.rejects(fixture(t, { extra: source => writeFile(join(source, 'file-00.txt'), Buffer.from([0, 1, 2])) }), { code: 'RepositoryBinary' });
});

test('publication proposal binds exact nonrecursive commit bytes; read-only revalidation rejects amendments', async t => {
  const f = await fixture(t), snapshot = await f.store.snapshot(f.base);
  const candidate = await f.store.prepare(snapshot, [replacement(f, 'file-00.txt', 'prepared publication\n')]);
  // Synthetic check data exercises object construction only. The actual
  // publisher must additionally resolve this record from admitted leaf custody.
  const check = { format: 'agent.repository.check/v1', occurrence: 'check-1', snapshot, candidate: candidate.id,
    tree: candidate.tree, profile: 'fixture', status: 'Passed', completedChecks: ['fixture'] };
  const validation = [{ ...check, id: hash(canonical(check, 2 << 20)) }];
  const binding = { run: 'run-1', task: 'task-1', generation: '1', principal: 'principal-1', tenant: 'tenant-1', intent: 'a'.repeat(64),
    policyRevision: 'policy-1', authorizationDigest: 'b'.repeat(64), validationPolicyDigest: 'c'.repeat(64) };
  const commit = { author: { name: 'Agent fixture', email: 'fixture@example.invalid' }, committer: { name: 'Agent fixture', email: 'fixture@example.invalid' },
    timestamp: 1791150000, message: 'Prepared repair' };
  const proposal = await f.store.preparePublication({ candidate, binding, validation, commit });
  assert.deepEqual(proposal.core.diff, [{ path: 'file-00.txt', operation: 'replace', oldContent: f.contents.get('file-00.txt'), newContent: 'prepared publication\n' }]);
  const managed = join(f.options.directory, 'objects.git');
  const bytes = execFileSync('git', ['--git-dir=' + managed, 'cat-file', 'commit', proposal.commitOid]);
  assert.equal(hash(bytes), proposal.commitSha256);
  assert.equal(bytes.toString(), `tree ${candidate.tree}\nparent ${f.base}\nauthor Agent fixture <fixture@example.invalid> 1791150000 +0000\ncommitter Agent fixture <fixture@example.invalid> 1791150000 +0000\nagent-proposal-core ${proposal.coreDigest}\nagent-publication-intent ${binding.intent}\n\nPrepared repair\n`);
  const inventory = () => git(managed, 'count-objects', '-v');
  const before = inventory();
  assert.deepEqual(await f.store.verifyPublication(proposal), proposal);
  assert.equal(inventory(), before, 'revalidation must not write objects');
  assert.equal(await f.store.current(), f.base);
  const modified = structuredClone(proposal); modified.core.binding.principal = 'other';
  await assert.rejects(f.store.verifyPublication(modified), { code: 'RepositoryPublicationMismatch' });
  const hidden = structuredClone(proposal); hidden.core.diff[0].oldContent = 'different source';
  await assert.rejects(f.store.verifyPublication(hidden), { code: 'RepositoryPublicationMismatch' });
  await assert.rejects(f.store.verifyPublication({ ...proposal, commitSha256: '0'.repeat(64) }), { code: 'RepositoryPublicationMismatch' });
  for (const status of ['Failed', 'Incomplete']) {
    const failed = { ...check, status };
    await assert.rejects(f.store.preparePublication({ candidate, binding, validation: [{ ...failed, id: hash(canonical(failed, 2 << 20)) }], commit }), { code: 'RepositoryPublicationValidation' });
  }
  await assert.rejects(f.store.preparePublication({ candidate, binding, validation, commit: { ...commit, author: { ...commit.author, name: 'Bad\nparent forged' } } }), { code: 'RepositoryCommitMetadata' });
  const metadata = JSON.parse(await readFile(join(f.options.directory, 'repository.json')));
  const lock = await lstat(join(f.options.directory, 'publication.lock'), { bigint: true });
  assert.deepEqual(metadata.publicationLock, { dev: String(lock.dev), ino: String(lock.ino) });
});


test('retained object quota spans preparations and reopen; existing candidates remain readable at capacity', async t => {
  const f = await fixture(t, { storage: { bytes: 256 << 20, files: 11 } });
  const selected = await f.store.snapshot(f.base), before = await f.store.storageUsage();
  assert.equal(before.files, 8);
  const edits = [replacement(f, 'file-00.txt', 'first generation\n'.repeat(1024))];
  const candidate = await f.store.prepare(selected, edits);
  assert.equal((await f.store.storageUsage()).files, 10);
  assert.deepEqual(await f.store.prepare(selected, edits), candidate, 'idempotent object reuse does not consume capacity');
  const reopened = await openRepositorySnapshotStore({ ...f.options, ...f.receipt });
  await assert.rejects(reopened.prepare(selected, [replacement(f, 'file-00.txt', 'another generation\n')]), { code: 'RepositoryStorageCapacity' });
  assert.equal((await reopened.storageUsage()).files, 10);
  assert.deepEqual(await reopened.verifyCandidate(candidate), candidate);
  assert.equal(await reopened.current(), f.base);
  await assert.rejects(openRepositorySnapshotStore({ ...f.options, ...f.receipt, writeHelper: { ...f.options.writeHelper, sha256: '0'.repeat(64) } }), { code: 'RepositoryWriterIdentity' });
  const readonly = await openRepositorySnapshotStore({ ...f.options, ...f.receipt, writeHelper: null });
  assert.deepEqual(await readonly.verifyCandidate(candidate), candidate);
  await assert.rejects(readonly.prepare(selected, edits), { code: 'RepositoryWriterUnavailable' });
});

test('byte quota charges abandoned object files and rejects new writes without removing recovery data', async t => {
  const f = await fixture(t, { storage: { bytes: 131072, files: 128 } });
  const original = await f.store.storageUsage(), selected = await f.store.snapshot(f.base);
  const treeFile = join(f.options.directory, 'objects.git', 'objects', selected.tree.slice(0, 2), selected.tree.slice(2));
  await link(treeFile, join(f.options.directory, 'objects.git', 'objects', 'tmp_obj_linked'));
  const before = await f.store.storageUsage();
  assert.equal(before.files, original.files + 1);
  assert.equal(before.bytes, original.bytes + (await lstat(treeFile)).size, 'a crash between link and unlink leaves both names charged');
  const abandoned = join(f.options.directory, 'objects.git', 'objects', 'tmp_obj_abandoned');
  await writeFile(abandoned, Buffer.alloc(131072 - before.bytes - 16));
  await assert.rejects(f.store.prepare(selected, [replacement(f, 'file-00.txt', 'a new candidate needing more than sixteen bytes')]), { code: 'RepositoryStorageCapacity' });
  assert.equal((await f.store.storageUsage()).bytes, 131056);
  assert.equal((await readFile(abandoned)).length, 131072 - before.bytes - 16);
  assert.equal(await f.store.current(), f.base);
});


test('independent writers share the persisted object ceiling', async t => {
  const f = await fixture(t, { storage: { bytes: 256 << 20, files: 11 } });
  const other = await openRepositorySnapshotStore({ ...f.options, ...f.receipt });
  const selected = await f.store.snapshot(f.base);
  const results = await Promise.allSettled([f.store.prepare(selected, [replacement(f, 'file-00.txt', 'left\n')]),
    other.prepare(selected, [replacement(f, 'file-01.txt', 'right\n')])]);
  assert(results.some(row => row.status === 'rejected'));
  for (const row of results) if (row.status === 'rejected')
    assert(['RepositoryStorageCapacity', 'PublicationGateBusy'].includes(row.reason.code), row.reason.stack);
  const usage = await other.storageUsage();
  assert(usage.files <= 11 && usage.bytes <= (256 << 20));
  for (const row of results) if (row.status === 'fulfilled') assert.deepEqual(await other.verifyCandidate(row.value), row.value);
  assert.equal(await other.current(), f.base);
});

test('cold import enforces the object quota and removes only its newly reserved failed store', async t => {
  const f = await fixture(t), directory = join(f.root, 'bounded-import');
  await assert.rejects(provisionRepository({ ...f.options, directory, storage: { bytes: 65536, files: 1 } }), { code: 'RepositoryStorageCapacity' });
  await assert.rejects(access(directory), { code: 'ENOENT' });
  assert.equal(await f.store.current(), f.base);
  assert.equal(git(f.source, 'status', '--porcelain'), '');
});

test('scratch admission bounds concurrent and abandoned allocations across renewed callers', async t => {
  const root = await mkdtemp(join(tmpdir(), 'repository-scratch-quota-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => reserveRepositoryScratch(root)));
  const acquired = results.filter(row => row.status === 'fulfilled').map(row => row.value);
  assert.equal(acquired.length, 4); assert.equal(new Set(acquired).size, 4);
  for (const row of results.filter(row => row.status === 'rejected')) assert.equal(row.reason.message, 'scratch_slots_exhausted');
  // A fresh module/caller has no in-memory reservations; the directories still
  // refuse growth, as they would after a process died without cleanup.
  const fresh = await import('../../runtime/repository_zig_sandbox.mjs?reopened');
  for (let attempt = 0; attempt < 8; attempt++) await assert.rejects(fresh.reserveRepositoryScratch(root), /scratch_slots_exhausted/);
  assert.equal((await readdir(root)).length, 4);
  // Only the owning operation's post-reap cleanup makes capacity reusable.
  await rm(acquired[0], { recursive: true });
  assert.equal(await fresh.reserveRepositoryScratch(root), acquired[0]);
  assert.equal((await readdir(root)).length, 4);
});

test('a preexisting slot symlink consumes capacity without being followed or removed', async t => {
  const root = await mkdtemp(join(tmpdir(), 'repository-scratch-alias-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (let i = 0; i < 4; i++) await symlink('/does-not-exist', join(root, `agent-zig-slot-${i}`));
  await assert.rejects(reserveRepositoryScratch(root), /scratch_slots_exhausted/);
  assert.equal((await readdir(root)).length, 4);
});


test('legacy scratch is preserved and blocks new allocation until explicitly reconciled', async t => {
  const root = await mkdtemp(join(tmpdir(), 'repository-scratch-legacy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'agent-zig-old-generation'));
  await assert.rejects(reserveRepositoryScratch(root), /scratch_legacy_storage/);
  assert.deepEqual(await readdir(root), ['agent-zig-old-generation']);
});
