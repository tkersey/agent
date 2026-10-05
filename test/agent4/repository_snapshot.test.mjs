import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, symlink, access, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { provisionRepository, openRepositorySnapshotStore } from '../../runtime/repository_snapshot.mjs';
import { createManagedRepositoryEnvironment } from '../../runtime/repository.mjs';
import { canonical } from '../../runtime/mobility/canonical.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' } }).trim();
async function fixture(t, { format = 'sha1', extra = null, configure = null } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'repository snapshot-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source'); await mkdir(source);
  git(source, 'init', '--quiet', `--object-format=${format}`);
  const contents = new Map(Array.from({ length: 40 }, (_, i) => [`file-${String(i).padStart(2, '0')}.txt`, `line ${i}: needle\n`]));
  contents.set('protected.test.mjs', 'throw new Error("independent check");\n');
  contents.set('unicode.txt', '🙂'.repeat(9000));
  for (const [name, content] of contents) await writeFile(join(source, name), content);
  await extra?.(source);
  git(source, 'add', '.'); git(source, 'commit', '--quiet', '-m', 'immutable fixture');
  const base = git(source, 'rev-parse', 'HEAD');
  await configure?.(source);
  const executable = await realpath(execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim());
  const options = { directory: join(root, 'managed'), sourceGitDirectory: join(source, '.git'), base,
    gitExecutable: executable, repository: 'fixture', generation: 'generation-1', managedRef: 'refs/heads/agent/delivery',
    readPaths: [...contents.keys(), 'new/nested.txt'], writablePaths: ['file-00.txt', 'file-01.txt', 'file-03.txt', 'new/nested.txt'], protectedPaths: ['protected.test.mjs'] };
  const receipt = await provisionRepository(options);
  const store = await openRepositorySnapshotStore({ ...options, ...receipt });
  return { root, source, contents, base, options, receipt, store };
}
const replacement = (f, path, content) => ({ operation: 'replace', path, oldDigest: hash(f.contents.get(path)), oldMode: '100644', content });

test('immutable snapshots paginate, bind cursors and retain exact source after a live branch moves', async t => {
  const f = await fixture(t), selected = await f.store.snapshot(f.base);
  const first = await f.store.list(selected); assert.equal(first.entries.length, 32); assert(first.cursor);
  const second = await f.store.list(selected, { after: first.cursor });
  assert.equal(first.entries.length + second.entries.length, 42); assert.equal(second.cursor, null);
  assert.equal(new Set([...first.entries, ...second.entries].map(row => row[0])).size, 42);
  await assert.rejects(f.store.list(selected, { prefix: 'file-', after: first.cursor }), { code: 'RepositoryCursor' });
  await assert.rejects(f.store.list({ ...selected, generation: 'different' }, { after: first.cursor }), { code: 'RepositorySnapshotMismatch' });
  const search = await f.store.search(selected, { query: 'needle' }); assert.equal(search.entries.length, 32); assert(search.cursor);
  const rest = await f.store.search(selected, { query: 'needle', after: search.cursor }); assert.equal(rest.entries.length, 8); assert.equal(rest.cursor, null);
  await assert.rejects(f.store.search(selected, { query: 'another', after: search.cursor }), { code: 'RepositoryCursor' });
  const excerpt = await f.store.read(selected, 'unicode.txt'); assert.equal(excerpt.truncated, true); assert.equal(excerpt.nextOffset, 32768); assert.equal(excerpt.content, '🙂'.repeat(8192));
  const tail = await f.store.read(selected, 'unicode.txt', { offset: excerpt.nextOffset }); assert.equal(tail.content, '🙂'.repeat(808)); assert.equal(tail.truncated, true);
  await assert.rejects(f.store.read(selected, 'unicode.txt', { offset: 1 }), { code: 'RepositoryReadBounds' });
  await writeFile(join(f.source, 'file-00.txt'), 'later checkout content\n');
  git(f.source, 'add', '.'); git(f.source, 'commit', '--quiet', '-m', 'advance original');
  assert.equal((await f.store.read(selected, 'file-00.txt')).content, f.contents.get('file-00.txt'));
  assert.equal(await f.store.current(), f.base);
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
  const failed = { ...check, status: 'Failed' };
  await assert.rejects(f.store.preparePublication({ candidate, binding, validation: [{ ...failed, id: hash(canonical(failed, 2 << 20)) }], commit }), { code: 'RepositoryPublicationValidation' });
  await assert.rejects(f.store.preparePublication({ candidate, binding, validation, commit: { ...commit, author: { ...commit.author, name: 'Bad\nparent forged' } } }), { code: 'RepositoryCommitMetadata' });
  const metadata = JSON.parse(await readFile(join(f.options.directory, 'repository.json')));
  const lock = await lstat(join(f.options.directory, 'publication.lock'), { bigint: true });
  assert.deepEqual(metadata.publicationLock, { dev: String(lock.dev), ino: String(lock.ino) });
});
