import { repositoryWriteHelper } from './repository_storage_fixture.mjs';
// Actual compiled approval, World custody, SQLite and managed Git. The human
// and independent content check are deterministic reference capabilities.
import { createServer } from 'node:http';
const { createManagedRepositoryEnvironment } = await import(pathToFileURL(resolve(process.env.AGENT_MOBILE_PACKAGE ?? new URL('../..', import.meta.url).pathname, 'runtime/repository.mjs')));
const { modelBinding } = await import(pathToFileURL(resolve(process.env.AGENT_MOBILE_PACKAGE ?? new URL('../..', import.meta.url).pathname, 'runtime/mobility/model.mjs')));
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { artifactRoot } from './artifacts.mjs';
const { verifyRuntime } = await import(pathToFileURL(resolve(process.env.AGENT_MOBILE_PACKAGE ?? new URL('../..', import.meta.url).pathname, 'tools/agent4/dependencies.mjs')));
const { encodeValue, decodeValue, decodeSchema } = await import(pathToFileURL(resolve(process.env.AGENT_MOBILE_PACKAGE ?? new URL('../..', import.meta.url).pathname, 'runtime/values.mjs')));
const { provisionRepository, openRepositorySnapshotStore } = await import(pathToFileURL(resolve(process.env.AGENT_MOBILE_PACKAGE ?? new URL('../..', import.meta.url).pathname, 'runtime/repository_snapshot.mjs')));
const { repositoryCheckBinding } = await import(pathToFileURL(resolve(process.env.AGENT_MOBILE_PACKAGE ?? new URL('../..', import.meta.url).pathname, 'runtime/mobility/repository_check.mjs')));
const { repositoryApprovalBinding, repositoryReviewBinding, repositoryNextTaskBinding } = await import(pathToFileURL(resolve(process.env.AGENT_MOBILE_PACKAGE ?? new URL('../..', import.meta.url).pathname, 'runtime/mobility/repository_approval.mjs')));
const { repositoryPublicationBinding, repositoryProposalBinding, PUBLICATION } = await import(pathToFileURL(resolve(process.env.AGENT_MOBILE_PACKAGE ?? new URL('../..', import.meta.url).pathname, 'runtime/mobility/repository_publication.mjs')));
const { WorldAdmission } = await import(pathToFileURL(resolve(process.env.AGENT_MOBILE_PACKAGE ?? new URL('../..', import.meta.url).pathname, 'runtime/mobility/admission.mjs')));
const { CustodyJournal } = await import(pathToFileURL(resolve(process.env.AGENT_MOBILE_PACKAGE ?? new URL('../..', import.meta.url).pathname, 'runtime/mobility/journal.mjs')));
const { BrowserSessions } = await import(pathToFileURL(resolve(process.env.AGENT_MOBILE_PACKAGE ?? new URL('../..', import.meta.url).pathname, 'runtime/mobility/sessions.mjs')));
const { serveBrowser } = await import(pathToFileURL(resolve(process.env.AGENT_MOBILE_PACKAGE ?? new URL('../..', import.meta.url).pathname, 'runtime/mobility/browser.mjs')));
import { certificates } from './mobility_tls_fixture.mjs';
const { Custodian } = await import(pathToFileURL(resolve(process.env.AGENT_MOBILE_PACKAGE ?? new URL('../..', import.meta.url).pathname, 'runtime/mobility/custodian.mjs')));
const { HostPolicy, requirement } = await import(pathToFileURL(resolve(process.env.AGENT_MOBILE_PACKAGE ?? new URL('../..', import.meta.url).pathname, 'runtime/mobility/policy.mjs')));
const { hash, canonical, parse, runId, signRecord } = await import(pathToFileURL(resolve(process.env.AGENT_MOBILE_PACKAGE ?? new URL('../..', import.meta.url).pathname, 'runtime/mobility/protocol.mjs')));

