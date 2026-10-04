import { artifactRoot } from "./artifacts.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyRuntime } from '../../tools/agent4/dependencies.mjs';
import { encodeValue, decodeValue, decodeSchema } from '../../runtime/values.mjs';
import { createRepositoryDelivery } from '../../runtime/repository_delivery.mjs';
import { WorldAdmission } from '../../runtime/mobility/admission.mjs';
import { CustodyJournal } from '../../runtime/mobility/journal.mjs';
import { Custodian } from '../../runtime/mobility/custodian.mjs';
import { HostPolicy, requirement } from '../../runtime/mobility/policy.mjs';
import { version } from '../../runtime/mobility/custody.mjs';
import { hash, runId, signRecord, parse } from '../../runtime/mobility/protocol.mjs';

const READ = 'agent.mobility.fixture.target-read.v1', CHECK = 'agent.mobility.fixture.target-check.v1', WRITE = 'agent.mobility.fixture.replace.v1';
const ISSUE = 'agent.approval.issue.v1.mobility.replace', HUMAN = 'agent.interaction.exchange.v1.mobility.replace';
async function fixture(t, { staleEvidence = false, staleApproval = false, uncertainWrite = false } = {}) {
  const runtime = verifyRuntime(resolve(process.env.AGENT_MOBILITY_RUNTIME)), world = await import(pathToFileURL(runtime.entrypoint));
  const image = await readFile((artifactRoot + '/agent4/mobility-approval/program.bpi3')), programId = (await readFile((artifactRoot + '/agent4/mobility-approval/program-id.bin'))).toString('hex');
  const kernelBytes = await readFile(runtime.kernelPath), area = await mkdtemp(join(tmpdir(), 'mobility-approval-'));
  const file = join(area, 'document.txt'), original = 'An isolated fixture.\n', replacement = 'An approved replacement.\n';
  await writeFile(file, original); const base = hash(Buffer.from(original));
  const proposal = [['document.txt', base, replacement, 'Replace the isolated fixture'], 7n];
  const names = ['task', 'report', 'proposal', 'read', 'delivery', 'human', 'human-reply', 'identifier', 'integer', 'boolean'];
  const schemaBytes = Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(`${artifactRoot}/agent4/mobility-approval/${name}.schema`)])));
  const schemas = Object.fromEntries(names.map(name => [name, decodeSchema(schemaBytes[name])]));
  const delivery = await createRepositoryDelivery({ root: area });
  const counts = { reads: 0, checks: 0, writes: 0, approvals: 0 }, issued = [], answers = [], commits = [];
  const fixed = (operation, input, output, role, subject, scope, handle) => ({ operation, payloadSchema: schemaBytes[input], resultSchema: schemaBytes[output], role, subject, subjectVersion: null, scope,
    audience: role === 'approval' ? 'human-A' : null, trustDomain: 'fixture', tenants: ['tenant'], principals: ['user'], classification: ['shared'], allowedStateLabels: ['shared'], cleanup: false,
    authorize: role === 'approval' ? () => true : payload => payload[0][0] === 'document.txt' && payload[1] === 7n,
    handle: async args => encodeValue(schemas[output], await handle(args)) });
  const read = fixed(READ, 'proposal', 'read', 'read', 'fixture/document', 'read', async ({ payload }) => {
    counts.reads++; const actual = await delivery.read(payload);
    if (staleEvidence && actual.tag === 0) actual.value[0][1] = '0'.repeat(64);
    return actual;
  });
  const check = fixed(CHECK, 'proposal', 'boolean', 'read', 'fixture/document', 'check', async ({ payload }) => { counts.checks++; return (await delivery.read(payload)).tag === 0; });
  const write = fixed(WRITE, 'proposal', 'delivery', 'commit', 'fixture/document', 'replace', async ({ payload, run, occurrence }) => {
    counts.writes++; commits.push({ proposal: structuredClone(payload), run: structuredClone(run), occurrence: structuredClone(occurrence) });
    const result = await delivery.replace(payload);
    if (uncertainWrite) throw Object.assign(new Error('write response lost'), { code: 'FixtureWriteUnknown' });
    return result;
  });
  const issue = fixed(ISSUE, 'proposal', 'identifier', 'approval', 'human-A', 'issue', ({ occurrence }) => { issued.push(occurrence.id); return occurrence.id; });
  const human = fixed(HUMAN, 'human', 'human-reply', 'approval', 'human-A', 'approve', ({ payload }) => {
    counts.approvals++; const challenge = structuredClone(payload[3]);
    assert.deepEqual(challenge[1], proposal); assert.ok(issued.includes(challenge[0]));
    if (staleApproval) challenge[0] = '0'.repeat(64);
    const answer = { tag: 0, value: [challenge, 7n, { tag: 0, value: null }] }; answers.push(structuredClone(answer)); return answer;
  });
  const pairs = Object.fromEntries(['issuer', 'A', 'B'].map(owner => [owner, generateKeyPairSync('ed25519')]));
  const keys = new Map(Object.entries(pairs).map(([owner, pair]) => [owner, { owner, status: 'active', publicKey: pair.publicKey }]));
  const limits = { maximum_moves: 8, maximum_image_bytes: 8 << 20, maximum_outcome_bytes: 8 << 20 };
  const deployment = { imageDigest: hash(image), programId, tenant: 'tenant', principals: ['user'], issuers: ['issuer'], hosts: ['A', 'B'], classification: ['shared'], cleanup: [], controlPeers: ['A', 'B'], limits, exportPolicies: { shared: ['A', 'B'] } };
  const hosts = {}, journals = {}, peers = { A: new Map(), B: new Map() }, admissions = {}, policies = {};
  for (const host of ['A', 'B']) {
    admissions[host] = new WorldAdmission(world, { kernelBytes, expectedSha256: runtime.kernelSha256 });
    policies[host] = new HostPolicy({ hostId: host, trustDomain: 'fixture', runtimeProfile: runtime.kernelSha256, revision: 'p1', deployments: [deployment], bindings: host === 'A' ? [issue, human] : [read, check, write], labelDestinations: { shared: ['A', 'B'] } });
  }
  function open(host, create) {
    journals[host] = new CustodyJournal({ directory: join(area, host), hostId: host, deploymentGeneration: 'test-generation', keys,
      signer: { keyId: host, privateKey: pairs[host].privateKey, policyRevision: 'p1' }, admission: admissions[host], create });
    hosts[host] = new Custodian({ journal: journals[host], admission: admissions[host], world, policy: policies[host], peers: peers[host] });
  }
  for (const host of ['A', 'B']) open(host, true);
  t.after(async () => { for (const host of ['A', 'B']) { hosts[host].retireAll(); journals[host].close(); } await rm(area, { recursive: true, force: true }); });
  for (const [source, destination] of [['A', 'B'], ['B', 'A']]) peers[source].set(destination, {
    preflight: metadata => hosts[destination].preflight(source, metadata), status: offer => hosts[destination].queryTransfer(source, offer),
    deliver: envelope => hosts[destination].receiveOffer(source, envelope), withdraw: envelope => hosts[destination].withdraw(source, envelope),
    control: (...args) => hosts[destination].control(source, ...args),
  });
  const placement = (binding, moves) => [[[requirement(binding)], [[], { tag: 0, value: null }, { tag: 0, value: null }, 8n << 20n]], 'fixture-write', 'shared', [moves, 3]];
  const task = [9001n, proposal, placement(read, 3), placement(human, 2), placement(write, 1)];
  async function start() {
    const id = runId('issuer');
    const registration = signRecord('run', { format: 'agent-mobility-run/v1', run_id: id, issuer_id: 'issuer', principal_ref: 'user', tenant_ref: 'tenant', image_digest: hash(image), program_id: programId,
      trusted_runtime_profile: runtime.kernelSha256, allowed_host_policy_ref: 'fixture', deployment_policy_revision: 'p1', initial_classification: ['shared'], initial_host_id: 'A', initial_epoch: '0', deployment_limits: limits, key_id: 'issuer' }, pairs.issuer.privateKey);
    await hosts.A.registerRun(registration, image, encodeValue(schemas.task, task)); return id;
  }
  async function travel(id, onOffer = async () => {}) {
    let host = 'A'; const moves = [];
    for (let i = 0; i < 6; i++) {
      const result = await hosts[host].run(id);
      if (result.kind === 'terminal') {
        const run = journals[host].run(id), outcome = world.decodeOutcome(journals[host].artifact('tenant', run.outcome_digest));
        return { host, moves, run, outcome, value: outcome.kind === 'completed' ? decodeValue(schemas.report, outcome.value) : null };
      }
      assert.equal(result.kind, 'offered');
      const transfer = journals[host].transfer(result.transfer_id), offer = parse(transfer.offer);
      await onOffer({ host, offer, ordinal: i + 1, version: version(journals[host].run(id)) });
      const decision = await hosts[host].retryTransfer(result.transfer_id); assert.equal(decision.kind, 'accepted');
      moves.push([host, offer.destination_host_id, offer.destination_epoch]); host = offer.destination_host_id;
    }
    assert.fail('bounded program did not complete');
  }
  return { id: await start(), start, travel, hosts, journals, admissions, peers, world, schemas, counts, issued, answers, commits, file, original, replacement, proposal, human,
    restart(host) { hosts[host].retireAll(); journals[host].close(); open(host, false); hosts[host].recover(); } };
}

