import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { taskCatalogue } from '../../runtime/mobility/task_catalogue.mjs';
import { repositoryNextTaskBinding } from '../../runtime/mobility/repository_approval.mjs';
import { decodeSchema, decodeValue, encodeValue } from '../../runtime/values.mjs';
import { hash, verifyRecord } from '../../runtime/mobility/protocol.mjs';

const prefix = resolve(process.env.AGENT4_BUILD_PREFIX ?? 'zig-out');
const schemaBytes = readFileSync(`${prefix}/agent4/mobile-repository/session.schema`), schema = decodeSchema(schemaBytes);
const placement = [[[], [[], { tag: 0, value: null }, { tag: 0, value: null }, 8n << 20n]], 'work', 'shared', [4, 1]];
const initial = [1n, 1n, 1, 'Template', 'repo', 'a'.repeat(40), 'file.txt', placement, placement,
  ['model', [{ tag: 1, value: 512 }, { tag: 0, value: null }, { tag: 0, value: null }]], 8, 2, 1n];
function fixture() {
  const pair = generateKeyPairSync('ed25519'), image = Buffer.from('catalogue image'), registrations = [];
  const keys = new Map([['issuer-key', { owner: 'issuer', status: 'active', publicKey: pair.publicKey }]]);
  const assets = { key: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), image, schema: schemaBytes, task: encodeValue(schema, [initial, 4]) };
  const deployment = { imageDigest: hash(image), programId: '1'.repeat(64), tenant: 'tenant', principals: ['alice'], issuers: ['issuer'], hosts: ['U'], classification: ['shared'], limits: { maximum_moves: 4, maximum_image_bytes: 8 << 20, maximum_outcome_bytes: 8 << 20 } };
  const config = { hostId: 'U', trustDomain: 'domain', revision: 'p1', revoked: [], deployments: [deployment] };
  const configuration = { issuer: { id: 'issuer', keyId: 'issuer-key', privateKey: 'key' }, entries: [{
    id: 'repo', title: 'Repository', image: 'image', programId: deployment.programId, taskSchema: 'schema', reportSchema: 'schema', initialTask: 'task', modes: ['inspect', 'propose'],
    principals: [{ tenant: 'tenant', principal: 'alice', taskPrincipal: '7' }], scope: { read: ['file.txt'], write: ['file.txt'], checks: ['zig'], target: 'refs/heads/agent/result' }, profile: 'bounded', presentation: { audience: 'person', labels: ['shared'], revision: 'p1' },
  }] };
  const catalogue = taskCatalogue(configuration, { bytes: name => assets[name], keys, config, runtimeProfile: '2'.repeat(64), custodian: {
    async registerRun(record, receivedImage, args) { registrations.push({ record: verifyRecord('run', record, keys), image: receivedImage, task: decodeValue(schema, args)[0] }); },
    status: run_id => ({ run_id, custody: 'ACTIVE' }),
  } });
  return { catalogue, config, registrations, configuration };
}
const alice = { principal: 'alice', tenant: 'tenant' }, request = { entry: 'repo', mode: 'propose', goal: 'Fix the admitted file.' };
test('catalogue admission binds authenticated identity and fresh registrations without caller protocol bytes', async () => {
  const { catalogue, registrations, configuration } = fixture();
  assert.equal(catalogue.list(alice)[0].defaultMode, 'propose');
  const view = { image_digest: hash(Buffer.from('catalogue image')), classification: ['shared'] };
  catalogue.authorizeView({ ...alice, audiences: ['person'] }, view);
  assert.throws(() => catalogue.authorizeView({ ...alice, audiences: ['other'] }, view), /PresentationDenied/);
  assert.throws(() => catalogue.authorizeView({ ...alice, audiences: ['person'] }, { ...view, classification: ['server-only'] }), /PresentationDenied/);
  assert.deepEqual(catalogue.list({ ...alice, principal: 'other' }), []);
  configuration.entries[0].modes.push('publish');
  await assert.rejects(catalogue.start(alice, { ...request, mode: 'publish' }), /TaskDenied/);
  const first = await catalogue.start(alice, request), second = await catalogue.start(alice, request);
  assert.notEqual(first.run_id, second.run_id); assert.notEqual(registrations[0].task[0], registrations[1].task[0]);
  for (const { record, task } of registrations) {
    assert.equal(record.principal_ref, 'alice'); assert.equal(record.tenant_ref, 'tenant'); assert.equal(task[12], 7n);
    assert.equal(task[2], 1); assert.equal(task[3], request.goal); assert.deepEqual(task.slice(4, 12), initial.slice(4, 12));
  }
});
test('catalogue rejects identity, authority, goal and mode injection before registration', async () => {
  const { catalogue, config, registrations } = fixture();
  for (const value of [{ ...request, principal: 'admin' }, { ...request, mode: 'publish' }, { ...request, entry: 'unknown' }, { ...request, goal: '' }, { ...request, goal: 'é'.repeat(2049) }]) await assert.rejects(catalogue.start(alice, value));
  await assert.rejects(catalogue.start({ ...alice, tenant: 'other' }, request));
  config.revoked.push('tenant/alice');
  assert.deepEqual(catalogue.list(alice), []); await assert.rejects(catalogue.start(alice, request));
  assert.equal(registrations.length, 0);
});

test('deployment v1 rejects catalogue and v2 requires its explicit closed field', async t => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { openDeployment } = await import('../../runtime/mobility/deployment.mjs');
  const root = await mkdtemp(join(tmpdir(), 'catalogue-version-')); t.after(() => rm(root, { recursive: true, force: true }));
  const config = Object.fromEntries(['hostId', 'trustDomain', 'revision', 'worldRuntime', 'directory', 'deploymentGeneration', 'keys', 'signer', 'deployments', 'bindings', 'labelDestinations', 'revoked', 'peers', 'tls'].map(name => [name, null]));
  const path = join(root, 'config.json');
  for (const fields of [{ format: 'agent-mobility-deployment/v1', catalogue: {} }, { format: 'agent-mobility-deployment/v2' }, { format: 'agent-mobility-deployment/v2', catalogue: {}, unknown: true }]) {
    await writeFile(path, JSON.stringify({ ...config, execution: 'browser', ...fields }));
    await assert.rejects(openDeployment(path), { code: 'RecordFields' });
  }
});

test('next-task interaction cannot widen mode grants or submit an empty task', () => {
  const resultSchema = readFileSync(`${prefix}/agent4/mobile-repository/next-task-answer.schema`);
  const adapter = { kind: 'repository-next-task-human', revision: 'p1', modes: ['inspect'] };
  const binding = repositoryNextTaskBinding({ operation: 'agent.repository.next-task.v1', role: 'interaction', audience: 'person', resultSchema }, adapter);
  adapter.modes.push('publish');
  for (const answer of [{ choice: 'publish', text: 'Publish now' }, { choice: 'inspect', text: '' }, { choice: 'inspect', text: 'é'.repeat(2049) }]) assert.throws(() => binding.answer({ answer }), /InvalidTaskAnswer/);
  assert.deepEqual(decodeValue(decodeSchema(resultSchema), binding.answer({ answer: { choice: 'inspect', text: 'Inspect the caller.' } })), { tag: 1, value: ['Inspect the caller.', 0] });
  assert.deepEqual(decodeValue(decodeSchema(resultSchema), binding.answer({ answer: { choice: 'stop', text: '' } })), { tag: 0, value: null });
});
