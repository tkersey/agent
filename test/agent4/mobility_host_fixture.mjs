import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';
import { verifyRuntime } from '../../tools/agent4/dependencies.mjs';
import { encodeValue, decodeSchema } from '../../runtime/values.mjs';
import { WorldAdmission } from '../../runtime/mobility/admission.mjs';
import { CustodyJournal } from '../../runtime/mobility/journal.mjs';
import { Custodian } from '../../runtime/mobility/custodian.mjs';
import { HostPolicy, requirement } from '../../runtime/mobility/policy.mjs';
import { hash, runId, signRecord, parse } from '../../runtime/mobility/protocol.mjs';
import { subject, bindSubject, READ, CLOSE } from '../../runtime/text_inspection.mjs';
import { fileBinding } from '../../runtime/text_file.mjs';
export async function hostFixture(t, { privateData = false, privateCapture = false, lostAck = false, uncertainRead = false } = {}) {
  assert.ok(process.env.AGENT_MOBILITY_RUNTIME, 'AGENT_MOBILITY_RUNTIME required');
  const runtime = resolve(process.env.AGENT_MOBILITY_RUNTIME), identity = verifyRuntime(runtime), world = await import(pathToFileURL(identity.entrypoint));
  const kernelBytes = await readFile(identity.kernelPath), image = await readFile('zig-out/agent4/mobility/program.bpi3');
  const programId = (await readFile('zig-out/agent4/mobility/program-id.bin')).toString('hex');
  const area = await mkdtemp(join(tmpdir(), 'mobility-host-'));
  const content = new TextEncoder().encode('alpha\nbeta gamma\ndelta epsilon zeta\nomega\n');
  await writeFile(join(area, 'story.txt'), content);
  const declared = await subject('fixture/story', content), subjectVersion = Buffer.from(declared[1]).toString('hex');
  const names = ['task', 'report', 'read', 'text-reply', 'subject', 'inspection', 'integer', 'unit'];
  const schemaBytes = Object.fromEntries(await Promise.all(names.map(async name => [name, new Uint8Array(await readFile(`zig-out/agent4/mobility/${name}.schema`))])));
  const schemas = Object.fromEntries(names.map(name => [name, decodeSchema(schemaBytes[name])]));
  const pairs = Object.fromEntries(['issuer', 'A', 'B'].map(host => [host, generateKeyPairSync('ed25519')]));
  const keys = new Map(Object.entries(pairs).map(([owner, pair]) => [owner, { owner, status: 'active', publicKey: pair.publicKey }]));
  const limits = { maximum_moves: 16, maximum_image_bytes: 8 << 20, maximum_outcome_bytes: 8 << 20 };
  const counters = { A: { task: 0, present: 0, side: 0, cleanup: 0 }, B: { task: 0, present: 0, side: 0, cleanup: 0 }, deliveries: { A: 0, B: 0 }, bytes: { A: 0, B: 0 }, preflights: { A: 0, B: 0 } };
  const file = await fileBinding(declared, { root: area, path: 'story.txt' });
  const closeOnly = bindSubject(declared, null);
  let taskValue, dropped = false;
  const makeBinding = (host, operation, input, output, options) => ({ operation, payloadSchema: schemaBytes[input], resultSchema: schemaBytes[output],
    role: 'read', subject: 'child', subjectVersion: null, scope: 'child', trustDomain: 'fixture', audience: null, tenants: ['tenant'], principals: ['user'], classification: [],
    allowedStateLabels: ['origin-only', 'server-only', 'shared'], cleanup: false, ...options });
  const bindingSets = {};
  for (const host of ['A', 'B']) {
    const bindings = [
      makeBinding(host, CLOSE, 'subject', 'unit', { role: 'cleanup', subject: declared[0], subjectVersion, scope: 'close', cleanup: true,
        authorize: value => value[0] === declared[0] && Buffer.from(value[1]).toString('hex') === subjectVersion,
        handle: ({ request }) => (host === 'B' ? file : closeOnly).handle(request) }),
      makeBinding(host, 'agent.mobility.fixture.child-resumed.v1', 'integer', 'unit', { authorize: value => value === 77n,
        handle: () => { counters[host].side++; return new Uint8Array(); } }),
      makeBinding(host, 'agent.mobility.fixture.child-cleanup.v1', 'integer', 'unit', { role: 'cleanup', scope: 'cleanup', cleanup: true, authorize: value => value === 9001n,
        handle: () => { counters[host].cleanup++; return new Uint8Array(); } }),
    ];
    if (host === 'B') bindings.push(makeBinding(host, READ, 'read', 'text-reply', { subject: declared[0], subjectVersion, scope: 'read', classification: privateData ? ['server-only'] : ['shared'],
      authorize: value => value[0][0] === declared[0] && Buffer.from(value[0][1]).toString('hex') === subjectVersion,
      async handle({ request }) { const reply = await file.handle(request); if (uncertainRead) throw Object.assign(new Error('delivery uncertain'), { code: 'FixtureDeliveryUnknown' }); return reply; } }));
    if (host === 'A') {
      bindings.push(makeBinding(host, 'agent.mobility.fixture.task.v1', 'integer', 'task', { role: 'interaction', subject: 'human-A', scope: 'task', audience: 'human-A', allowedStateLabels: ['shared'], classification: privateCapture ? ['origin-only'] : ['shared'], authorize: value => value === 123n,
        handle: () => { counters.A.task++; return encodeValue(schemas.task, taskValue); } }));
      bindings.push(makeBinding(host, 'agent.mobility.fixture.present.v1', 'inspection', 'unit', { role: 'interaction', subject: 'human-A', scope: 'present', audience: 'human-A', allowedStateLabels: ['shared'], authorize: () => true,
        handle: ({ payload }) => { assert.deepEqual(payload, { tag: 0, value: [42n, 4n] }); counters.A.present++; return new Uint8Array(); } }));
    }
    bindingSets[host] = bindings;
  }
  const read = bindingSets.B.find(binding => binding.operation === READ), present = bindingSets.A.find(binding => binding.operation.endsWith('.present.v1'));
  const placement = (requirements, moves, intent, policy) => [[requirements, [[], { tag: 0, value: null }, { tag: 0, value: null }, 8n << 20n]], intent, policy, [moves, 3]];
  taskValue = [123n, 9001n, declared, placement([requirement(read)], 2, 'inspect', 'fixture-shared'), placement([requirement(present)], 1, 'present', privateData ? 'public' : 'fixture-shared')];
  const deployment = { imageDigest: hash(image), programId, tenant: 'tenant', principals: ['user'], hosts: ['A', 'B'], classification: ['shared'], limits,
    cleanup: bindingSets.A.filter(binding => binding.cleanup).map(requirement), controlPeers: ['A', 'B'], exportPolicies: { 'fixture-shared': ['A', 'B'], public: ['A', 'B'] } };
  const peerMaps = { A: new Map(), B: new Map() }, hosts = {}, journals = {}, policies = {}, admissions = {}, revoked = { A: new Set(), B: new Set() };
  for (const host of ['A', 'B']) {
    admissions[host] = new WorldAdmission(world, { kernelBytes, expectedSha256: identity.kernelSha256 });
    policies[host] = new HostPolicy({ hostId: host, trustDomain: 'fixture', runtimeProfile: identity.kernelSha256, revision: 'p1', deployments: [deployment], bindings: bindingSets[host], labelDestinations: { shared: ['A', 'B'], 'server-only': ['B'], 'origin-only': ['A'] }, revoked: revoked[host] });
  }
  function open(host, create) {
    journals[host] = new CustodyJournal({ directory: join(area, host), hostId: host, deploymentGeneration: 'generation-1', keys,
      signer: { keyId: host, privateKey: pairs[host].privateKey, policyRevision: 'p1' }, admission: admissions[host], create });
    hosts[host] = new Custodian({ journal: journals[host], admission: admissions[host], world, policy: policies[host], peers: peerMaps[host] });
  }
  open('A', true); open('B', true);
  for (const [source, destination] of [['A', 'B'], ['B', 'A']]) peerMaps[source].set(destination, {
    preflight(metadata) { counters.preflights[destination]++; return hosts[destination].preflight(source, metadata); },
    status(offer) { return hosts[destination].queryTransfer(source, offer); },
    async deliver(envelope) {
      counters.deliveries[destination]++; counters.bytes[destination] += envelope.image.length + envelope.outcome.length;
      const receipt = await hosts[destination].receiveOffer(source, envelope);
      if (lostAck && destination === 'B' && !dropped) { dropped = true; throw Object.assign(new Error('lost acceptance acknowledgment'), { code: 'ConnectionLost' }); }
      return receipt;
    },
    withdraw(envelope) { return hosts[destination].withdraw(source, envelope); },
    control(registration, id, action, reason, hops) { return hosts[destination].control(source, registration, id, action, reason, hops); },
  });
  t.after(async () => { for (const host of ['A', 'B']) { hosts[host].retireAll(); journals[host].close(); } await rm(area, { recursive: true, force: true }); });
  const registration = signRecord('run', { format: 'agent-mobility-run/v1', run_id: runId('issuer'), issuer_id: 'issuer', principal_ref: 'user', tenant_ref: 'tenant', image_digest: hash(image), program_id: programId,
    trusted_runtime_profile: identity.kernelSha256, allowed_host_policy_ref: 'fixture-hosts', deployment_policy_revision: 'p1', initial_classification: ['shared'], initial_host_id: 'A', initial_epoch: '0', deployment_limits: limits, key_id: 'issuer' }, pairs.issuer.privateKey);
  const id = parse(registration).run_id;
  await hosts.A.registerRun(registration, image, encodeValue(schemas.integer, 123n));
  return { hosts, journals, policies, admissions, peerMaps, pairs, keys, id, registration, image, world, counters, file, schemas, bindings: bindingSets, revoked, area,
    restart(host) { hosts[host].retireAll(); journals[host].close(); open(host, false); hosts[host].recover(); },
    result(host) { const run = journals[host].run(id); return world.decodeOutcome(journals[host].artifact('tenant', run.outcome_digest)); },
  };
}