test('live evidence and private approved grant cross three actual moves before conditional fixture mutation', async t => {
  const f = await fixture(t); let granted;
  const result = await f.travel(f.id, async event => { if (event.ordinal === 3) { granted = event; f.restart('B'); } });
  assert.deepEqual(result.moves, [['A', 'B', '1'], ['B', 'A', '2'], ['A', 'B', '3']]);
  assert.deepEqual(result.value, [9001n, { tag: 0, value: { tag: 0, value: ['document.txt', f.proposal[0][1], hash(Buffer.from(f.replacement)), false] } }]);
  assert.equal(await readFile(f.file, 'utf8'), f.replacement); assert.deepEqual(f.counts, { reads: 1, checks: 1, writes: 1, approvals: 1 });
  assert.deepEqual(f.commits[0].proposal, f.proposal); assert.equal(f.commits[0].run.custody_epoch, '3');
  assert.throws(() => f.journals.A.admitLeaf(f.id, granted.version, []), { code: 'CustodyFrozen' });
  const committed = f.commits[0]; assert.throws(() => f.journals.B.admitLeaf(f.id, version(committed.run), []), { code: 'StaleExecutor' });
  assert.equal(f.counts.writes, 1);
});

for (const [mode, tag] of [['staleEvidence', 3], ['staleApproval', 2]]) test(`${mode} cannot authorize mutation after migration`, async t => {
  const f = await fixture(t, { [mode]: true }), result = await f.travel(f.id);
  assert.deepEqual(result.value, [9001n, { tag, value: null }]); assert.equal(result.moves.length, 2);
  assert.equal(await readFile(f.file, 'utf8'), f.original); assert.equal(f.counts.writes, 0); assert.equal(f.counts.checks, 0);
  assert.equal(f.counts.approvals, mode === 'staleEvidence' ? 0 : 1);
});

