// Trusted, local deployment configuration. This loader is never reachable from
// a traveling image or peer request. Adapter selection is environmental only.
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyRuntime, readRegular } from '../../tools/agent4/dependencies.mjs';
import { decodeSchema, decodeValue, encodeValue } from '../values.mjs';
import { bindSubject, subjectSchema, READ, CLOSE } from '../text_inspection.mjs';
import { fileBinding } from '../text_file.mjs';
import { WorldAdmission } from './admission.mjs';
import { CustodyJournal } from './journal.mjs';
import { Custodian } from './custodian.mjs';
import { modelBinding } from './model.mjs';
import { repositoryApprovalBinding, repositoryReviewBinding, repositoryNextTaskBinding } from './repository_approval.mjs';
import { repositoryPublicationBinding, repositoryProposalBinding } from './repository_publication.mjs';
import { repositoryCheckBinding } from './repository_check.mjs';
import { createRepositoryCheckRunner } from '../repository_checks.mjs';
import { createZigRepositorySandbox } from '../repository_zig_sandbox.mjs';
import { selectZig } from '../../tools/agent4/toolchain.mjs';
import { openRepositorySnapshotStore } from '../repository_snapshot.mjs';
import { createManagedRepositoryEnvironment } from '../repository.mjs';
import { taskCatalogue } from './task_catalogue.mjs';
import { BrowserSessions } from './sessions.mjs';
import { serveBrowser } from './browser.mjs';
import { HostPolicy } from './policy.mjs';
import { PeerClient, servePeers } from './transport.mjs';
import { parse, requireThat, closed } from './canonical.mjs';
import { hash } from './protocol.mjs';
import { schemas } from './values.mjs';

