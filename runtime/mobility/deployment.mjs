// Trusted, local deployment configuration. This loader is never reachable from
// a traveling image or peer request. Adapter selection is environmental only.
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { createSecureContext } from 'node:tls';
import { pathToFileURL } from 'node:url';
import { verifyRuntime, readRegular } from '../../tools/agent4/dependencies.mjs';
import { decodeSchema, decodeValue, encodeValue } from '../values.mjs';
import { bindSubject, subjectSchema, READ, CLOSE } from '../text_inspection.mjs';
import { fileBinding } from '../text_file.mjs';
import { WorldAdmission, canonicalRequirements } from './admission.mjs';
import { CustodyJournal } from './journal.mjs';
import { Custodian } from './custodian.mjs';
import { modelBinding } from './model.mjs';
import { repositoryApprovalBinding, repositoryReviewBinding, repositoryNextTaskBinding, repositoryClarificationBinding } from './repository_approval.mjs';
import { repositoryPublicationBinding, repositoryProposalBinding } from './repository_publication.mjs';
import { repositoryCheckBinding } from './repository_check.mjs';
import { createRepositoryCheckRunner, describeRepositoryCheckProfile } from '../repository_checks.mjs';
import { createZigRepositorySandbox } from '../repository_zig_sandbox.mjs';
import { selectZig } from '../../tools/agent4/toolchain.mjs';
import { openRepositorySnapshotStore } from '../repository_snapshot.mjs';
import { createManagedRepositoryEnvironment } from '../repository.mjs';
import { taskCatalogue } from './task_catalogue.mjs';
import { BrowserSessions } from './sessions.mjs';
import { serveBrowser } from './browser.mjs';
import { HostPolicy, requirement, bindingEligible } from './policy.mjs';
import { PeerClient, servePeers } from './transport.mjs';
import { parse, requireThat, closed, identifier } from './canonical.mjs';
import { hash, runId, signRecord, validate as validateRecord } from './protocol.mjs';
import { schemas } from './values.mjs';