const applicationArtifacts = process.env.AGENT_MOBILE_PACKAGE ? join(process.env.AGENT_MOBILE_PACKAGE, 'examples') : join(artifactRoot, 'agent4');
const schemaExtension = process.env.AGENT_MOBILE_PACKAGE ? 'bin' : 'schema';
const { createZigRepositorySandbox } = await import(pathToFileURL(resolve(process.env.AGENT_MOBILE_PACKAGE ?? new URL('../..', import.meta.url).pathname, 'runtime/repository_zig_sandbox.mjs')));
const { createRepositoryCheckRunner } = await import(pathToFileURL(resolve(process.env.AGENT_MOBILE_PACKAGE ?? new URL('../..', import.meta.url).pathname, 'runtime/repository_checks.mjs')));
const { taskCatalogue } = await import(pathToFileURL(resolve(process.env.AGENT_MOBILE_PACKAGE ?? new URL('../..', import.meta.url).pathname, 'runtime/mobility/task_catalogue.mjs')));
const { selectZig } = await import(pathToFileURL(resolve(process.env.AGENT_MOBILE_PACKAGE ?? new URL('../..', import.meta.url).pathname, 'tools/agent4/toolchain.mjs')));
const text = value => Buffer.from(canonical(value, 2 << 20)).toString('utf8');
const env = { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 'Approval fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Approval fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
// Test-only interpreter comparison at the actual custody execution boundary.
// The production custodian still owns every request, reply and successor.
function nativeComparedWorld(world, directory, observed) {
  return { ...world, Kernel: { async create(options) {
    const kernel = await world.Kernel.create(options), programs = new Map(), sessions = new Map();
    return new Proxy(kernel, { get(target, name) {
      if (name === 'prepare') return image => { const prepared = target.prepare(image); programs.set(prepared, Uint8Array.from(image)); return prepared; };
      if (name === 'start') return (prepared, args) => { const session = target.start(prepared, args); sessions.set(session, { image: programs.get(prepared), initialArgs: Uint8Array.from(args) }); return session; };
      if (name === 'restore') return (prepared, state) => { const session = target.restore(prepared, state); sessions.set(session, { image: programs.get(prepared), state: Uint8Array.from(state) }); return session; };
      if (name === 'drive') return (session, options = {}) => {
        const prior = sessions.get(session), input = world.encodeInput({ ...prior, ...options });
        const output = target.drive(session, options), path = join(directory, 'native-comparison.pki3');
        writeFileSync(path, input);
        const expected = new Uint8Array(execFileSync(process.env.AGENT_MOBILE_NATIVE, [path], { maxBuffer: 16 << 20 }));
        assert.deepEqual(output, expected, 'native and WASM agree at the actual repository custody boundary');
        observed.count++; sessions.set(session, { image: prior.image, state: world.decodeOutcome(output).state });
        return output;
      };
      const value = Reflect.get(target, name, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
  } } };
}
export async function repositoryFixture(t, { staleAnswer = false, wrongPrincipal = false, lostReply = false, onQuestion = null, content = 'independently checked\n', checkStatus = 'Passed', mobile = false, mode = 2, reviewFollowup = null, logicalSteps = 8, misuse = false, restartReview = false, cancelReview = false, engine = null, refuseReturn = false, qualified = false, intake = false, sessionTasks = 0, nextMode = null, comparison = null, deterministicBase = false, revisionScenario = null } = {}) {
  if (revisionScenario) assert(mobile && mode === 1 && !qualified && !comparison && ['eight', 'nine', 'repeat', 'amend'].includes(revisionScenario));
  const sessionInput = mobile && Boolean(process.env.AGENT_MOBILE_PACKAGE || intake || sessionTasks || comparison);
  if (comparison) assert(mobile && mode === 1 && !qualified && !engine && !reviewFollowup && !sessionTasks, "comparison uses the same single-task propose workload");
  const stationary = comparison?.topology === "stationary", spendingHost = stationary ? "U" : "W";
  const revision = comparison ? `measure-${comparison.topology}-v1` : "p1";
  const workload = comparison?.workload ?? { repositoryBytes: 0, extraReads: 0, replayPaddingBytes: 0 };
  const gitEnvironment = comparison || deterministicBase ? { ...env, GIT_AUTHOR_DATE: "1791150000 +0000", GIT_COMMITTER_DATE: "1791150000 +0000" } : env;
  const root = await mkdtemp(join(tmpdir(), 'repository-approval-'));
  const git = await realpath(execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim());
  const targetPath = qualified ? 'subject.zig' : 'fix.txt';
  if (qualified) content = await readFile(new URL('../../src/model_json.zig', import.meta.url), 'utf8');
  const before = qualified ? content.replace('.bool => 5,', '.bool => 4,') : 'before\n';
  const source = join(root, 'source.git');
  const command = (...args) => execFileSync(git, ['--git-dir=' + source, ...args], { env: gitEnvironment, encoding: 'utf8' }).trim();
  command('init', '--bare', '--quiet', '--template=');
  const extraTree = comparison ? `100644 blob ${execFileSync(git, ['--git-dir=' + source, 'hash-object', '-w', '--stdin'], { env, encoding: 'utf8', input: 'x'.repeat(workload.repositoryBytes) }).trim()}\tcontext.txt\n` : '';
  const tree = mobile ? execFileSync(git, ['--git-dir=' + source, 'mktree'], { env, encoding: 'utf8', input: extraTree + `100644 blob ${execFileSync(git, ['--git-dir=' + source, 'hash-object', '-w', '--stdin'], { env, encoding: 'utf8', input: before }).trim()}\t${targetPath}\n` }).trim() : command('mktree');
  const base = command('commit-tree', tree, '-m', 'base');
  command('update-ref', 'refs/heads/fixture', base);
  const options = { directory: join(root, 'managed'), sourceGitDirectory: source, base, gitExecutable: git,
    repository: 'fixture', generation: 'generation', managedRef: 'refs/heads/agent/result', readPaths: comparison ? ['context.txt', targetPath] : [targetPath], writablePaths: [targetPath] };
  const provisioned = await provisionRepository(options), store = await openRepositorySnapshotStore({ writeHelper: await repositoryWriteHelper(), ...options, ...provisioned });
  const snapshot = await store.snapshot(base), candidate = await store.prepare(snapshot, [
    { path: targetPath, operation: mobile ? 'replace' : 'create', oldDigest: mobile ? (await store.read(snapshot, targetPath)).digest : null, oldMode: mobile ? '100644' : null, content }]);
  const identity = verifyRuntime(resolve(process.env.AGENT_MOBILITY_RUNTIME)), world = await import(pathToFileURL(identity.entrypoint));
  const nativeComparisons = { count: 0 }, executionWorld = comparison?.instrumentWorld ? comparison.instrumentWorld(world) : process.env.AGENT_MOBILE_NATIVE ? nativeComparedWorld(world, root, nativeComparisons) : world;
  if (process.env.AGENT_MOBILE_NATIVE) t.after(() => { assert(nativeComparisons.count > 0); t.diagnostic(`native/WASM custody outcomes compared: ${nativeComparisons.count}`); });
  const kernelBytes = await readFile(identity.kernelPath), image = await readFile(`${applicationArtifacts}/${mobile ? 'mobile-repository' : 'repository-approval'}/${sessionInput ? 'session' : 'program'}.bpi3`);
  const names = ['task', 'preparation', 'result', 'check-result', 'proposal', 'receipt', 'delivery', 'human', 'human-reply', 'identifier', 'boolean'];
  const bytes = Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(`${applicationArtifacts}/repository-approval/${name}.${schemaExtension}`)])));
  if (mobile) for (const name of ['task', 'report', 'snapshot-request', 'snapshot', 'read', 'evidence', 'cleanup', 'unit', 'model-request', 'model-result', 'candidate-preparation', 'review', 'review-answer', 'read-window', 'read-window-result', 'next-task', 'next-task-answer']) {
    bytes[name === 'report' ? 'result' : name] = await readFile(`${applicationArtifacts}/mobile-repository/${name}.${schemaExtension}`);
  }
  if (sessionInput) bytes.session = await readFile(`${applicationArtifacts}/mobile-repository/session.${schemaExtension}`);
  const schemas = Object.fromEntries(Object.entries(bytes).map(([name, value]) => [name, decodeSchema(value)]));
  const metadata = (operation, input, output, role) => ({ operation, payloadSchema: bytes[input], resultSchema: bytes[output], role,
    subject: 'fixture', subjectVersion: null, scope: operation, audience: role === 'approval' ? 'human' : null,
    trustDomain: 'fixture', tenants: ['tenant'], principals: ['user'], classification: ['shared'], allowedStateLabels: ['shared'], cleanup: false });
  const publishMetadata = metadata(PUBLICATION, 'proposal', 'delivery', 'commit');
  const placement = [[[requirement(publishMetadata)], [[], { tag: 0, value: null }, { tag: 0, value: null }, 8n << 20n]], 'publish', 'shared', [1, 1]];
  const humanMetadata = metadata('agent.interaction.exchange.v1.repository.publish', 'human', 'human-reply', 'approval');
  const humanPlacement = [[[requirement(humanMetadata)], [[], { tag: 0, value: null }, { tag: 0, value: null }, 8n << 20n]], 'review', 'shared', [2, 1]];
  const workspace = mobile ? [[[requirement(metadata('agent.repository.snapshot.v1', 'snapshot-request', 'snapshot', 'read'))], [[], { tag: 0, value: null }, { tag: 0, value: null }, 8n << 20n]], 'workspace', 'shared', [reviewFollowup ? 6 : 4, 1]] : null;
  const task = encodeValue(schemas.task, mobile ? [1n, 1n, mode, 'Make the bounded independently checked change.', 'fixture', base, targetPath, workspace, humanPlacement,
    ['fixture-model', [{ tag: 1, value: 512 }, { tag: 0, value: null }, { tag: 0, value: null }]], logicalSteps, revisionScenario ? 16 : reviewFollowup === 'amend' ? 2 : 1, 7n] : [7n, text(candidate), humanPlacement, placement]);
  let expectedTask = decodeValue(schemas.task, task);
  // Derive the program identity from its actual first request, before effects.
  const kernel = await world.Kernel.create({ bytes: kernelBytes, expectedSha256: identity.kernelSha256 });
  kernel.setLimits({ input: 8 << 20, working: 64 << 20, output: 8 << 20 });
  const prepared = kernel.prepare(image), session = kernel.start(prepared, sessionInput ? encodeValue(schemas.session, [expectedTask, sessionTasks || 1]) : task);
  const first = world.decodeOutcome(kernel.drive(session, { checkpoint: true }));
  const programId = Buffer.from((await world.decodeRequest(first.request)).programIdentity).toString('hex');
  kernel.checkpoint(session, { transfer: true }); kernel.releasePrepared(prepared);
  const pairs = Object.fromEntries(['issuer', 'W', 'U'].map(host => [host, generateKeyPairSync('ed25519')]));
  const keys = new Map(Object.entries(pairs).map(([host, pair]) => [host, { owner: host, status: 'active', publicKey: pair.publicKey }]));
  const journals = {}, hosts = {}, policies = {}, admissions = {}, peers = { W: new Map(), U: new Map() };
  let activeHost = mobile ? 'U' : 'W';
  const counts = { check: 0, publish: 0, human: 0 }, issued = new Set();
  let realChecks = null;
  if (qualified) {
    const nativeRoot = process.env.AGENT_MOBILE_PACKAGE ? join(process.env.AGENT_MOBILE_PACKAGE, 'examples/native') : join(applicationArtifacts, 'native');
    const helpers = {};
    for (const [name, file] of [['launcher', 'agent-check-limit'], ['processLock', 'libagent-check-lock.dylib']]) {
      const path = await realpath(process.env.AGENT_MOBILE_PACKAGE ? join(nativeRoot, file) : process.env[name === 'launcher' ? 'AGENT_CHECK_LIMIT' : 'AGENT_CHECK_LOCK'] ?? join(nativeRoot, file)); helpers[name] = { path, sha256: hash(await readFile(path)) };
    }
    const sandbox = await createZigRepositorySandbox({ toolchain: selectZig([]), ...helpers, scratchRoot: root });
    assert.equal(sandbox.kind, 'qualified', JSON.stringify(sandbox));
    const source = 'const subject = @import("subject"); pub export fn agent_observe(_: u32) u64 { return subject.maximumToolArgumentsByteLength(bool); }';
    realChecks = createRepositoryCheckRunner({ store, sandbox, profiles: [{ id: 'fixture-content', description: 'Independent JSON boolean bound', requiredPaths: [targetPath],
      modules: [{ name: 'subject', path: targetPath, dependencies: [] }], harness: { source, sha256: hash(source) }, expectedStdout: '["5"]\n', deterministic: true }] });
    assert.equal((await realChecks.check({ snapshot, profileId: 'fixture-content', occurrence: 'baseline-control' })).status, 'Failed');
  }
  const profileDigest = realChecks?.profiles[0].digest ?? '3'.repeat(64), runner = realChecks?.runner ?? '4'.repeat(64);
  const configuration = { store, helper: { path: process.env.AGENT_PUBLICATION_GATE, sha256: hash(await readFile(process.env.AGENT_PUBLICATION_GATE)) },
    protectedImages: [{ image: hash(image), program: programId }], authorizationDigest: '1'.repeat(64), validationPolicyDigest: '2'.repeat(64),
    requiredProfiles: [{ id: 'fixture-content', profileDigest, runner }], checkResultSchema: bytes['check-result'],
    services: () => ({ journal: journals[spendingHost], policy: policies[spendingHost] }) };
  const publish = repositoryPublicationBinding(publishMetadata, configuration), original = publish.handle;
  publish.handle = async context => {
    counts.publish++; const result = await original(context);
    if (lostReply) throw Object.assign(Error('lost acquired reply'), { code: 'FixtureLostReply' });
    return result;
  };
  const current = repositoryPublicationBinding(metadata('agent.repository.publication-current.v1', 'proposal', 'boolean', 'read'), configuration);
  const fixed = (operation, input, output, role, handle) => ({ ...metadata(operation, input, output, role), authorize: () => true,
    handle: async context => encodeValue(schemas[output], await handle(context)) });
  const check = repositoryCheckBinding({ ...metadata('agent.repository.check.v1', 'proposal', 'check-result', 'write'),
    subjectVersion: provisioned.manifestSha256 }, { hostId: 'W',
    profile: { owner: 'W', repository: options.repository, generation: options.generation, manifest: provisioned.manifestSha256,
      profileId: 'fixture-content', profileDigest, runner, disclosure: { audience: null, labels: ['shared'] },
      allowance: { attempts: revisionScenario ? 16 : sessionTasks || (reviewFollowup === 'amend' ? 2 : 1), request_bytes: 4 << 20, concurrent: 1 } },
    runner: { runner, profiles: [{ id: 'fixture-content', digest: profileDigest }], async check({ candidate: exact, occurrence }) {
      counts.check++; if (realChecks) return realChecks.check({ snapshot: exact.snapshot, candidate: exact, occurrence, profileId: 'fixture-content' });
      const inputs = await store.checkInputs({ snapshot: exact.snapshot, candidate: exact, requiredPaths: [targetPath] });
      assert.deepEqual(inputs.files[targetPath], Buffer.from(revisionScenario ? content + `revision-${revisionScenario === 'repeat' ? 1 : counts.check}\n` : reviewFollowup === 'amend' && counts.check > 1 ? content + 'revised\n' : content));
      const record = { format: 'agent.repository.check/v1', occurrence, snapshot: exact.snapshot, candidate: exact.id, tree: exact.tree,
        profile: 'fixture-content', profileDigest, runner, status: checkStatus, completedChecks: checkStatus === 'Passed' ? ['fixture-content'] : [] };
      return { ...record, id: hash(canonical(record, 2 << 20)) };
    } },
  });
  const prepare = repositoryProposalBinding(metadata('agent.repository.proposal.v1', 'preparation', 'proposal', 'write'), { ...configuration,
    commit: { author: { name: 'Fixture', email: 'fixture@example.invalid' }, committer: { name: 'Fixture', email: 'fixture@example.invalid' }, timestamp: 1791150000, message: 'Exact approval fixture' },
  });
  const issue = repositoryApprovalBinding(metadata('agent.approval.issue.v1.repository.publish', 'proposal', 'identifier', 'approval'), { kind: 'repository-approval-issuer' });
  const issueHandle = issue.handle; issue.handle = context => { issued.add(context.occurrence.id); return issueHandle(context); };
  const synthetic = fixed('agent.interaction.exchange.v1.repository.publish', 'human', 'human-reply', 'approval', ({ payload }) => {
    counts.human++; const challenge = structuredClone(payload[3]); assert(issued.has(challenge[0]));
    if (staleAnswer) challenge[0] = 'stale';
    return { tag: 0, value: [challenge, wrongPrincipal ? 8n : 7n, { tag: 0, value: null }] };
  });
  const deferred = repositoryApprovalBinding(humanMetadata, { kind: 'repository-approval-human', revision: 'approval-1', principalIds: { user: '7' } });
  const answer = deferred.answer; deferred.answer = context => { counts.human++; return answer(context); };
  const human = staleAnswer || wrongPrincipal ? synthetic : deferred;
  const additional = [], cleanupBindings = [], reviewBindings = [];
  if (sessionTasks) reviewBindings.push(repositoryNextTaskBinding({ ...metadata('agent.repository.next-task.v1', 'next-task', 'next-task-answer', 'interaction'), audience: 'human' }, { kind: 'repository-next-task-human', revision: 'next-1', modes: [['inspect', 'propose', 'publish'][nextMode ?? mode]] }));
  if (mobile) {
    const review = repositoryReviewBinding({ ...metadata('agent.repository.review.v1', 'review', 'review-answer', 'interaction'), audience: 'human' }, { kind: 'repository-review-human', revision: 'review-1' });
    const answer = review.answer; review.answer = context => { counts.human++; return answer(context); }; reviewBindings.push(review);
  }
  let modelTurn = 0, modelCalls = 0, cleanupCalls = 0, reviewAnswers = 0, reviewRestarted = false, provider;
  if (mobile) {
    const leaf = await createManagedRepositoryEnvironment({ writeHelper: await repositoryWriteHelper(), ...options, ...provisioned, resourceOwner: 'W', classification: ['shared'] });
    additional.push(fixed('agent.repository.snapshot.v1', 'snapshot-request', 'snapshot', 'read', ({ payload }) => leaf.snapshot(payload)),
      fixed('agent.repository.read.v1', 'read', 'evidence', 'read', ({ payload }) => leaf.read(payload)),
      fixed('agent.repository.read-window.v1', 'read-window', 'read-window-result', 'read', ({ payload }) => leaf.readWindow(payload)),
      fixed('agent.repository.prepare.v1', 'candidate-preparation', 'proposal', 'write', ({ payload }) => leaf.prepare(payload)));
    cleanupBindings.push(fixed('agent.repository.investigation-release.v1', 'cleanup', 'unit', 'read', ({ payload }) => { assert.deepEqual(payload, expectedTask.slice(0, 2)); cleanupCalls++; return null; }));
    cleanupBindings[0].cleanup = true;
    provider = createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const request = JSON.parse(Buffer.concat(chunks)), turn = modelTurn++; modelCalls++;
      const calls = request.input.filter(item => item.type === 'function_call');
      assert.equal(calls.length, turn, 'the provider can resume entirely from supplied replay');
      if (reviewFollowup === 'question' && turn >= 3) { assert(!request.tools.some(tool => ['edit', 'check'].includes(tool.name))); }
      const actionTurn = turn - workload.extraReads, followup = actionTurn >= 3;
      let action = turn < workload.extraReads ? ['read', { path: targetPath, offset: 0 }] : followup ? (reviewFollowup === 'question' ? (actionTurn === 3 ? [misuse ? 'edit' : 'read', misuse ? { operation: 'replace', path: targetPath, old_digest: candidate.edits[0].oldDigest, content: 'forbidden\n' } : { path: targetPath, offset: 0 }] : ['finish', { summary: 'Read-only question answered; candidate unchanged.' }]) : (actionTurn === 3 ? ['edit', { operation: 'replace', path: targetPath, old_digest: candidate.edits[0].oldDigest, content: content + 'revised\n' }] : actionTurn === 4 ? ['check', {}] : ['finish', { summary: 'Amended candidate independently checked.' }])) : mode === 0 ? ['finish', { summary: 'Inspected; no changes.' }] : actionTurn === 0 ? ['edit', { operation: 'replace', path: targetPath, old_digest: candidate.edits[0].oldDigest, content }] : actionTurn === 1 ? ['check', {}] : ['finish', { summary: 'Candidate independently checked.' }];
      if (revisionScenario) {
        const revisions = revisionScenario === 'nine' ? 9 : 8;
        const edit = revision => ['edit', { operation: 'replace', path: targetPath, old_digest: candidate.edits[0].oldDigest, content: content + `revision-${revision}\n` }];
        const finish = ['finish', { summary: 'Independently checked bounded candidates.' }];
        action = revisionScenario === 'repeat' ? (turn === 0 ? edit(1) : turn <= 16 ? ['check', {}] : finish) :
          turn < revisions * 2 ? (turn % 2 === 0 ? edit(turn / 2 + 1) : ['check', {}]) :
          revisionScenario === 'amend' && turn === 17 ? edit(9) : revisionScenario === 'amend' && turn === 18 ? ['check', {}] : finish;
      }
      res.end(JSON.stringify({ status: 'completed', error: null, output: [
        { type: 'reasoning', id: `reason-${turn}`, summary: [], encrypted_content: `opaque-${turn}` + 'x'.repeat(workload.replayPaddingBytes) },
        { type: 'function_call', id: `function-${turn}`, status: 'completed', call_id: `call-${turn}`, name: action[0], arguments: JSON.stringify(action[1]) },
      ] }));
    });
    await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
    t.after(async () => { provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); });
    additional.push(modelBinding(metadata('agent.model.invoke.v4', 'model-request', 'model-result', 'model'), {
      kind: 'openai-responses-replay', owner: 'W', mode: 'loopback-fixture', endpoint: `http://127.0.0.1:${provider.address().port}/v1/responses`,
      credentialEnv: null, model: 'fixture-model', parameters: { maxOutputTokens: 512, temperature: null, reasoning: null }, timeoutMs: 10000,
      maximumRequestBytes: 2 << 20, maximumResponseBytes: 2 << 20, disclosure: { audience: null, policyRevision: revision, labels: ['shared'] },
      allowance: { attempts: revisionScenario ? 32 : comparison ? 3 + workload.extraReads : sessionTasks ? sessionTasks * 3 : reviewFollowup === 'amend' ? 6 : reviewFollowup ? 5 : 3, request_bytes: 16 << 20, output_tokens: revisionScenario ? 16384 : 3072, concurrent: 1 },
    }, 'W'));
  }
  const workspaceBindings = [check, prepare, current, publish, ...additional];
  for (const binding of workspaceBindings) comparison?.leaf?.(binding);
  if (stationary) for (const binding of workspaceBindings) {
    const originalCharge = binding.charge?.bind(binding);
    if (originalCharge) binding.charge = context => {
      const charge = originalCharge(context);
      return { ...charge, owner: 'U', grant: hash(canonical({ upstream: charge.grant, proxyOwner: 'U', resourceOwner: 'W', revision })) };
    };
    comparison.proxy(binding, context => {
      const run = journals.U.run(context.run.run_id), occurrence = journals.U.occurrence(context.occurrence.id);
      assert.equal(run.current_occurrence_id, context.occurrence.id); assert.equal(run.request_digest, context.run.request_digest);
      assert.equal(occurrence.status, 'DISPATCHING'); assert.equal(occurrence.attempt_id, context.occurrence.attempt_id);
      assert.equal(policies.U.dispatch(run, context.request).binding, binding);
    });
  }
  const limits = { maximum_moves: sessionTasks ? sessionTasks * 4 : mobile ? reviewFollowup ? 6 : 4 : 2, maximum_image_bytes: 8 << 20, maximum_outcome_bytes: 8 << 20 };
  for (const host of ['W', 'U']) {
    admissions[host] = new WorldAdmission(executionWorld, { kernelBytes, expectedSha256: identity.kernelSha256 });
    policies[host] = new HostPolicy({ hostId: host, trustDomain: 'fixture', runtimeProfile: identity.kernelSha256, revision, labelDestinations: { shared: ['W', 'U'] },
      bindings: host === 'W' ? [...workspaceBindings, ...cleanupBindings] : [issue, human, ...reviewBindings, ...cleanupBindings, ...(stationary ? workspaceBindings : [])], deployments: [{ imageDigest: hash(image), programId, tenant: 'tenant', principals: ['user'],
        issuers: ['issuer'], hosts: ['W', 'U'], classification: ['shared'], cleanup: cleanupBindings.map(requirement), controlPeers: ['W', 'U'], limits, exportPolicies: { shared: ['W', 'U'] } }] });
  }
  function open(host, create) {
    journals[host] = new CustodyJournal({ directory: join(root, host), hostId: host, deploymentGeneration: 'generation', keys, admission: admissions[host], create,
      signer: { keyId: host, privateKey: pairs[host].privateKey, policyRevision: revision }, ...(comparison?.journalFault ? { fault: point => comparison.journalFault(host, point) } : {}) });
    hosts[host] = new Custodian({ journal: journals[host], admission: admissions[host], world, policy: policies[host], peers: peers[host] });
  }
  for (const host of ['W', 'U']) open(host, true);
  for (const [sourceHost, destination] of [['W', 'U'], ['U', 'W']]) peers[sourceHost].set(destination, {
    preflight: metadata => { if (refuseReturn && sourceHost === 'W' && counts.publish) throw Object.assign(Error('ReturnUnavailable'), { code: 'DestinationDenied' }); return hosts[destination].preflight(sourceHost, metadata); }, status: offer => hosts[destination].queryTransfer(sourceHost, offer),
    deliver: envelope => hosts[destination].receiveOffer(sourceHost, envelope), withdraw: envelope => hosts[destination].withdraw(sourceHost, envelope),
    control: (...args) => hosts[destination].control(sourceHost, ...args),
  });
  t.after(async () => { for (const host of ['W', 'U']) { await hosts[host].stopOperations(); hosts[host].retireAll(); journals[host].close(); } await rm(root, { recursive: true, force: true }); });
  if (comparison?.transport) await comparison.transport({ root, hosts, peers, pairs, keys, world, journals, image, identity });
  let id = runId('issuer'); const registration = signRecord('run', { format: 'agent-mobility-run/v1', run_id: id, issuer_id: 'issuer', principal_ref: 'user', tenant_ref: 'tenant',
    image_digest: hash(image), program_id: programId, trusted_runtime_profile: identity.kernelSha256, allowed_host_policy_ref: 'fixture', deployment_policy_revision: revision,
    initial_classification: ['shared'], initial_host_id: mobile ? 'U' : 'W', initial_epoch: '0', deployment_limits: limits, key_id: 'issuer' }, pairs.issuer.privateKey);
  let catalogue = null;
  if (intake) {
    assert(mobile && engine);
    const assets = { image, schema: bytes.session, report: bytes.result, task: encodeValue(schemas.session, [decodeValue(schemas.task, task), sessionTasks || 1]), key: pairs.issuer.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
    catalogue = taskCatalogue({ issuer: { id: 'issuer', keyId: 'issuer', privateKey: 'key' }, entries: [{ id: 'repository', title: 'Qualified managed repository', image: 'image', programId,
      taskSchema: 'schema', reportSchema: 'report', initialTask: 'task', modes: ['inspect', 'propose', 'publish'], principals: [{ tenant: 'tenant', principal: 'user', taskPrincipal: '7' }],
      scope: { read: [targetPath], write: [targetPath], checks: ['fixture-content'], target: 'refs/heads/agent/result' }, profile: 'bounded', presentation: { audience: 'human', labels: ['shared'], revision },
    }] }, { bytes: name => assets[name], keys, runtimeProfile: identity.kernelSha256,
      config: { hostId: 'U', trustDomain: 'fixture', revision, revoked: [], deployments: [{ imageDigest: hash(image), programId, tenant: 'tenant', principals: ['user'], issuers: ['issuer'], hosts: ['U', 'W'], classification: ['shared'], limits }] },
      custodian: { async registerRun(record, image, args) { expectedTask = decodeValue(schemas.session, args)[0]; expectedTask[1] = 1n; return hosts.U.registerRun(record, image, args); }, status: id => hosts.U.status(id) } });
  } else {
    comparison?.begin?.();
    if (sessionInput) expectedTask[1] = 1n;
    await hosts[activeHost].registerRun(registration, image, sessionInput ? encodeValue(schemas.session, [expectedTask, sessionTasks || 1]) : task);
  }
  let browserPage;
  if (engine) {
    assert(mobile);
    const tls = await certificates(root), origin = await serveBrowser(hosts.U, { ...tls.A, catalogue, audience: 'human', runtimePath: resolve(process.env.AGENT_MOBILITY_RUNTIME), kernelBytes,
      authenticate: () => ({ sessionId: 'worker-test', principal: 'user', tenant: 'tenant', audiences: ['human'] }) });
    const browser = await engine.launch({ headless: true });
    t.after(async () => { await browser.close(); await origin.close(); });
    browserPage = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
    await browserPage.goto(origin.url);
    if (intake) {
      await browserPage.locator('#start-task').waitFor({ state: 'visible' });
      assert.equal(await browserPage.locator('#task-mode').inputValue(), 'propose');
      await browserPage.locator('#task-mode').selectOption(['inspect', 'propose', 'publish'][mode]);
      await browserPage.locator('#task-goal').fill('Make the bounded independently checked change.');
      await browserPage.locator('#start-task button').click();
      await browserPage.locator('#status').filter({ hasText: 'Task registered' }).waitFor();
      id = await browserPage.locator('#run').inputValue(); assert.match(id, /^issuer:/);
    }
    await browserPage.evaluate(async id => { const { BrowserExecutor } = await import('/client.mjs'); window.executor = await new BrowserExecutor(id).initialize(); }, id);
  }
  async function runOriginWorker() {
    for (let n = 0; n < 1000; n++) {
      const result = await browserPage.evaluate(async () => {
        if (!window.executor.worker) await window.executor.attach();
        const result = await window.executor.advance();
        if (result.kind === 'offered' || result.status?.custody === 'TERMINAL') await window.executor.retire();
        return result;
      });
      if (result.kind === 'offered') return result;
      if (result.status?.custody === 'TERMINAL') return { kind: 'terminal', status: result.status };
      if (result.kind === 'blocked' && result.status?.occurrence === 'AWAITING') return { kind: 'awaiting', status: result.status };
      await delay(1);
    }
    assert.fail('browser Worker transition bound');
  }
  const moves = [];
  comparison?.registered?.();
  return { get id() { return id; }, counts, store, base, moves, image, task, initialArgs: sessionInput ? encodeValue(schemas.session, [expectedTask, sessionTasks || 1]) : task, identity, root,
    async registerFresh() {
      assert(comparison && mode === 1);
      id = runId('issuer'); activeHost = 'U'; modelTurn = modelCalls = cleanupCalls = reviewAnswers = 0; reviewRestarted = false;
      moves.length = 0; counts.check = counts.publish = counts.human = 0; issued.clear();
      const value = parse(registration); delete value.signature; value.run_id = id;
      comparison.begin?.();
      await hosts.U.registerRun(signRecord('run', value, pairs.issuer.privateKey), image, encodeValue(schemas.session, [expectedTask, 1])); comparison.registered?.();
    }, get modelCalls() { return modelCalls; }, get cleanupCalls() { return cleanupCalls; }, get journal() { return journals[activeHost]; },
    async run() {
      let transitions = 0;
      for (let n = 0; n < 1000; n++) {
        const result = browserPage && activeHost === 'U' ? await runOriginWorker() : await hosts[activeHost].run(id);
        if (result.kind === 'dispatching') { await delay(10); continue; }
        assert(++transitions <= (sessionTasks ? sessionTasks * 7 : mobile ? reviewFollowup ? 10 : 7 : 5), 'bounded authored transitions');
        if (result.kind === 'awaiting') {
          const identity = { principal: 'user', tenant: 'tenant', audiences: ['human'] };
          const pending = hosts[activeHost].pendingQuestion(id, identity);
          comparison?.question?.(pending);
          if (pending.pending.question.kind === 'repository-next-task') {
            assert.equal(cleanupCalls, Number(expectedTask[1]));
            if (!browserPage) {
              await hosts[activeHost].stopOperations(); hosts[activeHost].retireAll(); journals[activeHost].close(); open(activeHost, false);
              assert.deepEqual(hosts[activeHost].pendingQuestion(id, identity), pending, 'next-task prompt survives origin restart');
            }
            const { version, occurrence_id, request_digest, pending_digest } = pending;
            const reply = { version, occurrence_id, request_digest, pending_digest, answer: { choice: ['inspect', 'propose', 'publish'][nextMode ?? mode], text: 'Perform the next independently checked task.' } };
            if (browserPage) {
              await browserPage.evaluate(() => window.executor.retire());
              await browserPage.locator('#run').fill(id); await browserPage.locator('#connect').click();
              await browserPage.locator('#answer').waitFor({ state: 'visible' });
              assert.match(await browserPage.locator('#question').textContent(), /Task 1 is finished/);
              const exported = await browserPage.evaluate(async () => (await fetch(document.querySelector('#export-result').href)).json());
              assert.equal(exported.value[1], '1', 'the completed task report is exportable before the next task');
              await browserPage.locator('#choice').selectOption('inspect');
              await browserPage.locator('#answer-text').fill(reply.answer.text); await browserPage.locator('#answer button').click();
              await browserPage.locator('#status').filter({ hasText: 'Response saved' }).waitFor();
              await browserPage.reload();
              await browserPage.evaluate(async id => { const { BrowserExecutor } = await import('/client.mjs'); window.executor = await new BrowserExecutor(id).initialize(); }, id);
            } else await hosts[activeHost].answerQuestion(id, identity, reply);
            await assert.rejects(hosts[activeHost].answerQuestion(id, identity, { ...reply, answer: { choice: 'publish', text: 'Reuse old approval.' } }));
            expectedTask[1]++; mode = nextMode ?? mode; expectedTask[2] = mode; modelTurn = 0;
            continue;
          }
          assert.equal(pending.pending.question.kind, mobile && mode !== 2 ? 'repository-review' : 'repository-publication-approval');
          if (onQuestion) { await onQuestion({ root, host: hosts[activeHost], id, identity, kernelBytes, pending, content }); continue; }
          if (mobile) assert.equal(cleanupCalls, sessionTasks ? Number(expectedTask[1]) - 1 : 0, 'the original investigator is still retained during review');
          if (restartReview && !reviewRestarted) {
            reviewRestarted = true; await hosts[activeHost].stopOperations(); hosts[activeHost].retireAll(); journals[activeHost].close(); open(activeHost, false);
            assert.deepEqual(hosts[activeHost].pendingQuestion(id, identity), pending, 'pending review survives origin process memory loss');
          }
          if (cancelReview) { await hosts[activeHost].cancelRun(id, 'cancel during retained review'); continue; }
          const followup = reviewFollowup && reviewAnswers++ === 0;
          const { version, occurrence_id, request_digest, pending_digest } = pending;
          await hosts[activeHost].answerQuestion(id, identity, { version, occurrence_id, request_digest, pending_digest, answer: { choice: followup ? reviewFollowup : pending.pending.question.kind === 'repository-review' ? 'finish' : 'approve', text: followup ? 'Explain the relevant source.' : '' } });
          continue;
        }
        if (result.kind !== 'offered') return result;
        const transfer = journals[activeHost].transfer(result.transfer_id), offer = JSON.parse(Buffer.from(transfer.offer));
        assert.equal((await hosts[activeHost].retryTransfer(result.transfer_id)).kind, 'accepted');
        moves.push([activeHost, offer.destination_host_id]); activeHost = offer.destination_host_id;
      }
      assert.fail('bounded approval did not complete');
    },
    restart() { hosts[activeHost].retireAll(); journals[activeHost].close(); open(activeHost, false); },
    outcomeKind() { const journal = journals[activeHost], run = journal.run(id); return world.decodeOutcome(journal.artifact('tenant', run.outcome_digest)).kind; },
    outcome() { const journal = journals[activeHost], run = journal.run(id), outcome = world.decodeOutcome(journal.artifact('tenant', run.outcome_digest));
      assert.equal(outcome.kind, 'completed'); return decodeValue(schemas.result, outcome.value); },
    status(host = activeHost) { return hosts[host].status(id); },
    checkAllowance() { return journals[spendingHost].allowance(id, 'check'); },
    modelAllowance() { return journals[spendingHost].allowance(id, 'model'); },
    result() { const outcome = this.outcome(); assert.equal(outcome.tag, 0); return outcome.value; } };

}