export async function openDeployment(configPath, { create = false } = {}) {
  const root = dirname(resolve(configPath)), config = parse(readRegular(configPath, 1 << 20), { maximum: 1 << 20, canonicalOnly: false });
  closed(config, ['format', 'hostId', 'trustDomain', 'revision', 'worldRuntime', 'directory', 'deploymentGeneration', 'keys', 'signer', 'deployments', 'bindings', 'labelDestinations', 'revoked', 'peers', 'tls', 'execution', ...(Object.hasOwn(config, 'browser') ? ['browser'] : []), ...(config.format === 'agent-mobility-deployment/v2' ? ['catalogue'] : [])]);
  requireThat(['agent-mobility-deployment/v1', 'agent-mobility-deployment/v2'].includes(config.format) && ['node', 'browser'].includes(config.execution), 'DeploymentConfiguration');
  const path = value => { requireThat(typeof value === 'string' && value.length > 0, 'DeploymentPath'); return resolve(root, value); };
  const bytes = value => readRegular(path(value));
  // Authenticate the complete installed runtime before importing any of it.
  const runtimePath = path(config.worldRuntime), identity = verifyRuntime(runtimePath);
  const world = await import(pathToFileURL(identity.entrypoint));
  const kernelBytes = bytes(identity.kernelPath);
  const keys = new Map(config.keys.map(entry => {
    closed(entry, ['keyId', 'owner', 'status', 'publicKey']);
    return [entry.keyId, { owner: entry.owner, status: entry.status, publicKey: createPublicKey(bytes(entry.publicKey)) }];
  }));
  requireThat(keys.size === config.keys.length, 'DuplicateKey');
  const statistics = new Map();
  let publicationServices;
  const bindings = await Promise.all(config.bindings.map(async entry => {
    const { adapter, ...metadata } = entry;
    const binding = { ...metadata, payloadSchema: bytes(metadata.payloadSchema), resultSchema: bytes(metadata.resultSchema) };
    const counts = { calls: 0 }; statistics.set(binding.operation, counts);
    if (['repository-query', 'repository-prepare'].includes(adapter.kind)) {
      closed(adapter, ['kind', 'store', 'classification']);
      closed(adapter.store, ['directory', 'gitExecutable', 'repository', 'generation', 'manifestSha256']);
      const methods = new Map([
        ['agent.repository.snapshot.v1', 'snapshot'], ['agent.repository.read.v1', 'read'],
        ['agent.repository.list.v1', 'list'], ['agent.repository.search.v1', 'search'],
        ['agent.repository.read-window.v1', 'readWindow'],
        ['agent.repository.prepare.v1', 'prepare'],
      ]);
      const method = methods.get(binding.operation);
      requireThat(method && (adapter.kind === 'repository-prepare' ? method === 'prepare' && binding.role === 'write' : method !== 'prepare' && binding.role === 'read') && binding.subject === adapter.store.repository &&
        binding.subjectVersion === adapter.store.manifestSha256 &&
        JSON.stringify(binding.classification) === JSON.stringify(adapter.classification), 'AdapterContract');
      const leaf = await createManagedRepositoryEnvironment({ ...adapter.store, directory: path(adapter.store.directory),
        gitExecutable: path(adapter.store.gitExecutable), resourceOwner: config.hostId, classification: adapter.classification });
      const result = decodeSchema(binding.resultSchema);
      binding.authorize = payload => Array.isArray(payload) && (method === 'snapshot' ? payload[0] === adapter.store.repository :
        Array.isArray(payload[0]) && payload[0][0] === adapter.store.repository && payload[0][1] === adapter.store.generation);
      binding.handle = async ({ payload }) => { counts.calls++; return encodeValue(result, await leaf[method](payload)); };
      return binding;
    }
    if (adapter.kind === 'openai-responses-replay') {
      const leaf = modelBinding(binding, adapter, config.hostId), handle = leaf.handle;
      leaf.handle = context => { counts.calls++; return handle(context); };
      return leaf;
    }
    if (['repository-review-human', 'repository-next-task-human'].includes(adapter.kind)) {
      const leaf = (adapter.kind === 'repository-next-task-human' ? repositoryNextTaskBinding : repositoryReviewBinding)(binding, adapter), answer = leaf.answer;
      leaf.answer = context => { counts.calls++; return answer(context); };
      return leaf;
    }
    if (['repository-approval-issuer', 'repository-approval-human'].includes(adapter.kind)) {
      const leaf = repositoryApprovalBinding(binding, adapter), method = leaf.answer ? 'answer' : 'handle', original = leaf[method];
      leaf[method] = context => { counts.calls++; return original(context); };
      return leaf;
    }
    if (adapter.kind === 'repository-proposal') {
      closed(adapter, ['kind', 'store', 'protectedImages', 'authorizationDigest', 'validationPolicyDigest', 'requiredProfiles', 'checkResultSchema', 'commit']);
      closed(adapter.store, ['directory', 'gitExecutable', 'repository', 'generation', 'manifestSha256']);
      requireThat(binding.subject === adapter.store.repository && binding.subjectVersion === adapter.store.manifestSha256, 'AdapterContract');
      const store = await openRepositorySnapshotStore({ ...adapter.store, directory: path(adapter.store.directory), gitExecutable: path(adapter.store.gitExecutable) });
      const leaf = repositoryProposalBinding(binding, { ...adapter, store, checkResultSchema: bytes(adapter.checkResultSchema), services: () => publicationServices });
      const handle = leaf.handle; leaf.handle = context => { counts.calls++; return handle(context); };
      return leaf;
    }
    if (adapter.kind === 'repository-publication') {
      closed(adapter, ['kind', 'store', 'helper', 'protectedImages', 'authorizationDigest', 'validationPolicyDigest', 'requiredProfiles', 'checkResultSchema']);
      closed(adapter.store, ['directory', 'gitExecutable', 'repository', 'generation', 'manifestSha256']);
      closed(adapter.helper, ['path', 'sha256']);
      const store = await openRepositorySnapshotStore({ ...adapter.store, directory: path(adapter.store.directory), gitExecutable: path(adapter.store.gitExecutable) });
      const leaf = repositoryPublicationBinding(binding, { ...adapter, store, helper: { ...adapter.helper, path: path(adapter.helper.path) },
        checkResultSchema: bytes(adapter.checkResultSchema), services: () => publicationServices });
      const handle = leaf.handle; leaf.handle = context => { counts.calls++; return handle(context); };
      return leaf;
    }
    if (adapter.kind === 'repository-check') {
      closed(adapter, ['kind', 'store', 'profile', 'checkProfile', 'sandbox']);
      closed(adapter.store, ['directory', 'gitExecutable', 'repository', 'generation', 'manifestSha256']);
      closed(adapter.sandbox, ['zigExecutable', 'libraryDirectory', 'launcher', 'processLock', 'scratchRoot', 'timeoutMs', 'maximumOutputBytes', 'scratchBytes']);
      for (const helper of [adapter.sandbox.launcher, adapter.sandbox.processLock]) closed(helper, ['path', 'sha256']);
      requireThat(adapter.profile.repository === adapter.store.repository && adapter.profile.generation === adapter.store.generation &&
        adapter.profile.manifest === adapter.store.manifestSha256, 'RepositoryCheckBinding');
      const store = await openRepositorySnapshotStore({ ...adapter.store, directory: path(adapter.store.directory), gitExecutable: path(adapter.store.gitExecutable) });
      const toolchain = selectZig(['--zig-exe', path(adapter.sandbox.zigExecutable), '--zig-lib', path(adapter.sandbox.libraryDirectory)], { inherited: null, inheritedLibrary: null });
      const sandbox = await createZigRepositorySandbox({ ...adapter.sandbox, toolchain, scratchRoot: path(adapter.sandbox.scratchRoot),
        launcher: { ...adapter.sandbox.launcher, path: path(adapter.sandbox.launcher.path) },
        processLock: { ...adapter.sandbox.processLock, path: path(adapter.sandbox.processLock.path) } });
      const runner = createRepositoryCheckRunner({ store, sandbox, profiles: [adapter.checkProfile] });
      const leaf = repositoryCheckBinding(binding, { runner, profile: adapter.profile, hostId: config.hostId });
      const handle = leaf.handle; leaf.handle = context => { counts.calls++; return handle(context); };
      return leaf;
    }
    if (adapter.kind === 'repository-release') {
      closed(adapter, ['kind']);
      const payload = decodeSchema(binding.payloadSchema), result = decodeSchema(binding.resultSchema), fields = payload.types[payload.root]?.product;
      requireThat(binding.operation === 'agent.repository.investigation-release.v1' && binding.role === 'read' && binding.cleanup === true &&
        fields?.length === 2 && fields.every(id => payload.types[id] === 'u64') && result.types[result.root] === 'unit', 'AdapterContract');
      binding.authorize = value => Array.isArray(value) && value.length === 2 && value.every(id => typeof id === 'bigint' && id > 0n);
      // Checks own and reap their physical children/scratch before returning.
      // The investigation owns portable state only; acknowledging its cleanup
      // is still an ordinary journaled leaf occurrence, never host progression.
      binding.handle = () => { counts.calls++; return encodeValue(result, null); };
      return binding;
    }
    if (adapter.kind === 'fixed-reply') {
      closed(adapter, ['kind', 'payloadDigest', 'reply']);
      const reply = bytes(adapter.reply); decodeValue(decodeSchema(binding.resultSchema), reply);
      // Exact typed input admission belongs before dispatch, not after I/O.
      binding.authorize = payload => hash(encodeValue(decodeSchema(binding.payloadSchema), payload)) === adapter.payloadDigest;
      binding.handle = () => { counts.calls++; return Uint8Array.from(reply); };
    } else if (adapter.kind === 'human-text') {
      closed(adapter, ['kind', 'revision']);
      const result = decodeSchema(binding.resultSchema), limit = result.types[result.root]?.bounded_text;
      requireThat(typeof binding.audience === 'string' && Number.isSafeInteger(limit) && limit > 0 && limit <= 8192 && typeof adapter.revision === 'string' && adapter.revision.length > 0, 'AdapterContract');
      binding.deferredRevision = adapter.revision;
      binding.authorize = () => true;
      binding.defer = ({ payload }) => ({ audience: binding.audience, alternatives: ['respond'], maximum_text_bytes: limit,
        question: JSON.parse(JSON.stringify(payload, (_, value) => typeof value === 'bigint' ? value.toString() : value)) });
      binding.answer = ({ answer }) => { counts.calls++; return encodeValue(result, answer.text); };
    } else {
      requireThat(['text-file', 'text-close'].includes(adapter.kind), 'UnknownAdapter');
      closed(adapter, adapter.kind === 'text-file' ? ['kind', 'subject', 'root', 'path'] : ['kind', 'subject']);
      requireThat(binding.operation === (adapter.kind === 'text-file' ? READ : CLOSE), 'AdapterContract');
      const declared = decodeValue(subjectSchema, bytes(adapter.subject));
      requireThat(binding.subject === declared[0] && binding.subjectVersion === Buffer.from(declared[1]).toString('hex'), 'AdapterSubject');
      const leaf = adapter.kind === 'text-file' ? await fileBinding(declared, { root: path(adapter.root), path: adapter.path }) : bindSubject(declared, null);
      binding.authorize = payload => {
        const selected = binding.operation === READ ? payload[0] : payload;
        return selected[0] === declared[0] && selected[2] === declared[2] && Buffer.from(selected[1]).equals(Buffer.from(declared[1]));
      };
      binding.handle = async ({ request }) => { counts.calls++; return leaf.handle(request); };
      counts.text = leaf.counts;
    }
    return binding;
  }));
  const deployments = config.deployments.map(entry => ({ ...entry, cleanup: decodeValue(schemas.requirements, bytes(entry.cleanup)) }));
  const admission = new WorldAdmission(world, { kernelBytes, expectedSha256: identity.kernelSha256 });
  const policy = new HostPolicy({ ...config, runtimeProfile: identity.kernelSha256, deployments, bindings, revoked: new Set(config.revoked) });
  const journal = new CustodyJournal({ directory: path(config.directory), hostId: config.hostId, deploymentGeneration: config.deploymentGeneration, keys,
    signer: { ...config.signer, privateKey: createPrivateKey(bytes(config.signer.privateKey)) }, admission, create });
  publicationServices = Object.freeze({ journal, policy });
  const peers = new Map(), clients = [];
  try {
    const tls = { key: bytes(config.tls.key), cert: bytes(config.tls.cert), ca: bytes(config.tls.ca) };
    for (const entry of config.peers) {
      requireThat(!peers.has(entry.hostId), 'DuplicatePeer');
      const client = new PeerClient({ ...entry, ...tls }); clients.push(client); peers.set(entry.hostId, client);
    }
    const custodian = new Custodian({ journal, admission, world, policy, peers });
    const catalogue = config.format === 'agent-mobility-deployment/v2' ? taskCatalogue(config.catalogue, { bytes, keys, custodian, config, runtimeProfile: identity.kernelSha256 }) : null;
    let service = null, browserService = null, sessions = null;
    if (config.browser) {
      closed(config.browser, ['directory', 'audience', 'host', 'port', 'publicOrigin']);
      requireThat(config.execution === 'browser', 'BrowserExecutionRequired');
      sessions = new BrowserSessions({ directory: path(config.browser.directory), create,
        authorize: identity => identity.audiences[0] === config.browser.audience && !config.revoked.includes(`${identity.tenant}/${identity.principal}`) &&
          deployments.some(entry => entry.tenant === identity.tenant && entry.principals.includes(identity.principal)) });
    }
    return { config, identity, world, journal, custodian, admission, peers, runtimePath, kernelBytes, sessions, catalogue,
      statistics: () => Object.fromEntries([...statistics].map(([name, value]) => [name, { calls: value.calls, ...(value.text ? value.text() : {}) }])),
      async serve() {
        requireThat(service === null, 'AlreadyServing');
        service = await servePeers(custodian, { ...tls, host: config.tls.host, port: config.tls.port, peerCertificates: new Map(config.peers.map(entry => [entry.fingerprint256, entry.hostId])) });
        try {
          if (sessions) browserService = await serveBrowser(custodian, { ...tls, ...config.browser, runtimePath, kernelBytes, catalogue,
            authenticate: request => sessions.authenticate(request), redeem: (credential, audience) => sessions.redeem(credential, audience) });
          return { ...service, browser_url: browserService?.url ?? null };
        } catch (error) { await service.close(); service = null; throw error; }
      },
      async close() { if (browserService) await browserService.close(); sessions?.close(); if (service) await service.close(); clients.forEach(client => client.close()); await custodian.stopOperations(); custodian.retireAll(); journal.close(); },
    };
  } catch (error) { clients.forEach(client => client.close()); journal.close(); throw error; }
}

// A bounded generic pump. It never chooses domain steps and never thaws an
// ambiguous transfer. Browser hosts leave actual World driving to their Worker.
export async function pumpDeployment(deployment) {
  const results = [];
  for (const { run } of deployment.journal.recover()) {
    try {
      if (run.status === 'ACTIVE' && deployment.config.execution === 'node') results.push(await deployment.custodian.run(run.run_id));
      const current = deployment.journal.run(run.run_id);
      if (current.status === 'OFFERED') results.push(await deployment.custodian.retryTransfer(current.transfer_id));
      else if (current.status === 'DEPARTED' && current.cancel_requested !== null && !current.cancel_forwarded) results.push(await deployment.custodian.cancelRun(current.run_id, current.cancel_requested));
    } catch (error) {
      results.push({ kind: 'failed', run_id: run.run_id, reason: /^[A-Za-z0-9_]{1,80}$/.test(error.code ?? '') ? error.code : 'RunFailed' });
    }
  }
  return results;
}
