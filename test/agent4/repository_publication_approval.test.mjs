// Actual compiled approval, World custody, SQLite and managed Git. The human
// and independent content check are deterministic reference capabilities.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { artifactRoot } from './artifacts.mjs';
import { verifyRuntime } from '../../tools/agent4/dependencies.mjs';
import { encodeValue, decodeValue, decodeSchema } from '../../runtime/values.mjs';
import { provisionRepository, openRepositorySnapshotStore } from '../../runtime/repository_snapshot.mjs';
import { repositoryApprovalBinding } from '../../runtime/mobility/repository_approval.mjs';
import { repositoryPublicationBinding, PUBLICATION } from '../../runtime/mobility/repository_publication.mjs';
import { WorldAdmission } from '../../runtime/mobility/admission.mjs';
import { CustodyJournal } from '../../runtime/mobility/journal.mjs';
import { BrowserSessions } from '../../runtime/mobility/sessions.mjs';
import { serveBrowser } from '../../runtime/mobility/browser.mjs';
import { certificates } from './mobility_tls_fixture.mjs';
import { Custodian } from '../../runtime/mobility/custodian.mjs';
import { HostPolicy, requirement } from '../../runtime/mobility/policy.mjs';
import { hash, canonical, runId, signRecord } from '../../runtime/mobility/protocol.mjs';