test('destination revalidation rejects an approved proposal whose file changed during the grant move', async t => {
  const f = await fixture(t), result = await f.travel(f.id, async event => { if (event.ordinal === 3) await writeFile(f.file, 'Concurrent fixture edit.\n'); });
  assert.deepEqual(result.value, [9001n, { tag: 3, value: null }]); assert.equal(result.moves.length, 3);
  assert.equal(await readFile(f.file, 'utf8'), 'Concurrent fixture edit.\n'); assert.equal(f.counts.writes, 0); assert.equal(f.counts.checks, 1);
});

test('a consumed approval reply cannot approve a later run with equal proposal bytes', async t => {
  const f = await fixture(t); await f.travel(f.id); const consumed = f.answers[0];
  await writeFile(f.file, f.original); f.human.handle = () => encodeValue(f.schemas['human-reply'], consumed);
  const later = await f.start(), result = await f.travel(later);
  assert.deepEqual(result.value, [9001n, { tag: 2, value: null }]); assert.notEqual(f.issued[0], f.issued[1]);
  assert.equal(await readFile(f.file, 'utf8'), f.original); assert.equal(f.counts.writes, 1);
});

test('lost write delivery remains pinned across restart and cancellation without a repeated mutation', async t => {
  const f = await fixture(t, { uncertainWrite: true });
  await assert.rejects(f.travel(f.id), { code: 'FixtureWriteUnknown' });
  assert.equal(await readFile(f.file, 'utf8'), f.replacement); assert.equal(f.counts.writes, 1);
  assert.equal(f.hosts.B.status(f.id).occurrence, 'UNKNOWN'); assert.equal(f.hosts.B.status(f.id).operation, WRITE);
  f.restart('B'); assert.equal((await f.hosts.B.run(f.id)).kind, 'effect_unknown');
  await f.hosts.B.cancelRun(f.id, 'stop'); assert.equal((await f.hosts.B.run(f.id)).kind, 'effect_unknown');
  assert.equal(f.counts.writes, 1); assert.equal(f.hosts.A.status(f.id).custody, 'DEPARTED');
});

for (const cancel of [false, true]) test(`${cancel ? 'cancellation' : 'refusal'} at grant placement cannot perform the approved write`, async t => {
  const f = await fixture(t);
  for (const source of ['A', 'B']) {
    const out = await f.hosts[source].run(f.id); assert.equal(out.kind, 'offered');
    assert.equal((await f.hosts[source].retryTransfer(out.transfer_id)).kind, 'accepted');
  }
  const grant = await f.hosts.A.run(f.id); assert.equal(grant.kind, 'offered'); assert.equal(f.counts.approvals, 1);
  if (cancel) assert.equal((await f.hosts.A.cancelRun(f.id, 'stop')).kind, 'cancel_requested');
  else assert.equal((await f.hosts.A.withdrawTransfer(grant.transfer_id)).kind, 'refused');
  assert.equal((await f.hosts.A.run(f.id)).kind, 'terminal');
  const run = f.journals.A.run(f.id), output = f.world.decodeOutcome(f.journals.A.artifact('tenant', run.outcome_digest));
  if (cancel) assert.equal(output.kind, 'cancelled');
  else assert.deepEqual(decodeValue(f.schemas.report, output.value), [9001n, { tag: 3, value: null }]);
  assert.equal(f.counts.writes, 0); assert.equal(f.counts.checks, 0); assert.equal(await readFile(f.file, 'utf8'), f.original);
});