async function prepareDeployment(configPath) {
  const root = dirname(resolve(configPath)), configBytes = readRegular(configPath, 1 << 20);
  const config = parse(configBytes, { maximum: 1 << 20, canonicalOnly: false });
  closed(config, ['format', 'hostId', 'trustDomain', 'revision', 'worldRuntime', 'directory', 'deploymentGeneration', 'keys', 'signer', 'deployments', 'bindings', 'labelDestinations', 'revoked', 'peers', 'tls', 'execution', ...(Object.hasOwn(config, 'browser') ? ['browser'] : []), ...(config.format === 'agent-mobility-deployment/v2' ? ['catalogue'] : [])]);
  requireThat(['agent-mobility-deployment/v1', 'agent-mobility-deployment/v2'].includes(config.format) && ['node', 'browser'].includes(config.execution), 'DeploymentConfiguration');
  requireThat(['keys', 'deployments', 'bindings', 'revoked', 'peers'].every(name => Array.isArray(config[name])) && config.revoked.every(value => typeof value === 'string'), 'DeploymentConfiguration');
  const path = value => { requireThat(typeof value === 'string' && value.length > 0, 'DeploymentPath'); return resolve(root, value); };
  const bytes = value => readRegular(path(value));
  // Authenticate the complete installed runtime before importing any of it.
  const runtimePath = path(config.worldRuntime), identity = verifyRuntime(runtimePath);
  const world = await import(pathToFileURL(identity.entrypoint));
  const kernelBytes = bytes(identity.kernelPath);
  const keys = new Map(config.keys.map(entry => {
    closed(entry, ['keyId', 'owner', 'status', 'publicKey']);
    identifier(entry.keyId); identifier(entry.owner);
    const publicKey = createPublicKey(bytes(entry.publicKey));
    requireThat(['active', 'retired'].includes(entry.status) && publicKey.asymmetricKeyType === 'ed25519', 'UntrustedKey');
    return [entry.keyId, { owner: entry.owner, status: entry.status, publicKey }];
  }));
  requireThat(keys.size === config.keys.length, 'DuplicateKey');
  closed(config.signer, ['keyId', 'privateKey', 'policyRevision']);
  const signer = { ...config.signer, privateKey: createPrivateKey(bytes(config.signer.privateKey)) }, ownKey = keys.get(signer.keyId);
  requireThat(ownKey?.status === 'active' && ownKey.owner === config.hostId && signer.privateKey.asymmetricKeyType === 'ed25519' &&
    ownKey.publicKey.equals(createPublicKey(signer.privateKey)) && signer.policyRevision === config.revision, 'DeploymentSigner');
  closed(config.tls, ['key', 'cert', 'ca', 'host', 'port']);
  const tls = { key: bytes(config.tls.key), cert: bytes(config.tls.cert), ca: bytes(config.tls.ca) };
  createSecureContext({ ...tls, minVersion: 'TLSv1.3' });
  const endpoint = value => typeof value.host === 'string' && value.host.length > 0 && Number.isInteger(value.port) && value.port >= 0 && value.port <= 65535;
  requireThat(endpoint(config.tls), 'DeploymentListener');
  requireThat(new Set(config.peers.map(peer => peer.hostId)).size === config.peers.length, 'DuplicatePeer');
  for (const peer of config.peers) {
    closed(peer, ['hostId', 'url', 'servername', 'fingerprint256', ...(Object.hasOwn(peer, 'timeout') ? ['timeout'] : [])]);
    identifier(peer.hostId); identifier(peer.servername, 256);
    const client = new PeerClient({ ...peer, ...tls }); client.close();
  }
  if (config.browser) {
    closed(config.browser, ['directory', 'audience', 'host', 'port', 'publicOrigin']);
    requireThat(config.execution === 'browser' && endpoint(config.browser) && typeof config.browser.audience === 'string' && config.browser.audience.length > 0, 'BrowserExecutionRequired');
    if (config.browser.publicOrigin !== null) {
      const origin = new URL(config.browser.publicOrigin);
      requireThat(origin.protocol === 'https:' && origin.origin === config.browser.publicOrigin, 'OriginDenied');
    }
  }
  const statistics = new Map(), checkActivations = [], checkSandboxes = new Map();
  let publicationServices;
  const bindings = await Promise.all(config.bindings.map(async entry => {
    const { adapter, ...metadata } = entry;
    const binding = { ...metadata, payloadSchema: bytes(metadata.payloadSchema), resultSchema: bytes(metadata.resultSchema) };
    const counts = statistics.get(binding.operation) ?? { calls: 0 }; statistics.set(binding.operation, counts);
    if (['repository-query', 'repository-prepare'].includes(adapter.kind)) {
      closed(adapter, ['kind', 'store', 'classification', ...(adapter.kind === 'repository-prepare' ? ['helper'] : [])]);
      if (adapter.kind === 'repository-prepare') closed(adapter.helper, ['path', 'sha256']);
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
        gitExecutable: path(adapter.store.gitExecutable), ...(adapter.kind === 'repository-prepare' ? { writeHelper: { ...adapter.helper, path: path(adapter.helper.path) } } : {}), resourceOwner: config.hostId, classification: adapter.classification });
      const result = decodeSchema(binding.resultSchema);
      binding.authorize = payload => Array.isArray(payload) && (method === 'snapshot' ? payload[0] === adapter.store.repository :
        Array.isArray(payload[0]) && payload[0][0] === adapter.store.repository && payload[0][1] === adapter.store.generation);
      // Preparation only retains bounded immutable objects, never a delivery ref.
      binding.cancelSafe = true;
      binding.recoveryMatches = binding.authorize;
      binding.handle = async ({ payload }) => { counts.calls++; return encodeValue(result, await leaf[method](payload)); };
      return binding;
    }
    if (adapter.kind === 'openai-responses-replay') {
      const leaf = modelBinding(binding, adapter, config.hostId), handle = leaf.handle;
      leaf.handle = context => { counts.calls++; return handle(context); };
      return leaf;
    }
    if (['repository-review-human', 'repository-next-task-human', 'repository-clarification-human'].includes(adapter.kind)) {
      const leaf = (adapter.kind === 'repository-next-task-human' ? repositoryNextTaskBinding : adapter.kind === 'repository-clarification-human' ? repositoryClarificationBinding : repositoryReviewBinding)(binding, adapter), answer = leaf.answer;
      leaf.answer = context => { counts.calls++; return answer(context); };
      return leaf;
    }
    if (['repository-approval-issuer', 'repository-approval-human'].includes(adapter.kind)) {
      const leaf = repositoryApprovalBinding(binding, adapter), method = leaf.answer ? 'answer' : 'handle', original = leaf[method];
      leaf[method] = context => { counts.calls++; return original(context); };
      return leaf;
    }
    if (adapter.kind === 'repository-proposal') {
      closed(adapter, ['kind', 'store', 'helper', 'protectedImages', 'authorizationDigest', 'validationPolicyDigest', 'requiredProfiles', 'checkResultSchema', 'commit']);
      closed(adapter.store, ['directory', 'gitExecutable', 'repository', 'generation', 'manifestSha256']);
      requireThat(binding.subject === adapter.store.repository && binding.subjectVersion === adapter.store.manifestSha256, 'AdapterContract');
      closed(adapter.helper, ['path', 'sha256']);
      const store = await openRepositorySnapshotStore({ writeHelper: { ...adapter.helper, path: path(adapter.helper.path) }, ...adapter.store, directory: path(adapter.store.directory), gitExecutable: path(adapter.store.gitExecutable) });
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
      const sandboxOptions = { ...structuredClone(adapter.sandbox), toolchain, scratchRoot: path(adapter.sandbox.scratchRoot),
        launcher: { ...adapter.sandbox.launcher, path: await realpath(path(adapter.sandbox.launcher.path)) },
        processLock: { ...adapter.sandbox.processLock, path: await realpath(path(adapter.sandbox.processLock.path)) } };
      const profile = structuredClone(adapter.profile), checkProfile = structuredClone(adapter.checkProfile);
      // Configuration inspection validates declarations. Only the activated
      // binding, with its independently qualified runner identity, can execute.
      const leaf = repositoryCheckBinding(binding, { runner: { runner: profile.runner,
        profiles: [describeRepositoryCheckProfile(checkProfile)] }, profile, hostId: config.hostId });
      const sandboxKey = JSON.stringify({ ...sandboxOptions, toolchain: toolchain.identity });
      let activated;
      const activate = () => activated ??= (async () => {
        if (!checkSandboxes.has(sandboxKey)) checkSandboxes.set(sandboxKey, createZigRepositorySandbox(sandboxOptions));
        const sandbox = await checkSandboxes.get(sandboxKey);
        const runner = createRepositoryCheckRunner({ store, sandbox, profiles: [checkProfile] });
        return repositoryCheckBinding(binding, { runner, profile, hostId: config.hostId });
      })();
      checkActivations.push(activate);
      leaf.handle = async context => { counts.calls++; return (await activate()).handle(context); };
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
  return { config, configDigest: hash(configBytes), path, bytes, identity, world, runtimePath, kernelBytes, keys, signer, tls, bindings, deployments, admission, policy, statistics,
    // A qualifier holds two of the scratch root's four slots. Qualify once per
    // immutable configuration and sequence startup within that finite capacity.
    activateChecks: async () => { for (const activate of checkActivations) await activate(); },
    activatePublications: services => { publicationServices = services; } };
}

// Configuration validation shares preparation with startup, but never opens a
// journal, creates a browser session, dispatches a leaf or starts a service.
export async function validateDeployment(configPath, { peerConfigs = [], contactPeers = false } = {}) {
  const prepared = await prepareDeployment(configPath);
  const { config, bytes, keys, identity, admission, policy, bindings, tls } = prepared;
  for (const entry of prepared.deployments) for (const principal of entry.principals) for (const issuer of entry.issuers) {
    const key = [...keys].find(([, key]) => key.owner === issuer); requireThat(key, 'UntrustedKey');
    validateRecord('run', { format: 'agent-mobility-run/v1', run_id: runId(issuer), issuer_id: issuer, principal_ref: principal, tenant_ref: entry.tenant,
      image_digest: entry.imageDigest, program_id: entry.programId, trusted_runtime_profile: identity.kernelSha256, allowed_host_policy_ref: config.trustDomain,
      deployment_policy_revision: config.revision, initial_classification: entry.classification, initial_host_id: config.hostId, initial_epoch: '0', deployment_limits: entry.limits, key_id: key[0] }, false);
  }
  const declarations = new Map([[config.hostId, config]]);
  for (const filename of peerConfigs) {
    const peer = parse(readRegular(filename, 1 << 20), { maximum: 1 << 20, canonicalOnly: false });
    requireThat(!declarations.has(peer.hostId) && config.peers.some(row => row.hostId === peer.hostId), 'ValidationPeerConfiguration');
    declarations.set(peer.hostId, peer);
  }
  // These are the installed repository application's external contracts. The
  // schema bytes and image are checked against the existing package inventory.
  const contracts = [
    ['origin', 'agent.repository.human.v1', 'question', 'answer', 'interaction', 'always'],
    ['origin', 'agent.repository.review.v1', 'review', 'review-answer', 'interaction', 'always'],
    ['origin', 'agent.repository.next-task.v1', 'next-task', 'next-task-answer', 'interaction', 'session'],
    ['origin', 'agent.approval.issue.v1.repository.publish', 'proposal', 'identifier', 'approval', 'publish'],
    ['origin', 'agent.interaction.exchange.v1.repository.publish', 'human', 'human-reply', 'approval', 'publish'],
    ['workspace', 'agent.repository.snapshot.v1', 'snapshot-request', 'snapshot', 'read', 'always'],
    ['workspace', 'agent.repository.read.v1', 'read', 'evidence', 'read', 'always'],
    ['workspace', 'agent.repository.list.v1', 'list', 'listing', 'read', 'always'],
    ['workspace', 'agent.repository.search.v1', 'search', 'search-result', 'read', 'always'],
    ['workspace', 'agent.repository.read-window.v1', 'read-window', 'read-window-result', 'read', 'always'],
    ['workspace', 'agent.model.invoke.v4', 'model-request', 'model-result', 'model', 'always'],
    ['workspace', 'agent.repository.prepare.v1', 'candidate-preparation', 'proposal', 'write', 'change'],
    ['workspace', 'agent.repository.check.v1', 'proposal', 'check-result', 'write', 'change'],
    ['workspace', 'agent.repository.proposal.v1', 'preparation', 'proposal', 'write', 'change'],
    ['workspace', 'agent.repository.publication-current.v1', 'proposal', 'boolean', 'read', 'publish'],
    ['workspace', 'agent.repository.publish.v1', 'proposal', 'delivery', 'commit', 'publish'],
  ];
  const reports = [], providerProfiles = [];
  if (config.format === 'agent-mobility-deployment/v2') {
    taskCatalogue(config.catalogue, { bytes, keys, custodian: null, config, runtimeProfile: identity.kernelSha256 });
    requireThat(!contactPeers || config.catalogue.entries.length === 0 || peerConfigs.length > 0, 'ValidationPeerConfiguration');
    const examples = resolve(import.meta.dirname, '../../examples');
    let inventory;
    const artifact = name => {
      inventory ??= JSON.parse(readRegular(resolve(examples, 'inventory.json')));
      const row = inventory.files.find(row => row.path === name), value = readRegular(resolve(examples, name));
      requireThat(row && row.sha256 === hash(value), 'ValidationArtifactMismatch'); return value;
    };
    const approvalSchemas = new Set(['preparation', 'proposal', 'delivery', 'check-result', 'human', 'human-reply', 'identifier', 'boolean']);
    const schema = name => artifact(`${approvalSchemas.has(name) ? 'repository-approval' : 'mobile-repository'}/${name}.bin`);
    for (const entry of config.catalogue.entries) {
      const image = bytes(entry.image), initial = bytes(entry.initialTask);
      requireThat(hash(image) === hash(artifact('mobile-repository/session.bpi3')) &&
        hash(bytes(entry.taskSchema)) === hash(schema('session')) && hash(bytes(entry.reportSchema)) === hash(schema('report')), 'ValidationArtifactMismatch');
      const session = decodeValue(decodeSchema(bytes(entry.taskSchema)), initial), task = session[0];
      const executor = await admission.start(image, initial, entry.programId);
      try { requireThat(admission.read(executor.current()).metadata.kind === 'requested', 'ValidationTaskRejected'); }
      finally { executor.retire(); }
      for (const principal of entry.principals) {
        const deployment = config.deployments.find(row => row.imageDigest === hash(image) && row.programId === entry.programId && row.tenant === principal.tenant && row.principals.includes(principal.principal));
        requireThat(deployment, 'CatalogueDeployment');
        const issuer = config.catalogue.issuer;
        const registration = { format: 'agent-mobility-run/v1', run_id: runId(issuer.id), issuer_id: issuer.id, principal_ref: principal.principal, tenant_ref: principal.tenant,
          image_digest: hash(image), program_id: entry.programId, trusted_runtime_profile: identity.kernelSha256, allowed_host_policy_ref: config.trustDomain,
          deployment_policy_revision: config.revision, initial_classification: deployment.classification, initial_host_id: config.hostId, initial_epoch: '0', deployment_limits: deployment.limits, key_id: issuer.keyId };
        validateRecord('run', registration, false); policy.authorizeRun(registration); policy.checkCleanup(registration);
        policy.preflight(registration, task[8][0][0], task[8][0][1], deployment.classification);
        const selected = contracts.filter(([, , , , , condition]) => condition === 'always' || condition === 'publish' && entry.modes.includes('publish') ||
          condition === 'change' && entry.modes.some(mode => mode !== 'inspect') || condition === 'session' && session[1] > 1);
        const requests = new Map();
        let workspaceHost = null;
        for (const [side, operation, input, output, role] of selected) {
          const candidates = side === 'origin' ? [config] : [...declarations.values()].filter(peer => peer.hostId !== config.hostId);
          const found = candidates.flatMap(peer => peer.bindings.filter(row => row.operation === operation && row.role === role && row.subject === task[4] &&
            row.tenants.includes(principal.tenant) && row.principals.includes(principal.principal)).map(row => ({ peer, row })));
          if (found.length === 0 && side === 'workspace' && peerConfigs.length === 0 && !contactPeers) continue;
          if (found.length !== 1) throw Object.assign(new Error('RepositoryCapabilityMissing'), { code: 'RepositoryCapabilityMissing', operation });
          const { peer, row } = found[0], wanted = requirement({ ...row, payloadSchema: schema(input), resultSchema: schema(output) });
          if (operation === 'agent.model.invoke.v4') {
            const model = binding => modelBinding({ ...binding, payloadSchema: schema(input), resultSchema: schema(output) }, binding.adapter, peer.hostId);
            const selectedModel = model(row);
            requireThat(selectedModel.matchesModel(task[9][0], task[9][1], deployment.classification), 'RepositoryModelProfileMismatch');
            // Availability of the requested profile does not prove dispatch
            // will select it. Indistinguishable eligible calls must use the
            // same pinned profile, including mode, endpoint and allowances.
            for (const other of peer.bindings.filter(binding => binding.operation === operation &&
              bindingEligible(registration, binding, peer.hostId, peer.labelDestinations))) {
              requireThat(other.adapter.kind === 'openai-responses-replay', 'RepositoryModelProfileAmbiguous');
              const candidate = model(other);
              if (candidate.matchesModel(task[9][0], task[9][1], deployment.classification))
                requireThat(candidate.profileDigest === selectedModel.profileDigest && other.subjectVersion === row.subjectVersion, 'RepositoryModelProfileAmbiguous');
            }
            providerProfiles.push({ entry: entry.id, principal: principal.principal, tenant: principal.tenant,
              host: peer.hostId, subject: row.subject, version: row.subjectVersion, model: row.adapter.model,
              mode: row.adapter.mode, parameters: row.adapter.parameters, allowance: row.adapter.allowance });
          }
          if (operation === 'agent.interaction.exchange.v1.repository.publish') requireThat(row.adapter.principalIds?.[principal.principal] === principal.taskPrincipal, 'ValidationPrincipalBinding');
          if (side === 'workspace') {
            workspaceHost ??= peer.hostId;
            requireThat(peer.hostId === workspaceHost, 'WorkspaceCapabilitiesNotColocated');
            policy.mayExport({ ...registration, classification: deployment.classification }, peer.hostId, task[7][2]);
          }
          if (peer.hostId === config.hostId) requireThat(policy.bindingForRequirement(registration, wanted) !== null, 'RepositoryCapabilityContract');
          const list = requests.get(peer.hostId) ?? []; list.push(wanted); requests.set(peer.hostId, list);
        }
        for (const [host, requirements] of requests) {
          if (host === config.hostId) { reports.push({ entry: entry.id, host, capabilities: requirements.length, verified: 'local' }); continue; }
          if (!contactPeers) { reports.push({ entry: entry.id, host, capabilities: requirements.length, verified: 'declaration-only' }); continue; }
          const peer = config.peers.find(row => row.hostId === host); requireThat(peer, 'ValidationPeerConfiguration');
          const client = new PeerClient({ ...peer, ...tls });
          try {
            for (const wanted of [task[7][0][0], requirements]) {
              const encoded = canonicalRequirements(wanted);
              const observed = await client.preflight({ registration: signRecord('run', registration, createPrivateKey(bytes(issuer.privateKey))),
                requirements: encoded, constraints: encodeValue(schemas.constraints, task[7][0][1]), classification: deployment.classification });
              requireThat(observed.observation.host_id === host && observed.observation.runtime_profile === identity.kernelSha256 &&
                observed.observation.requirements_digest === hash(encoded) && observed.observation.policy_revision === declarations.get(host).revision, 'ValidationPeerMismatch');
            }
            reports.push({ entry: entry.id, host, capabilities: requirements.length, verified: 'authenticated-preflight' });
          } finally { client.close(); }
        }
      }
    }
  }
  const contacted = reports.some(row => row.verified === 'authenticated-preflight');
  return { format: 'agent-mobility-deployment-validation/v1', valid: true, scope: 'local-configuration', host_id: config.hostId, config: prepared.configDigest, runtime: identity.kernelSha256,
    localBindings: bindings.length, applicationEntries: config.catalogue?.entries.length ?? 0, storage: 'not-opened', leafDispatches: 0, peerContact: contacted,
    capabilityCoverage: reports, providerProfiles, remoteAvailability: contacted ? 'preflight-only; rechecked on dispatch' : 'not-contacted' };
}

export async function openDeployment(configPath, { create = false, qualifyChecks = true } = {}) {
  const { config, path, bytes, identity, world, runtimePath, kernelBytes, keys, signer, tls, admission, policy, statistics, deployments, activatePublications, activateChecks } = await prepareDeployment(configPath);
  if (qualifyChecks) await activateChecks();
  const journal = new CustodyJournal({ directory: path(config.directory), hostId: config.hostId, deploymentGeneration: config.deploymentGeneration, keys,
    signer, admission, create });
  activatePublications(Object.freeze({ journal, policy }));
  const peers = new Map(), clients = [];
  try {
    for (const entry of config.peers) {
      requireThat(!peers.has(entry.hostId), 'DuplicatePeer');
      const client = new PeerClient({ ...entry, ...tls }); clients.push(client); peers.set(entry.hostId, client);
    }
    const custodian = new Custodian({ journal, admission, world, policy, peers });
    const catalogue = config.format === 'agent-mobility-deployment/v2' ? taskCatalogue(config.catalogue, { bytes, keys, custodian, config, runtimeProfile: identity.kernelSha256, world }) : null;
    let service = null, browserService = null, sessions = null;
    if (config.browser) {
      sessions = new BrowserSessions({ directory: path(config.browser.directory), create,
        authorize: identity => identity.audiences[0] === config.browser.audience && !config.revoked.includes(`${identity.tenant}/${identity.principal}`) &&
          deployments.some(entry => entry.tenant === identity.tenant && entry.principals.includes(identity.principal)) });
    }
    return { config, identity, world, journal, custodian, admission, peers, runtimePath, kernelBytes, sessions, catalogue,
      statistics: () => Object.fromEntries([...statistics].map(([name, value]) => [name, { calls: value.calls, ...(value.text ? value.text() : {}) }])),
      async serve() {
        requireThat(service === null, 'AlreadyServing');
        await activateChecks();
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