const text = value => Buffer.from(canonical(value, 2 << 20)).toString('utf8');
const env = { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 'Approval fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Approval fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
async function fixture(t, { staleAnswer = false, wrongPrincipal = false, lostReply = false, onQuestion = null, content = 'independently checked\n' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'repository-approval-'));
  const git = await realpath(execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim());
  const source = join(root, 'source.git');
  const command = (...args) => execFileSync(git, ['--git-dir=' + source, ...args], { env, encoding: 'utf8' }).trim();
  command('init', '--bare', '--quiet', '--template=');
  const tree = command('mktree'), base = command('commit-tree', tree, '-m', 'base');
  command('update-ref', 'refs/heads/fixture', base);
  const options = { directory: join(root, 'managed'), sourceGitDirectory: source, base, gitExecutable: git,
    repository: 'fixture', generation: 'generation', managedRef: 'refs/heads/agent/result', readPaths: ['fix.txt'], writablePaths: ['fix.txt'] };
  const provisioned = await provisionRepository(options), store = await openRepositorySnapshotStore({ ...options, ...provisioned });
  const snapshot = await store.snapshot(base), candidate = await store.prepare(snapshot, [
    { path: 'fix.txt', operation: 'create', oldDigest: null, oldMode: null, content }]);
  const identity = verifyRuntime(resolve(process.env.AGENT_MOBILITY_RUNTIME)), world = await import(pathToFileURL(identity.entrypoint));
  const kernelBytes = await readFile(identity.kernelPath), image = await readFile(`${artifactRoot}/agent4/repository-approval/program.bpi3`);
  const names = ['task', 'preparation', 'result', 'proposal', 'receipt', 'delivery', 'human', 'human-reply', 'identifier', 'boolean'];
  const bytes = Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(`${artifactRoot}/agent4/repository-approval/${name}.schema`)])));
  const schemas = Object.fromEntries(names.map(name => [name, decodeSchema(bytes[name])]));
  const metadata = (operation, input, output, role) => ({ operation, payloadSchema: bytes[input], resultSchema: bytes[output], role,
    subject: 'fixture', subjectVersion: null, scope: operation, audience: role === 'approval' ? 'human' : null,
    trustDomain: 'fixture', tenants: ['tenant'], principals: ['user'], classification: ['shared'], allowedStateLabels: ['shared'], cleanup: false });
  const publishMetadata = metadata(PUBLICATION, 'proposal', 'delivery', 'commit');
  const placement = [[[requirement(publishMetadata)], [[], { tag: 0, value: null }, { tag: 0, value: null }, 8n << 20n]], 'publish', 'shared', [1, 1]];
  const humanMetadata = metadata('agent.interaction.exchange.v1.repository.publish', 'human', 'human-reply', 'approval');
  const humanPlacement = [[[requirement(humanMetadata)], [[], { tag: 0, value: null }, { tag: 0, value: null }, 8n << 20n]], 'review', 'shared', [2, 1]];
  const task = encodeValue(schemas.task, [7n, text(candidate), humanPlacement, placement]);
  // Derive the program identity from its actual first request, before effects.
  const kernel = await world.Kernel.create({ bytes: kernelBytes, expectedSha256: identity.kernelSha256 });
  kernel.setLimits({ input: 8 << 20, working: 64 << 20, output: 8 << 20 });
  const prepared = kernel.prepare(image), session = kernel.start(prepared, task);
  const first = world.decodeOutcome(kernel.drive(session, { checkpoint: true }));
  const programId = Buffer.from((await world.decodeRequest(first.request)).programIdentity).toString('hex');
  kernel.checkpoint(session, { transfer: true }); kernel.releasePrepared(prepared);
  const pairs = Object.fromEntries(['issuer', 'W', 'U'].map(host => [host, generateKeyPairSync('ed25519')]));
  const keys = new Map(Object.entries(pairs).map(([host, pair]) => [host, { owner: host, status: 'active', publicKey: pair.publicKey }]));
  const journals = {}, hosts = {}, policies = {}, admissions = {}, peers = { W: new Map(), U: new Map() };
  let activeHost = 'W';
  const counts = { check: 0, publish: 0, human: 0 }, issued = new Set();
  const profileDigest = '3'.repeat(64), runner = '4'.repeat(64);
  const configuration = { store, helper: { path: process.env.AGENT_PUBLICATION_GATE, sha256: hash(await readFile(process.env.AGENT_PUBLICATION_GATE)) },
    protectedImages: [{ image: hash(image), program: programId }], authorizationDigest: '1'.repeat(64), validationPolicyDigest: '2'.repeat(64),
    requiredProfiles: [{ id: 'fixture-content', profileDigest, runner }], checkResultSchema: bytes.proposal,
    services: () => ({ journal: journals.W, policy: policies.W }) };
  const publish = repositoryPublicationBinding(publishMetadata, configuration), original = publish.handle;
  publish.handle = async context => {
    counts.publish++; const result = await original(context);
    if (lostReply) throw Object.assign(Error('lost acquired reply'), { code: 'FixtureLostReply' });
    return result;
  };
  const current = repositoryPublicationBinding(metadata('agent.repository.publication-current.v1', 'proposal', 'boolean', 'read'), configuration);
  const fixed = (operation, input, output, role, handle) => ({ ...metadata(operation, input, output, role), authorize: () => true,
    handle: async context => encodeValue(schemas[output], await handle(context)) });
  const check = fixed('agent.repository.check.v1', 'proposal', 'proposal', 'write', async ({ payload, occurrence }) => {
    counts.check++; const exact = JSON.parse(payload), inputs = await store.checkInputs({ snapshot: exact.snapshot, candidate: exact, requiredPaths: ['fix.txt'] });
    assert.deepEqual(inputs.files['fix.txt'], Buffer.from(content));
    const record = { format: 'agent.repository.check/v1', occurrence: occurrence.id, snapshot: exact.snapshot, candidate: exact.id, tree: exact.tree,
      profile: 'fixture-content', profileDigest, runner, status: 'Passed', completedChecks: ['fixture-content'] };
    return text({ ...record, id: hash(canonical(record, 2 << 20)) });
  });
  const prepare = fixed('agent.repository.proposal.v1', 'preparation', 'proposal', 'write', async ({ payload, run, occurrence }) => text(await store.preparePublication({
    candidate: JSON.parse(payload[0]), validation: [JSON.parse(payload[1])],
    binding: { run: run.run_id, task: 'task', generation: '1', principal: run.principal_ref, tenant: run.tenant_ref, intent: hash(Buffer.from(occurrence.id)),
      policyRevision: 'p1', authorizationDigest: configuration.authorizationDigest, validationPolicyDigest: configuration.validationPolicyDigest },
    commit: { author: { name: 'Fixture', email: 'fixture@example.invalid' }, committer: { name: 'Fixture', email: 'fixture@example.invalid' }, timestamp: 1791150000, message: 'Exact approval fixture' },
  })));
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
  const limits = { maximum_moves: 2, maximum_image_bytes: 8 << 20, maximum_outcome_bytes: 8 << 20 };
  for (const host of ['W', 'U']) {
    admissions[host] = new WorldAdmission(world, { kernelBytes, expectedSha256: identity.kernelSha256 });
    policies[host] = new HostPolicy({ hostId: host, trustDomain: 'fixture', runtimeProfile: identity.kernelSha256, revision: 'p1', labelDestinations: { shared: ['W', 'U'] },
      bindings: host === 'W' ? [check, prepare, current, publish] : [issue, human], deployments: [{ imageDigest: hash(image), programId, tenant: 'tenant', principals: ['user'],
        issuers: ['issuer'], hosts: ['W', 'U'], classification: ['shared'], cleanup: [], controlPeers: ['W', 'U'], limits, exportPolicies: { shared: ['W', 'U'] } }] });
  }
  function open(host, create) {
    journals[host] = new CustodyJournal({ directory: join(root, host), hostId: host, deploymentGeneration: 'generation', keys, admission: admissions[host], create,
      signer: { keyId: host, privateKey: pairs[host].privateKey, policyRevision: 'p1' } });
    hosts[host] = new Custodian({ journal: journals[host], admission: admissions[host], world, policy: policies[host], peers: peers[host] });
  }
  for (const host of ['W', 'U']) open(host, true);
  for (const [sourceHost, destination] of [['W', 'U'], ['U', 'W']]) peers[sourceHost].set(destination, {
    preflight: metadata => hosts[destination].preflight(sourceHost, metadata), status: offer => hosts[destination].queryTransfer(sourceHost, offer),
    deliver: envelope => hosts[destination].receiveOffer(sourceHost, envelope), withdraw: envelope => hosts[destination].withdraw(sourceHost, envelope),
    control: (...args) => hosts[destination].control(sourceHost, ...args),
  });
  t.after(async () => { for (const host of ['W', 'U']) { hosts[host].retireAll(); journals[host].close(); } await rm(root, { recursive: true, force: true }); });
  const id = runId('issuer'), registration = signRecord('run', { format: 'agent-mobility-run/v1', run_id: id, issuer_id: 'issuer', principal_ref: 'user', tenant_ref: 'tenant',
    image_digest: hash(image), program_id: programId, trusted_runtime_profile: identity.kernelSha256, allowed_host_policy_ref: 'fixture', deployment_policy_revision: 'p1',
    initial_classification: ['shared'], initial_host_id: 'W', initial_epoch: '0', deployment_limits: limits, key_id: 'issuer' }, pairs.issuer.privateKey);
  await hosts.W.registerRun(registration, image, task);
  const moves = [];
  return { id, counts, store, base, moves, get journal() { return journals[activeHost]; },
    async run() {
      for (let n = 0; n < 5; n++) {
        const result = await hosts[activeHost].run(id);
        if (result.kind === 'awaiting') {
          const identity = { principal: 'user', tenant: 'tenant', audiences: ['human'] };
          const pending = hosts[activeHost].pendingQuestion(id, identity);
          assert.equal(pending.pending.question.kind, 'repository-publication-approval');
          if (onQuestion) { await onQuestion({ root, host: hosts[activeHost], id, identity, kernelBytes, pending, content }); continue; }
          const { version, occurrence_id, request_digest, pending_digest } = pending;
          await hosts[activeHost].answerQuestion(id, identity, { version, occurrence_id, request_digest, pending_digest, answer: { choice: 'approve', text: '' } });
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
    result() { const journal = journals[activeHost], run = journal.run(id), outcome = world.decodeOutcome(journal.artifact('tenant', run.outcome_digest));
      assert.equal(outcome.kind, 'completed'); return decodeValue(schemas.result, outcome.value); } };

}
test('actual private approval grants exactly the prepared managed publication', async t => {
  const f = await fixture(t); assert.equal((await f.run()).kind, 'terminal');
  const result = f.result(); assert.equal(result.tag, 0); assert.equal(result.value.tag, 0);
  const receipt = JSON.parse(result.value.value); assert.equal(receipt.commit, await f.store.current());
  assert.deepEqual(f.moves, [['W', 'U'], ['U', 'W']]);
  assert.notEqual(receipt.commit, f.base); assert.deepEqual(f.counts, { check: 1, publish: 1, human: 1 });
});
for (const option of ['staleAnswer', 'wrongPrincipal']) test(`actual approval rejects ${option} without reaching publisher`, async t => {
  const f = await fixture(t, { [option]: true }); assert.equal((await f.run()).kind, 'terminal');
  assert.notEqual(f.result().tag, 0); assert.equal(f.counts.publish, 0); assert.equal(await f.store.current(), f.base);
});
test('lost publication reply resumes its actual checkpoint and recovers without repeating the protected leaf', async t => {
  const f = await fixture(t, { lostReply: true });
  await assert.rejects(f.run(), { code: 'FixtureLostReply' });
  const commit = await f.store.current(); assert.notEqual(commit, f.base);
  f.journal.collectArtifacts('tenant'); f.restart();
  assert.equal((await f.run()).kind, 'terminal');
  assert.deepEqual(f.moves, [['W', 'U'], ['U', 'W']]);
  const result = f.result(), receipt = JSON.parse(result.value.value);
  assert.equal(result.tag, 0); assert.equal(result.value.tag, 0); assert.equal(receipt.commit, commit); assert.equal(receipt.recovered, true);
  assert.deepEqual(f.counts, { check: 1, publish: 1, human: 1 });
});

if (process.env.AGENT_MOBILITY_BROWSER_TOOLS) {
  const { chromium, firefox } = await import(pathToFileURL(join(resolve(process.env.AGENT_MOBILITY_BROWSER_TOOLS), 'node_modules/playwright-core/index.mjs')));
  for (const [name, engine] of [['chromium', chromium], ['firefox', firefox]]) test(`${name}: authenticated exact-change approval is inert and resumes the protected program`, async t => {
    const content = '<img src=x onerror="window.injected=true">\n' + 'x'.repeat(32000) + '\n';
    const f = await fixture(t, { content, onQuestion: async ({ root, host, id, kernelBytes, pending, content }) => {
      assert(Buffer.byteLength(JSON.stringify(pending)) > 65536, 'exercise a complete large proposal');
      const tls = await certificates(root), sessions = new BrowserSessions({ directory: join(root, 'sessions'), create: true,
        authorize: identity => identity.principal === 'user' && identity.tenant === 'tenant' && identity.audiences[0] === 'human' });
      const issued = sessions.issue({ principal: 'user', tenant: 'tenant', audience: 'human' });
      const origin = await serveBrowser(host, { ...tls.A, audience: 'human', runtimePath: resolve(process.env.AGENT_MOBILITY_RUNTIME), kernelBytes,
        authenticate: request => sessions.authenticate(request), redeem: (credential, audience) => sessions.redeem(credential, audience) });
      const browser = await engine.launch({ headless: true });
      try {
        const context = await browser.newContext({ ignoreHTTPSErrors: true }), page = await context.newPage();
        await page.goto(origin.url + '/login'); await page.locator('#credential').fill(issued.credential); await page.locator('#login button').click();
        await page.waitForURL(origin.url + '/'); await page.locator('#run').fill(id); await page.locator('#connect').click();
        await page.locator('#answer').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#question details').count(), 1);
        assert.equal(await page.locator('#question details pre').nth(1).textContent(), content);
        assert.equal(await page.locator('#question img').count(), 0); assert.equal(await page.evaluate(() => window.injected === true), false);
        assert.equal(await page.locator('#choice').inputValue(), '');
        await page.locator('#choice').selectOption('approve'); await page.locator('#answer button').click();
        await page.locator('#status').filter({ hasText: 'Response saved' }).waitFor();
      } finally { await browser.close(); await origin.close(); sessions.close(); }
    } });
    assert.equal((await f.run()).kind, 'terminal'); assert.equal(f.result().tag, 0);
    assert.deepEqual(f.moves, [['W', 'U'], ['U', 'W']]); assert.deepEqual(f.counts, { check: 1, publish: 1, human: 1 });
  });
}
