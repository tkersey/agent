import { repositoryWriteHelper } from './repository_storage_fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { selectZig } from '../../tools/agent4/toolchain.mjs';
import { createZigRepositorySandbox } from '../../runtime/repository_zig_sandbox.mjs';
import { provisionRepository, openRepositorySnapshotStore } from '../../runtime/repository_snapshot.mjs';
import { encodeSchema, encodeValue } from '../../runtime/values.mjs';
import { canonical } from '../../runtime/mobility/canonical.mjs';
import { repositoryCheckBinding, checkResultSchema, acquiredCheck } from '../../runtime/mobility/repository_check.mjs';
import { createRepositoryCheckRunner } from '../../runtime/repository_checks.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (root, ...args) => execFileSync('/usr/bin/git', ['-C', root, ...args], { encoding: 'utf8',
  env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Qualification', GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'Qualification', GIT_COMMITTER_EMAIL: 'test@example.invalid' } }).trim();

test('qualified Zig checks distinguish an actual Agent repair from its incorrect base without publishing', async t => {
  const toolchain = selectZig([]);
  const root = await mkdtemp(join(tmpdir(), 'agent Zig repair '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const helpers = {};
  if (process.platform === 'darwin') for (const [name, source, mode] of [
    ['launcher', 'inquiry_process_limit', 'build-exe'], ['processLock', 'inquiry_process_lock', 'build-lib'],
  ]) {
    const installed = process.env[name === 'launcher' ? 'AGENT_CHECK_LIMIT' : 'AGENT_CHECK_LOCK'];
    const path = installed ? await realpath(installed) : join(await realpath(root), name === 'launcher' ? 'limit' : 'lock.dylib');
    if (!installed) execFileSync(toolchain.executable, [mode, new URL(`../../runtime/${source}.zig`, import.meta.url).pathname,
      ...(mode === 'build-lib' ? ['-dynamic'] : []), '-lc', '-O', 'safe', `-femit-bin=${path}`], {
        env: toolchain.env, timeout: 30000, maxBuffer: 262144,
      });
    helpers[name] = { path, sha256: sha(await readFile(path)) };
  }
  const runner = await createZigRepositorySandbox({ toolchain, ...helpers, scratchRoot: root });
  assert.equal(runner.kind, 'qualified', JSON.stringify(runner));
  assert.equal(runner.contract.scratchSlots, 4);
  assert.deepEqual((await readdir(root)).filter(name => name.startsWith('agent-zig-')), []);
  assert.equal(runner.qualification.denials.status, 'Passed');
  assert.equal(runner.qualification.full.status, 'Passed');
  assert.equal(runner.qualification.timeout.status, 'TimedOut');
  assert.equal(runner.qualification.cancel.status, 'Cancelled');
  assert.equal(runner.qualification.compilerRead.status, 'Passed');
  assert.equal(runner.qualification.compilerDenial.status, 'Failed');
  assert.equal(runner.qualification.memory.signal, 'SIGKILL');
  assert.equal(runner.qualification.threads.status, 'Passed');
  const forged = await runner.execute({
    'main.zig': 'const subject = @import("subject"); pub export fn agent_observe(_: u32) u64 { return subject.bound(); }',
    'subject.zig': 'extern "c" fn write(c_int, [*]const u8, usize) isize; extern "c" fn _exit(c_int) noreturn; pub fn bound() u64 { return 4; } pub export fn exit(_: c_int) noreturn { const msg = "[\\\"5\\\"]\\n"; _ = write(1, msg.ptr, msg.len); _exit(0); }',
  }, { roots: [{ name: 'root', path: 'main.zig', dependencies: ['subject'] }, { name: 'subject', path: 'subject.zig', dependencies: [] }], expectedStdout: '["5"]\n' });
  assert.notEqual(forged.status, 'Passed', 'candidate exit/output cannot replace the host observation');
  const source = join(root, 'source'); await mkdir(source); await mkdir(join(source, 'src'));
  const correct = await readFile(new URL('../../src/model_json.zig', import.meta.url), 'utf8');
  assert(correct.includes('.bool => 5,'));
  // Seed a single real serialization-bound defect in a private copy. The
  // protected expectation follows JSON's spelling of false, independently of
  // the implementation's counting routine or project tests.
  const incorrect = correct.replace('.bool => 5,', '.bool => 4,');
  await writeFile(join(source, 'src/model_json.zig'), incorrect);
  const harness = `const subject = @import("subject");
pub export fn agent_observe(_: u32) u64 { return subject.maximumToolArgumentsByteLength(bool); }`;
  await writeFile(join(source, 'harness.zig'), harness);
  git(source, 'init', '--quiet'); git(source, 'add', '.'); git(source, 'commit', '--quiet', '-m', 'isolated incorrect bound');
  const base = git(source, 'rev-parse', 'HEAD');
  const options = { directory: join(root, 'managed'), sourceGitDirectory: join(source, '.git'), base,
    gitExecutable: await realpath('/usr/bin/git'), repository: 'agent-json-qualification', generation: '1',
    managedRef: 'refs/heads/agent/result', readPaths: ['src/model_json.zig', 'harness.zig'],
    writablePaths: ['src/model_json.zig'], protectedPaths: ['harness.zig'] };
  const receipt = await provisionRepository(options);
  const store = await openRepositorySnapshotStore({ writeHelper: await repositoryWriteHelper(), ...options, ...receipt });
  const snapshot = await store.snapshot(base);
  const candidate = await store.prepare(snapshot, [{ operation: 'replace', path: 'src/model_json.zig',
    oldDigest: sha(incorrect), oldMode: '100644', content: correct }]);
  const profile = { id: 'agent.model-json-bool-bound.v1', description: 'The maximum encoded boolean size covers false',
    requiredPaths: ['src/model_json.zig'], modules: [{ name: 'subject', path: 'src/model_json.zig', dependencies: [] }],
    harness: { source: harness, sha256: sha(harness) }, expectedStdout: '["5"]\n', deterministic: true };
  const checks = createRepositoryCheckRunner({ store, sandbox: runner, profiles: [profile] });
  profile.harness.source = 'caller mutation must not replace the admitted harness';
  const request = { snapshot, profileId: profile.id, occurrence: 'base-check' };
  const failed = await checks.check(request);
  assert.equal(failed.status, 'Failed', JSON.stringify(failed)); assert.equal(failed.diagnostics.exitCode, 0);
  assert.equal(failed.diagnostics.stdout, '["4"]\n', 'the host rejects the wrong value even when execution succeeds');
  const checkWire = encodeSchema({ root: 0, types: [{ product: [1, 2] }, { enumeration: [0, 1, 2, 3, 4, 5, 6] }, { bounded_text: 2 << 20 }] });
  const candidateWire = { root: 0, types: [{ bounded_text: 2 << 20 }] };
  const binding = repositoryCheckBinding({ operation: 'agent.repository.check.v1', role: 'write', subject: options.repository,
    subjectVersion: receipt.manifestSha256, audience: 'check', payloadSchema: encodeSchema(candidateWire), resultSchema: checkWire }, {
    hostId: 'W', runner: checks, profile: { owner: 'W', repository: options.repository, generation: options.generation,
      manifest: receipt.manifestSha256, profileId: profile.id, profileDigest: checks.profiles[0].digest, runner: checks.runner,
      disclosure: { audience: 'check', labels: ['source'] }, allowance: { attempts: 2, request_bytes: 4 << 20, concurrent: 1 } },
  });
  const payload = Buffer.from(canonical(candidate, 2 << 20)).toString('utf8');
  const context = { payload, request: { payload: encodeValue(candidateWire, payload) }, run: { classification: ['source'] },
    occurrence: { id: 'candidate-check' }, signal: new AbortController().signal };
  assert.equal(binding.charge(context).kind, 'check');
  const passed = acquiredCheck(checkResultSchema(checkWire), await binding.handle(context));
  assert.equal(passed.status, 'Passed', JSON.stringify(passed));
  assert.equal(passed.physicalExecutions, 2);
  assert.notEqual(passed.binarySha256, failed.binarySha256);
  assert.equal(passed.candidate, candidate.id); assert.equal(passed.tree, candidate.tree);
  assert.equal(failed.candidate, null); assert.equal(failed.tree, snapshot.tree);
  assert.notEqual(passed.inputDigest, failed.inputDigest); assert.notEqual(passed.contractDigest, failed.contractDigest);
  assert.deepEqual(passed.completedChecks, [profile.id]); assert.deepEqual(failed.completedChecks, []);
  assert.equal(passed.reusable, true); assert.equal(failed.reusable, false);
  await assert.rejects(checks.check({ ...request, profileId: 'model-supplied-command' }), { code: 'RepositoryCheckProfileDenied' });
  assert.equal(await store.current(), base);
  assert.equal(await readFile(join(source, 'src/model_json.zig'), 'utf8'), incorrect);
  assert.equal(git(source, 'status', '--porcelain'), '');
  await assert.rejects(store.checkInputs({ snapshot, candidate: { ...candidate, tree: snapshot.tree },
    requiredPaths: options.readPaths }), { code: 'RepositoryCandidateMismatch' });
  await assert.rejects(store.checkInputs({ snapshot, requiredPaths: ['not-granted.zig'] }), { code: 'RepositoryPathDenied' });
  const controller = new AbortController(); controller.abort();
  const cancelled = await runner.execute({ 'main.zig': 'pub fn main() void {}' }, {
    signal: controller.signal, expectedStdout: '["0"]\n' });
  assert.equal(cancelled.status, 'Cancelled'); assert.equal(cancelled.physicalExecutions, 0);
  const catalogue = [];
  for (const [id, sourceRoot, before, after] of [
    ['boundary.wire-natural.v1', process.env.AGENT_PROFILE_BOUNDARY_SOURCE, 'if (next == 0) return error.NonCanonical;', 'if (false) return error.NonCanonical;'],
    ['world.allocation-budget.v1', process.env.AGENT_PROFILE_WORLD_SOURCE, 'required > self.limit', 'required > self.limit + 64'],
    ['agent.model-json-bounds.v1', new URL('../..', import.meta.url).pathname, '.bool => 5,', '.bool => 4,'],
  ]) {
    assert(sourceRoot, `source root required for ${id}`);
    const profile = JSON.parse(await readFile(new URL(`../../runtime/repository-profiles/${id}.json`, import.meta.url)));
    const path = profile.requiredPaths[0], original = await readFile(join(sourceRoot, path), 'utf8');
    assert(original.includes(before), `${id}: current source must contain the independently selected mutation site`);
    const source = join(root, id); await mkdir(join(source, path.slice(0, path.lastIndexOf('/'))), { recursive: true });
    await writeFile(join(source, path), original);
    git(source, 'init', '--quiet'); git(source, 'add', '.'); git(source, 'commit', '--quiet', '-m', 'admitted profile source');
    const base = git(source, 'rev-parse', 'HEAD');
    const options = { directory: join(root, id + '-managed'), sourceGitDirectory: join(source, '.git'), base,
      gitExecutable: await realpath('/usr/bin/git'), repository: id, generation: '1', managedRef: 'refs/heads/agent/result',
      readPaths: [path], writablePaths: [path] };
    const receipt = await provisionRepository(options), store = await openRepositorySnapshotStore({ writeHelper: await repositoryWriteHelper(), ...options, ...receipt });
    const snapshot = await store.snapshot(base), checks = createRepositoryCheckRunner({ store, sandbox: runner, profiles: [profile] });
    const request = { snapshot, profileId: id, occurrence: 'correct' };
    const correct = await checks.check(request);
    assert.equal(correct.status, 'Passed', JSON.stringify(correct));
    const candidate = await store.prepare(snapshot, [{ path, operation: 'replace', oldDigest: sha(original), oldMode: '100644', content: original.replace(before, after) }]);
    const incorrect = await checks.check({ ...request, candidate, occurrence: 'incorrect' });
    assert.equal(incorrect.status, 'Failed', JSON.stringify(incorrect));
    assert.equal(incorrect.physicalExecutions, 2, 'the negative candidate must compile and execute');
    assert.equal(await store.current(), base);
    assert.equal(git(source, 'status', '--porcelain'), '');
    catalogue.push({ id, sourceSha256: sha(original), correct, incorrect });
  }
  assert.deepEqual((await readdir(root)).filter(name => name.startsWith('agent-zig-')), [], 'repeated completed native checks release all scratch slots');
  if (process.env.AGENT_REPOSITORY_PROOF) await writeFile(process.env.AGENT_REPOSITORY_PROOF, JSON.stringify({
    profile: runner.contract, qualification: runner.qualification, forgedVerdict: forged, incorrectBase: failed, repairedCandidate: passed,
    managedRefUnchanged: true, originalCheckoutUnchanged: true, catalogue,
  }, null, 2) + '\n');
});
