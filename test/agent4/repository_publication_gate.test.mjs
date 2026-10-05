import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync, fork } from 'node:child_process';
import { mkdtemp, writeFile, stat, open, readFile, rm, realpath, chmod, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { withPublicationGate } from '../../runtime/repository_publication_gate.mjs';
import { provisionRepository, openRepositorySnapshotStore } from '../../runtime/repository_snapshot.mjs';
import { canonical } from '../../runtime/mobility/canonical.mjs';

const helper = process.env.AGENT_PUBLICATION_GATE;
const env = { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 'Gate fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Gate fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const until = async predicate => {
  for (let n = 0; n < 500; n++) { if (await predicate()) return; await new Promise(r => setTimeout(r, 10)); }
  throw Error('fixture deadline');
};
async function fixture(t) {
  assert(helper, 'build with check-repository-publication-gate');
  const root = await mkdtemp(join(tmpdir(), 'publication gate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = await realpath(execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim());
  const args = ['--no-replace-objects', '-c', 'core.hooksPath=/dev/null', '--git-dir=' + join(root, 'repo')];
  const run = (...command) => execFileSync(git, [...args, ...command], { env, input: '', encoding: 'utf8' }).trim();
  run('init', '--bare', '--quiet', '--template=');
  const tree = run('mktree'), base = run('commit-tree', tree, '-m', 'base'), next = run('commit-tree', tree, '-p', base, '-m', 'next');
  run('update-ref', 'refs/heads/agent/probe', base);
  const path = join(root, 'lock'); await writeFile(path, '', { mode: 0o600 });
  const { dev, ino } = await stat(path, { bigint: true });
  const options = { helper: { path: helper, sha256: hash(await readFile(helper)) }, lock: { path, dev: String(dev), ino: String(ino) },
    command: { path: git, sha256: hash(await readFile(git)), args: [...args, 'update-ref', '--no-deref', '--stdin'],
      env, input: Buffer.from(`update refs/heads/agent/probe ${next} ${base}\n`) } };
  return { root, run, base, next, options };
}
if (process.argv[2] === 'gate-parent') {
  const options = JSON.parse(process.argv[3]);
  const output = await open(process.argv[4], 'a');
  const child = spawn(helper, [options.lock.path, options.lock.dev, options.lock.ino, options.command.path, ...options.command.args],
    { env, detached: true, stdio: ['pipe', output.fd, output.fd] });
  child.stdin.write(`Rstart\n${options.command.input}prepare\n`);
  process.send({ pid: child.pid });
  process.on('message', message => {
    if (message === 'commit') child.stdin.write('commit\n', () => process.send({ buffered: true }));
  });
} else {
  test('gate serializes read-only admission and one exact CAS; stale CAS is not retried', async t => {
    const f = await fixture(t);
    await withPublicationGate(f.options, async () => {
      await assert.rejects(withPublicationGate(f.options, () => {}), { code: 'PublicationGateBusy' });
      assert.equal(f.run('rev-parse', 'refs/heads/agent/probe'), f.base);
    });
    assert.equal(f.run('rev-parse', 'refs/heads/agent/probe'), f.base);
    await withPublicationGate(f.options, async publish => { await publish(); await assert.rejects(publish(), { code: 'PublicationGateExpired' }); });
    assert.equal(f.run('rev-parse', 'refs/heads/agent/probe'), f.next);
    await assert.rejects(withPublicationGate(f.options, publish => publish()), { code: 'PublicationDeliveryUnknown' });
    assert.equal(f.run('rev-parse', 'refs/heads/agent/probe'), f.next);
  });
  test('gate refuses changed inode, unsafe mode, and changed helper identity', async t => {
    const f = await fixture(t);
    await chmod(f.options.lock.path, 0o644);
    await assert.rejects(withPublicationGate(f.options, () => {}), { code: 'PublicationGateUnavailable' });
    await chmod(f.options.lock.path, 0o600);
    await rename(f.options.lock.path, f.options.lock.path + '.old');
    await writeFile(f.options.lock.path, '', { mode: 0o600 });
    await assert.rejects(withPublicationGate(f.options, () => {}), { code: 'PublicationGateUnavailable' });
    await assert.rejects(withPublicationGate({ ...f.options, helper: { ...f.options.helper, sha256: '0'.repeat(64) } }, () => {}), { code: 'PublicationGateExecutableChanged' });
  });
  test('expired read-only admission cannot authorize a write or return a protected observation', async t => {
    const f = await fixture(t);
    await assert.rejects(withPublicationGate({ ...f.options, timeoutMs: 100 }, async publish => {
      await new Promise(r => setTimeout(r, 200));
      await assert.rejects(publish(), { code: 'PublicationGateExpired' });
    }), { code: 'PublicationGateExpired' });
    await withPublicationGate(f.options, () => {});
    assert.equal(f.run('rev-parse', 'refs/heads/agent/probe'), f.base);
  });
  test('actual Git retains flock after parent death until its prepared transaction finishes', async t => {
    const f = await fixture(t), out = join(f.root, 'out'); await writeFile(out, '');
    const options = structuredClone(f.options); options.command.input = f.options.command.input.toString();
    const parent = fork(import.meta.filename, ['gate-parent', JSON.stringify(options), out], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    let writer;
    try {
      writer = (await new Promise(resolve => parent.once('message', resolve))).pid;
      await until(async () => (await readFile(out, 'utf8')).includes('prepare: ok'));
      process.kill(writer, 'SIGSTOP');
      const buffered = new Promise(resolve => parent.once('message', resolve)); parent.send('commit'); await buffered;
      const dead = new Promise(resolve => parent.once('exit', resolve)); parent.kill('SIGKILL'); await dead;
      await assert.rejects(withPublicationGate(f.options, () => {}), { code: 'PublicationGateBusy' });
      assert.equal(f.run('rev-parse', 'refs/heads/agent/probe'), f.base);
      process.kill(writer, 'SIGCONT');
      await until(() => f.run('rev-parse', 'refs/heads/agent/probe') === f.next);
      await until(async () => {
        try { await withPublicationGate(f.options, () => {}); return true; }
        catch (error) { if (error.code === 'PublicationGateBusy') return false; throw error; }
      });
      writer = null;
    } finally {
      if (writer) { try { process.kill(writer, 'SIGKILL'); } catch {} }
      if (parent.connected) parent.kill('SIGKILL');
    }
  });
  test('managed objects publish exactly once and recover historical identity under the process gate', async t => {
    const f = await fixture(t);
    const options = { directory: join(f.root, 'managed'), sourceGitDirectory: join(f.root, 'repo'), base: f.base,
      gitExecutable: f.options.command.path, repository: 'fixture', generation: 'fixture-1', managedRef: 'refs/heads/agent/probe',
      readPaths: ['fix.txt'], writablePaths: ['fix.txt'] };
    const receipt = await provisionRepository(options), store = await openRepositorySnapshotStore({ ...options, ...receipt });
    async function proposal(base, content, previous, number) {
      const snapshot = await store.snapshot(base), candidate = await store.prepare(snapshot, [{ path: 'fix.txt',
        operation: previous === null ? 'create' : 'replace', oldDigest: previous === null ? null : hash(previous),
        oldMode: previous === null ? null : '100644', content }]);
      const record = { format: 'agent.repository.check/v1', snapshot, candidate: candidate.id, tree: candidate.tree,
        profile: 'fixture', status: 'Passed', completedChecks: ['fixture'] };
      return store.preparePublication({ candidate, validation: [{ ...record, id: hash(canonical(record, 2 << 20)) }],
        binding: { run: 'run-1', task: 'task-1', generation: String(number), principal: 'principal-1', tenant: 'tenant-1',
          intent: String(number).repeat(64), policyRevision: 'policy-1', authorizationDigest: 'a'.repeat(64), validationPolicyDigest: 'b'.repeat(64) },
        commit: { author: { name: 'Fixture', email: 'fixture@example.invalid' }, committer: { name: 'Fixture', email: 'fixture@example.invalid' }, timestamp: 1791150000, message: `Fixture ${number}` } });
    }
    const first = await proposal(f.base, 'first\n', null, 1);
    const records = { proposals: [], publishedCommits: [] }, history = () => records;
    const absent = await store.reconcilePublication(first, f.options.helper, [first]);
    assert.equal(absent.status, 'NotApplied'); assert.equal(await store.current(), f.base);
    await assert.rejects(store.publishManaged(first, f.options.helper, () => { throw Object.assign(Error('cancelled'), { code: 'CancellationPending' }); }, history), { code: 'CancellationPending' });
    assert.equal(await store.current(), f.base);
    const admitted = { policyRevision: 'policy-1', occurrence: 'fixture-only' };
    const published = await store.publishManaged(first, f.options.helper, () => admitted, history);
    records.proposals.push(first); records.publishedCommits.push(first.commitOid);
    assert.equal(published.status, 'Published'); assert.deepEqual(published.admission, admitted);
    assert.equal(published.commit, first.commitOid);
    assert.equal((await store.reconcilePublication(first, f.options.helper, [first], [first.commitOid])).status, 'Published');
    const stale = await store.publishManaged(first, f.options.helper, () => assert.fail('stale proposal cannot reach admission'), history);
    assert.equal(stale.status, 'Conflict');
    const second = await proposal(first.commitOid, 'second\n', 'first\n', 2);
    await store.publishManaged(second, f.options.helper, () => admitted, history);
    records.proposals.push(second); records.publishedCommits.push(second.commitOid);
    const historical = await store.reconcilePublication(first, f.options.helper, [first, second], [first.commitOid, second.commitOid]);
    assert.equal(historical.status, 'Published'); assert.equal(historical.commit, first.commitOid); assert.equal(historical.current, second.commitOid);
    await assert.rejects(store.reconcilePublication(first, f.options.helper, [first], [first.commitOid]), { code: 'RepositoryPublicationHistory' });
    execFileSync(f.options.command.path, ['--git-dir=' + join(options.directory, 'objects.git'), 'update-ref', options.managedRef, f.base]);
    await assert.rejects(store.reconcilePublication(first, f.options.helper, [first, second], [first.commitOid]), { code: 'RepositoryPublicationHistory' });
    await assert.rejects(store.publishManaged(first, f.options.helper, () => assert.fail('rewind cannot reach admission'), history), { code: 'RepositoryPublicationHistory' });
  });
}
