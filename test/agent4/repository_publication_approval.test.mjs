// Actual compiled approval, World custody, SQLite and managed Git. The human
// and independent content check are deterministic reference capabilities.
import test from 'node:test';
import { createServer } from 'node:http';
import { createManagedRepositoryEnvironment } from '../../runtime/repository.mjs';
import { modelBinding } from '../../runtime/mobility/model.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { artifactRoot } from './artifacts.mjs';
import { verifyRuntime } from '../../tools/agent4/dependencies.mjs';
import { encodeValue, decodeValue, decodeSchema } from '../../runtime/values.mjs';
import { provisionRepository, openRepositorySnapshotStore } from '../../runtime/repository_snapshot.mjs';
import { repositoryCheckBinding } from '../../runtime/mobility/repository_check.mjs';
import { repositoryApprovalBinding, repositoryReviewBinding } from '../../runtime/mobility/repository_approval.mjs';
import { repositoryPublicationBinding, repositoryProposalBinding, PUBLICATION } from '../../runtime/mobility/repository_publication.mjs';
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
async function fixture(t, { staleAnswer = false, wrongPrincipal = false, lostReply = false, onQuestion = null, content = 'independently checked\n', checkStatus = 'Passed', mobile = false, mode = 2, reviewFollowup = null, logicalSteps = 8, misuse = false, restartReview = false, cancelReview = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'repository-approval-'));
  const git = await realpath(execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim());
  const source = join(root, 'source.git');
  const command = (...args) => execFileSync(git, ['--git-dir=' + source, ...args], { env, encoding: 'utf8' }).trim();
  command('init', '--bare', '--quiet', '--template=');
  const tree = mobile ? execFileSync(git, ['--git-dir=' + source, 'mktree'], { env, encoding: 'utf8', input: `100644 blob ${execFileSync(git, ['--git-dir=' + source, 'hash-object', '-w', '--stdin'], { env, encoding: 'utf8', input: 'before\n' }).trim()}\tfix.txt\n` }).trim() : command('mktree');
  const base = command('commit-tree', tree, '-m', 'base');
  command('update-ref', 'refs/heads/fixture', base);
  const options = { directory: join(root, 'managed'), sourceGitDirectory: source, base, gitExecutable: git,
    repository: 'fixture', generation: 'generation', managedRef: 'refs/heads/agent/result', readPaths: ['fix.txt'], writablePaths: ['fix.txt'] };
  const provisioned = await provisionRepository(options), store = await openRepositorySnapshotStore({ ...options, ...provisioned });
  const snapshot = await store.snapshot(base), candidate = await store.prepare(snapshot, [
    { path: 'fix.txt', operation: mobile ? 'replace' : 'create', oldDigest: mobile ? (await store.read(snapshot, 'fix.txt')).digest : null, oldMode: mobile ? '100644' : null, content }]);
  const identity = verifyRuntime(resolve(process.env.AGENT_MOBILITY_RUNTIME)), world = await import(pathToFileURL(identity.entrypoint));
  const kernelBytes = await readFile(identity.kernelPath), image = await readFile(`${artifactRoot}/agent4/${mobile ? 'mobile-repository' : 'repository-approval'}/program.bpi3`);
  const names = ['task', 'preparation', 'result', 'check-result', 'proposal', 'receipt', 'delivery', 'human', 'human-reply', 'identifier', 'boolean'];
  const bytes = Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(`${artifactRoot}/agent4/repository-approval/${name}.schema`)])));
  if (mobile) for (const name of ['task', 'report', 'snapshot-request', 'snapshot', 'read', 'evidence', 'cleanup', 'unit', 'model-request', 'model-result', 'candidate-preparation', 'review', 'review-answer', 'read-window', 'read-window-result']) {
    bytes[name === 'report' ? 'result' : name] = await readFile(`${artifactRoot}/agent4/mobile-repository/${name}.schema`);
  }
  const schemas = Object.fromEntries(Object.entries(bytes).map(([name, value]) => [name, decodeSchema(value)]));
  const metadata = (operation, input, output, role) => ({ operation, payloadSchema: bytes[input], resultSchema: bytes[output], role,
    subject: 'fixture', subjectVersion: null, scope: operation, audience: role === 'approval' ? 'human' : null,
    trustDomain: 'fixture', tenants: ['tenant'], principals: ['user'], classification: ['shared'], allowedStateLabels: ['shared'], cleanup: false });
  const publishMetadata = metadata(PUBLICATION, 'proposal', 'delivery', 'commit');
  const placement = [[[requirement(publishMetadata)], [[], { tag: 0, value: null }, { tag: 0, value: null }, 8n << 20n]], 'publish', 'shared', [1, 1]];
  const humanMetadata = metadata('agent.interaction.exchange.v1.repository.publish', 'human', 'human-reply', 'approval');
  const humanPlacement = [[[requirement(humanMetadata)], [[], { tag: 0, value: null }, { tag: 0, value: null }, 8n << 20n]], 'review', 'shared', [2, 1]];
  const workspace = mobile ? [[[requirement(metadata('agent.repository.snapshot.v1', 'snapshot-request', 'snapshot', 'read'))], [[], { tag: 0, value: null }, { tag: 0, value: null }, 8n << 20n]], 'workspace', 'shared', [reviewFollowup ? 6 : 4, 1]] : null;
  const task = encodeValue(schemas.task, mobile ? [1n, 1n, mode, 'Make the bounded independently checked change.', 'fixture', base, 'fix.txt', workspace, humanPlacement,
    ['fixture-model', [{ tag: 1, value: 512 }, { tag: 0, value: null }, { tag: 0, value: null }]], logicalSteps, reviewFollowup === 'amend' ? 2 : 1, 7n] : [7n, text(candidate), humanPlacement, placement]);
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
  let activeHost = mobile ? 'U' : 'W';
  const counts = { check: 0, publish: 0, human: 0 }, issued = new Set();
  const profileDigest = '3'.repeat(64), runner = '4'.repeat(64);
  const configuration = { store, helper: { path: process.env.AGENT_PUBLICATION_GATE, sha256: hash(await readFile(process.env.AGENT_PUBLICATION_GATE)) },
    protectedImages: [{ image: hash(image), program: programId }], authorizationDigest: '1'.repeat(64), validationPolicyDigest: '2'.repeat(64),
    requiredProfiles: [{ id: 'fixture-content', profileDigest, runner }], checkResultSchema: bytes['check-result'],
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
  const check = repositoryCheckBinding({ ...metadata('agent.repository.check.v1', 'proposal', 'check-result', 'write'),
    subjectVersion: provisioned.manifestSha256 }, { hostId: 'W',
    profile: { owner: 'W', repository: options.repository, generation: options.generation, manifest: provisioned.manifestSha256,
      profileId: 'fixture-content', profileDigest, runner, disclosure: { audience: null, labels: ['shared'] },
      allowance: { attempts: reviewFollowup === 'amend' ? 2 : 1, request_bytes: 4 << 20, concurrent: 1 } },
    runner: { runner, profiles: [{ id: 'fixture-content', digest: profileDigest }], async check({ candidate: exact, occurrence }) {
      counts.check++; const inputs = await store.checkInputs({ snapshot: exact.snapshot, candidate: exact, requiredPaths: ['fix.txt'] });
      assert.deepEqual(inputs.files['fix.txt'], Buffer.from(reviewFollowup === 'amend' && counts.check > 1 ? content + 'revised\n' : content));
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
  if (mobile) {
    const review = repositoryReviewBinding({ ...metadata('agent.repository.review.v1', 'review', 'review-answer', 'interaction'), audience: 'human' }, { kind: 'repository-review-human', revision: 'review-1' });
    const answer = review.answer; review.answer = context => { counts.human++; return answer(context); }; reviewBindings.push(review);
  }
  let modelCalls = 0, cleanupCalls = 0, reviewAnswers = 0, reviewRestarted = false, provider;
  if (mobile) {
    const leaf = await createManagedRepositoryEnvironment({ ...options, ...provisioned, resourceOwner: 'W', classification: ['shared'] });
    additional.push(fixed('agent.repository.snapshot.v1', 'snapshot-request', 'snapshot', 'read', ({ payload }) => leaf.snapshot(payload)),
      fixed('agent.repository.read.v1', 'read', 'evidence', 'read', ({ payload }) => leaf.read(payload)),
      fixed('agent.repository.read-window.v1', 'read-window', 'read-window-result', 'read', ({ payload }) => leaf.readWindow(payload)),
      fixed('agent.repository.prepare.v1', 'candidate-preparation', 'proposal', 'write', ({ payload }) => leaf.prepare(payload)));
    cleanupBindings.push(fixed('agent.repository.investigation-release.v1', 'cleanup', 'unit', 'read', ({ payload }) => { assert.deepEqual(payload, [1n, 1n]); cleanupCalls++; return null; }));
    cleanupBindings[0].cleanup = true;
    provider = createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const request = JSON.parse(Buffer.concat(chunks)), turn = modelCalls++;
      const calls = request.input.filter(item => item.type === 'function_call');
      assert.equal(calls.length, turn, 'the provider can resume entirely from supplied replay');
      if (reviewFollowup === 'question' && turn >= 3) { assert(!request.tools.some(tool => ['edit', 'check'].includes(tool.name))); }
      const followup = turn >= 3;
      const action = followup ? (reviewFollowup === 'question' ? (turn === 3 ? [misuse ? 'edit' : 'read', misuse ? { operation: 'replace', path: 'fix.txt', old_digest: candidate.edits[0].oldDigest, content: 'forbidden\n' } : { path: 'fix.txt', offset: 0 }] : ['finish', { summary: 'Read-only question answered; candidate unchanged.' }]) : (turn === 3 ? ['edit', { operation: 'replace', path: 'fix.txt', old_digest: candidate.edits[0].oldDigest, content: content + 'revised\n' }] : turn === 4 ? ['check', {}] : ['finish', { summary: 'Amended candidate independently checked.' }])) : mode === 0 ? ['finish', { summary: 'Inspected; no changes.' }] : turn === 0 ? ['edit', { operation: 'replace', path: 'fix.txt', old_digest: candidate.edits[0].oldDigest, content }] : turn === 1 ? ['check', {}] : ['finish', { summary: 'Candidate independently checked.' }];
      res.end(JSON.stringify({ status: 'completed', error: null, output: [
        { type: 'reasoning', id: `reason-${turn}`, summary: [], encrypted_content: `opaque-${turn}` },
        { type: 'function_call', id: `function-${turn}`, status: 'completed', call_id: `call-${turn}`, name: action[0], arguments: JSON.stringify(action[1]) },
      ] }));
    });
    await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
    t.after(async () => { provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); });
    additional.push(modelBinding(metadata('agent.model.invoke.v4', 'model-request', 'model-result', 'model'), {
      kind: 'openai-responses-replay', owner: 'W', mode: 'loopback-fixture', endpoint: `http://127.0.0.1:${provider.address().port}/v1/responses`,
      credentialEnv: null, model: 'fixture-model', parameters: { maxOutputTokens: 512, temperature: null, reasoning: null }, timeoutMs: 10000,
      maximumRequestBytes: 2 << 20, maximumResponseBytes: 2 << 20, disclosure: { audience: null, policyRevision: 'p1', labels: ['shared'] },
      allowance: { attempts: reviewFollowup === 'amend' ? 6 : reviewFollowup ? 5 : 3, request_bytes: 16 << 20, output_tokens: 3072, concurrent: 1 },
    }, 'W'));
  }
  const limits = { maximum_moves: mobile ? reviewFollowup ? 6 : 4 : 2, maximum_image_bytes: 8 << 20, maximum_outcome_bytes: 8 << 20 };
  for (const host of ['W', 'U']) {
    admissions[host] = new WorldAdmission(world, { kernelBytes, expectedSha256: identity.kernelSha256 });
    policies[host] = new HostPolicy({ hostId: host, trustDomain: 'fixture', runtimeProfile: identity.kernelSha256, revision: 'p1', labelDestinations: { shared: ['W', 'U'] },
      bindings: host === 'W' ? [check, prepare, current, publish, ...additional, ...cleanupBindings] : [issue, human, ...reviewBindings, ...cleanupBindings], deployments: [{ imageDigest: hash(image), programId, tenant: 'tenant', principals: ['user'],
        issuers: ['issuer'], hosts: ['W', 'U'], classification: ['shared'], cleanup: cleanupBindings.map(requirement), controlPeers: ['W', 'U'], limits, exportPolicies: { shared: ['W', 'U'] } }] });
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
  t.after(async () => { for (const host of ['W', 'U']) { await hosts[host].stopOperations(); hosts[host].retireAll(); journals[host].close(); } await rm(root, { recursive: true, force: true }); });
  const id = runId('issuer'), registration = signRecord('run', { format: 'agent-mobility-run/v1', run_id: id, issuer_id: 'issuer', principal_ref: 'user', tenant_ref: 'tenant',
    image_digest: hash(image), program_id: programId, trusted_runtime_profile: identity.kernelSha256, allowed_host_policy_ref: 'fixture', deployment_policy_revision: 'p1',
    initial_classification: ['shared'], initial_host_id: mobile ? 'U' : 'W', initial_epoch: '0', deployment_limits: limits, key_id: 'issuer' }, pairs.issuer.privateKey);
  await hosts[activeHost].registerRun(registration, image, task);
  const moves = [];
  return { id, counts, store, base, moves, get modelCalls() { return modelCalls; }, get cleanupCalls() { return cleanupCalls; }, get journal() { return journals[activeHost]; },
    async run() {
      let transitions = 0;
      for (let n = 0; n < 1000; n++) {
        const result = await hosts[activeHost].run(id);
        if (result.kind === 'dispatching') { await delay(10); continue; }
        assert(++transitions <= (mobile ? reviewFollowup ? 10 : 7 : 5), 'bounded authored transitions');
        if (result.kind === 'awaiting') {
          const identity = { principal: 'user', tenant: 'tenant', audiences: ['human'] };
          const pending = hosts[activeHost].pendingQuestion(id, identity);
          assert.equal(pending.pending.question.kind, mobile && mode !== 2 ? 'repository-review' : 'repository-publication-approval');
          if (onQuestion) { await onQuestion({ root, host: hosts[activeHost], id, identity, kernelBytes, pending, content }); continue; }
          if (mobile) assert.equal(cleanupCalls, 0, 'the original investigator is still retained during review');
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
    checkAllowance() { return journals.W.allowance(id, 'check'); },
    modelAllowance() { return journals.W.allowance(id, 'model'); },
    result() { const outcome = this.outcome(); assert.equal(outcome.tag, 0); return outcome.value; } };

}
test('actual private approval grants exactly the prepared managed publication', async t => {
  const f = await fixture(t); assert.equal((await f.run()).kind, 'terminal');
  const result = f.result(); assert.equal(result.tag, 0); assert.equal(result.value.tag, 0);
  const receipt = JSON.parse(result.value.value); assert.equal(receipt.commit, await f.store.current());
  assert.deepEqual(f.moves, [['W', 'U'], ['U', 'W']]);
  assert.notEqual(receipt.commit, f.base); assert.deepEqual(f.counts, { check: 1, publish: 1, human: 1 });
  assert.equal(f.checkAllowance().used.attempts, 1);
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
  assert.equal(f.checkAllowance().used.attempts, 1);
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

for (const [index, status] of ['Failed', 'Unavailable', 'TimedOut', 'Cancelled', 'InvalidOutput', 'Incomplete'].entries()) test(`authored ${status} check stops before proposal or approval`, async t => {
  const f = await fixture(t, { checkStatus: status });
  assert.equal((await f.run()).kind, 'terminal');
  const outcome = f.outcome(); assert.equal(outcome.tag, 1); assert.equal(outcome.value[0], index + 1);
  assert.equal(JSON.parse(outcome.value[1]).status, status);
  assert.equal(await f.store.current(), f.base); assert.deepEqual(f.moves, []);
  assert.deepEqual(f.counts, { check: 1, publish: 0, human: 0 });
});

for (const mode of [0, 1, 2]) test(`complete mobile application mode ${mode} uses real repository, durable model/check leaves and private approval`, async t => {
  const f = await fixture(t, { mobile: true, mode });
  assert.equal((await f.run()).kind, 'terminal');
  const report = f.outcome();
  assert.equal(report[0], 1n); assert.equal(report[1], 1n); assert.equal(report[2], mode);
  assert.equal(report[3], mode === 2 ? 0 : 2);
  assert.equal(f.cleanupCalls, 1);
  assert.equal(f.modelCalls, mode === 0 ? 1 : 3);
  assert.equal(f.modelAllowance().used.attempts, f.modelCalls);
  assert.deepEqual(f.moves, mode === 2 ? [['U', 'W'], ['W', 'U'], ['U', 'W'], ['W', 'U']] : [['U', 'W'], ['W', 'U']]);
  if (mode === 0) { assert.equal(report[5], ''); assert.equal(f.counts.check, 0); }
  else { assert.equal(JSON.parse(report[5]).core.validation[0].status, 'Passed'); assert.equal(f.checkAllowance().used.attempts, 1); }
  if (mode === 2) {
    assert.equal(report[6].tag, 1); assert.equal(report[6].value.tag, 0); assert.equal(report[6].value.value.tag, 0);
    const receipt = JSON.parse(report[6].value.value.value);
    assert.equal(receipt.commit, await f.store.current()); assert.notEqual(receipt.commit, f.base);
    assert.deepEqual(f.counts, { check: 1, publish: 1, human: 1 });
  } else { assert.deepEqual(report[6], { tag: 0, value: null }); assert.equal(await f.store.current(), f.base); assert.equal(f.counts.publish, 0); assert.equal(f.counts.human, 1); }
});

for (const reviewFollowup of ['question', 'amend']) test(`retained mobile review ${reviewFollowup} preserves the original investigator and remaining budgets`, async t => {
  const f = await fixture(t, { mobile: true, reviewFollowup });
  assert.equal((await f.run()).kind, 'terminal');
  assert.equal(f.outcome()[3], 0); assert.equal(f.cleanupCalls, 1);
  assert.equal(f.modelCalls, reviewFollowup === 'amend' ? 6 : 5);
  assert.equal(f.modelAllowance().used.attempts, f.modelCalls);
  assert.equal(f.counts.check, reviewFollowup === 'amend' ? 2 : 1);
  assert.equal(f.checkAllowance().used.attempts, f.counts.check);
  assert.equal(f.counts.publish, 1); assert.equal(f.counts.human, 2);
  assert.deepEqual(f.moves, [['U', 'W'], ['W', 'U'], ['U', 'W'], ['W', 'U'], ['U', 'W'], ['W', 'U']]);
  const proposal = JSON.parse(f.outcome()[5]);
  assert.equal(proposal.core.candidate.edits[0].content, 'independently checked\n' + (reviewFollowup === 'amend' ? 'revised\n' : ''));
});
for (const option of [{ logicalSteps: 3 }, { misuse: true }]) test(`review cannot reset logical work or authorize a view-only edit: ${JSON.stringify(option)}`, async t => {
  const f = await fixture(t, { mobile: true, reviewFollowup: 'question', ...option });
  assert.equal((await f.run()).kind, 'terminal');
  assert.equal(f.outcomeKind(), 'failed'); assert.equal(f.cleanupCalls, 1);
  assert.equal(f.modelCalls, option.logicalSteps ? 3 : 4);
  assert.equal(f.modelAllowance().used.attempts, f.modelCalls);
  assert.equal(f.counts.publish, 0); assert.equal(await f.store.current(), f.base);
});

test('pending full-application review survives an origin restart without repeating model or check work', async t => {
  const f = await fixture(t, { mobile: true, restartReview: true });
  assert.equal((await f.run()).kind, 'terminal'); assert.equal(f.outcomeKind(), 'completed');
  assert.equal(f.modelCalls, 3); assert.equal(f.cleanupCalls, 1);
  assert.deepEqual(f.counts, { check: 1, publish: 1, human: 1 });
});
test('cancellation at full-application review disposes its retained investigator and prevents publication', async t => {
  const f = await fixture(t, { mobile: true, cancelReview: true });
  assert.equal((await f.run()).kind, 'terminal'); assert.equal(f.outcomeKind(), 'cancelled');
  assert.equal(f.cleanupCalls, 1); assert.equal(f.modelCalls, 3); assert.equal(f.counts.publish, 0);
  assert.equal(await f.store.current(), f.base);
});
