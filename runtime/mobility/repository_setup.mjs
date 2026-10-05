// Privileged local configuration authoring only. It encodes installed contracts;
// the catalogue signs runs and the existing deployment owns all execution.
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readRegular, verifyRuntime } from '../../tools/agent4/dependencies.mjs';
import { decodeSchema, encodeValue } from '../values.mjs';
import { openRepositorySnapshotStore } from '../repository_snapshot.mjs';
import { describeRepositoryCheckProfile } from '../repository_checks.mjs';
import { modelParametersValue } from '../model.mjs';
import { canonical, parse, closed, requireThat, identifier } from './canonical.mjs';
import { hash } from './protocol.mjs';
import { requirement } from './policy.mjs';
import { modelBinding } from './model.mjs';
import { schemas as mobilitySchemas } from './values.mjs';

export async function configureRepository(filename, destination) {
  const input = parse(readRegular(filename, 1 << 20), { maximum: 1 << 20, canonicalOnly: false });
  closed(input, ['format', 'trustDomain', 'revision', 'label', 'store', 'check', 'qualification', 'issuer', 'principal', 'origin', 'workspace', 'task', 'provider', 'commit']);
  requireThat(input.format === 'agent.repository.setup/v1', 'RepositorySetupFormat');
  for (const value of [input.trustDomain, input.revision, input.label]) identifier(value);
  const path = value => { requireThat(typeof value === 'string' && value.length > 0, 'DeploymentPath'); return resolve(dirname(resolve(filename)), value); };
  const packageRoot = resolve(import.meta.dirname, '../..'), output = resolve(destination);
  const inventory = JSON.parse(await readFile(join(packageRoot, 'examples/inventory.json')));
  const assets = new Map();
  async function asset(relative) {
    const bytes = readRegular(join(packageRoot, 'examples', relative)), row = inventory.files.find(row => row.path === relative);
    requireThat(row && row.sha256 === hash(bytes), 'RepositorySetupArtifact'); assets.set(relative, bytes); return bytes;
  }
  const imageRelative = inventory.examples.find(row => row.name === 'mobile-repository')?.image;
  requireThat(imageRelative === 'mobile-repository/session.bpi3', 'RepositorySetupImage');
  const image = await asset(imageRelative), schemaPaths = {}, schemas = {};
  for (const [group, names] of [
    ['repository-approval', ['preparation', 'proposal', 'delivery', 'check-result', 'human', 'human-reply', 'identifier', 'boolean']],
    ['mobile-repository', ['session', 'task', 'report', 'snapshot-request', 'snapshot', 'read', 'evidence', 'list', 'listing', 'search', 'search-result', 'read-window', 'read-window-result', 'candidate-preparation', 'cleanup', 'unit', 'model-request', 'model-result', 'review', 'review-answer', 'next-task', 'next-task-answer']],
  ]) for (const name of names) { const relative = `${group}/${name}.bin`; schemaPaths[name] = relative; schemas[name] = decodeSchema(await asset(relative)); }
  closed(input.store, ['directory', 'gitExecutable', 'repository', 'generation', 'manifestSha256']);
  const storeConfig = { ...input.store, directory: path(input.store.directory), gitExecutable: path(input.store.gitExecutable) };
  const store = await openRepositorySnapshotStore(storeConfig), scope = store.describe();
  closed(input.task, ['path', 'steps', 'checks', 'maximumTasks']);
  requireThat(scope.readPaths.includes(input.task.path), 'RepositorySetupScope');
  requireThat(Number.isInteger(input.task.maximumTasks) && input.task.maximumTasks >= 1 && input.task.maximumTasks <= 16 &&
    ['steps', 'checks'].every(name => Number.isInteger(input.task[name]) && input.task[name] >= 1 && input.task[name] <= 64) &&
    input.task.maximumTasks * input.task.checks <= 16, 'RepositorySetupLimits');
  const check = parse(readRegular(path(input.check), 1 << 20), { maximum: 1 << 20, canonicalOnly: false });
  closed(check, ['sandbox', 'checkProfile']);
  const profile = describeRepositoryCheckProfile(check.checkProfile);
  requireThat(check.checkProfile.requiredPaths.every(name => scope.readPaths.includes(name)), 'RepositorySetupCheckScope');
  const qualification = parse(readRegular(path(input.qualification), 2 << 20), { maximum: 2 << 20, canonicalOnly: false });
  requireThat(qualification.kind === 'qualified' && qualification.profile.digest === profile.digest &&
    /^[a-f0-9]{64}$/.test(qualification.runner) && hash(Buffer.from(JSON.stringify(qualification.contract))) === qualification.runner, 'RepositorySetupQualification');
  // The receipt supplies configuration identities; startup qualifies again.
  const checkRoot = dirname(path(input.check)), checkPath = value => resolve(checkRoot, value);
  const sandbox = { ...check.sandbox, zigExecutable: checkPath(check.sandbox.zigExecutable), libraryDirectory: checkPath(check.sandbox.libraryDirectory), scratchRoot: checkPath(check.sandbox.scratchRoot),
    launcher: { ...check.sandbox.launcher, path: checkPath(check.sandbox.launcher.path) }, processLock: { ...check.sandbox.processLock, path: checkPath(check.sandbox.processLock.path) } };
  closed(input.issuer, ['id', 'keyId', 'publicKey', 'privateKey']);
  closed(input.principal, ['tenant', 'principal', 'taskPrincipal']);
  for (const value of [input.issuer.id, input.issuer.keyId, input.principal.tenant, input.principal.principal]) identifier(value);
  requireThat(typeof input.principal.taskPrincipal === 'string' && /^[1-9][0-9]{0,19}$/.test(input.principal.taskPrincipal) && BigInt(input.principal.taskPrincipal) <= 0xffffffffffffffffn, 'RepositorySetupPrincipal');
  const hosts = [input.origin, input.workspace];
  for (const [index, host] of hosts.entries()) {
    closed(host, ['hostId', 'keyId', 'publicKey', 'privateKey', 'installation', 'worldRuntime', 'directory', 'deploymentGeneration', 'url', 'servername', 'fingerprint256', 'tls', ...(index === 0 ? ['browser'] : [])]);
    identifier(host.hostId); identifier(host.keyId);
    requireThat(new URL(host.url).protocol === 'https:', 'RepositorySetupPeer');
  }
  requireThat(input.origin.hostId !== input.workspace.hostId && new Set([input.issuer.keyId, ...hosts.map(host => host.keyId)]).size === 3, 'RepositorySetupIdentity');
  closed(input.origin.browser, ['directory', 'audience', 'host', 'port', 'publicOrigin']); identifier(input.origin.browser.audience);
  closed(input.provider, ['enabled', 'profile']); requireThat(typeof input.provider.enabled === 'boolean', 'RepositorySetupProvider');
  requireThat(!input.provider.enabled || input.provider.profile?.owner === input.workspace.hostId, 'RepositorySetupProvider');
  const provider = input.provider.enabled ? input.provider.profile : null;
  const meta = (operation, from, to, role) => ({ operation, payloadSchema: schemaPaths[from], resultSchema: schemaPaths[to], role,
    subject: scope.repository, subjectVersion: operation.startsWith('agent.repository.') && !['approval', 'interaction'].includes(role) ? storeConfig.manifestSha256 : null,
    scope: operation, audience: ['approval', 'interaction'].includes(role) ? input.origin.browser.audience : null,
    trustDomain: input.trustDomain, tenants: [input.principal.tenant], principals: [input.principal.principal], classification: [input.label], allowedStateLabels: [input.label], cleanup: false });
  const required = row => requirement({ ...row, payloadSchema: assets.get(row.payloadSchema), resultSchema: assets.get(row.resultSchema) });
  if (provider) modelBinding(meta('agent.model.invoke.v4', 'model-request', 'model-result', 'model'), provider, input.workspace.hostId);
  const place = row => [[[required(row)], [[], { tag: 0, value: null }, { tag: 0, value: null }, 8n << 20n]], 'repository', input.label, [4, 1]];
  const human = meta('agent.interaction.exchange.v1.repository.publish', 'human', 'human-reply', 'approval');
  const parameters = provider?.parameters ?? { maxOutputTokens: 512, temperature: null, reasoning: null };
  const task = [1n, 0n, 1, 'Select a goal when starting.', scope.repository, scope.base, input.task.path,
    place(meta('agent.repository.snapshot.v1', 'snapshot-request', 'snapshot', 'read')), place(human),
    [provider?.model ?? 'disabled', modelParametersValue(parameters)],
    input.task.steps, input.task.checks, BigInt(input.principal.taskPrincipal)];
  const initial = encodeValue(schemas.session, [task, input.task.maximumTasks]);
  const runtime = verifyRuntime(path(input.workspace.worldRuntime)), world = await import(pathToFileURL(runtime.entrypoint));
  const kernel = await world.Kernel.create({ bytes: readRegular(runtime.kernelPath), expectedSha256: runtime.kernelSha256 });
  kernel.setLimits({ input: 8 << 20, working: 64 << 20, output: 8 << 20 });
  const prepared = kernel.prepare(image); let session, programId;
  try {
    session = kernel.start(prepared, initial); const first = world.decodeOutcome(kernel.drive(session, { quantum: 10000n, checkpoint: true }));
    requireThat(first.kind === 'requested', 'RepositorySetupTask'); programId = Buffer.from((await world.decodeRequest(first.request)).programIdentity).toString('hex');
  } finally { if (session) kernel.checkpoint(session, { transfer: true }); kernel.releasePrepared(prepared); }
  const profiles = [{ id: profile.id, profileDigest: profile.digest, runner: qualification.runner }];
  const common = { store: storeConfig, protectedImages: [{ image: hash(image), program: programId }],
    authorizationDigest: hash(canonical([input.principal, scope, input.revision])), validationPolicyDigest: hash(canonical(profiles)), requiredProfiles: profiles,
    checkResultSchema: schemaPaths['check-result'] };
  const binding = (row, adapter) => ({ ...row, adapter });
  const release = { ...meta('agent.repository.investigation-release.v1', 'cleanup', 'unit', 'read'), cleanup: true };
  const helperRelative = 'native/agent-publication-gate', helperBytes = await asset(helperRelative);
  const workspaceBindings = [
    ...[['snapshot', 'snapshot-request', 'snapshot'], ['read', 'read', 'evidence'], ['list', 'list', 'listing'], ['search', 'search', 'search-result'], ['read-window', 'read-window', 'read-window-result'], ['prepare', 'candidate-preparation', 'proposal']].map(([op, from, to]) => binding(meta(`agent.repository.${op}.v1`, from, to, op === 'prepare' ? 'write' : 'read'), { kind: op === 'prepare' ? 'repository-prepare' : 'repository-query', store: storeConfig, classification: [input.label] })),
    binding(meta('agent.repository.check.v1', 'proposal', 'check-result', 'write'), { kind: 'repository-check', store: storeConfig, sandbox, checkProfile: check.checkProfile,
      profile: { owner: input.workspace.hostId, repository: scope.repository, generation: scope.generation, manifest: storeConfig.manifestSha256, profileId: profile.id, profileDigest: profile.digest, runner: qualification.runner,
        disclosure: { audience: null, labels: [input.label] }, allowance: { attempts: input.task.maximumTasks * input.task.checks, request_bytes: 4 << 20, concurrent: 1 } } }),
    binding(meta('agent.repository.proposal.v1', 'preparation', 'proposal', 'write'), { kind: 'repository-proposal', ...common, commit: input.commit }),
    ...[['publication-current', 'boolean', 'read'], ['publish', 'delivery', 'commit']].map(([op, to, role]) => binding(meta(`agent.repository.${op}.v1`, 'proposal', to, role), { kind: 'repository-publication', ...common,
      helper: { path: join(path(input.workspace.installation), 'examples', helperRelative), sha256: hash(helperBytes) } })),
    ...(provider ? [binding(meta('agent.model.invoke.v4', 'model-request', 'model-result', 'model'), provider)] : []), binding(release, { kind: 'repository-release' }),
  ];
  const originBindings = [binding(meta('agent.approval.issue.v1.repository.publish', 'proposal', 'identifier', 'approval'), { kind: 'repository-approval-issuer' }),
    binding(human, { kind: 'repository-approval-human', revision: input.revision, principalIds: { [input.principal.principal]: input.principal.taskPrincipal } }),
    binding(meta('agent.repository.review.v1', 'review', 'review-answer', 'interaction'), { kind: 'repository-review-human', revision: input.revision }),
    binding(meta('agent.repository.next-task.v1', 'next-task', 'next-task-answer', 'interaction'), { kind: 'repository-next-task-human', revision: input.revision, modes: ['inspect', 'propose', 'publish'] }), binding(release, { kind: 'repository-release' })];
  const configFor = (host, index) => {
    const other = hosts[1 - index], installed = path(host.installation), installedAsset = relative => join(installed, 'examples', relative);
    const bindings = structuredClone(index === 0 ? originBindings : workspaceBindings);
    for (const row of bindings) { row.payloadSchema = installedAsset(row.payloadSchema); row.resultSchema = installedAsset(row.resultSchema); if (row.adapter.checkResultSchema) row.adapter.checkResultSchema = installedAsset(row.adapter.checkResultSchema); }
    const issuer = index === 0 ? input.issuer : { id: host.hostId, keyId: host.keyId, privateKey: host.privateKey };
    return { format: 'agent-mobility-deployment/v2', hostId: host.hostId, trustDomain: input.trustDomain, revision: input.revision,
      worldRuntime: path(host.worldRuntime), directory: path(host.directory), deploymentGeneration: host.deploymentGeneration, execution: index === 0 ? 'browser' : 'node',
      keys: [input.issuer, ...hosts.map(host => ({ ...host, id: host.hostId }))].map(owner => ({ keyId: owner.keyId, owner: owner.id, status: 'active', publicKey: path(owner.publicKey) })),
      signer: { keyId: host.keyId, privateKey: path(host.privateKey), policyRevision: input.revision },
      deployments: [{ imageDigest: hash(image), programId, tenant: input.principal.tenant, principals: [input.principal.principal], issuers: [input.issuer.id], hosts: hosts.map(h => h.hostId), classification: [input.label],
        cleanup: 'cleanup.bin', controlPeers: hosts.map(h => h.hostId), limits: { maximum_moves: input.task.maximumTasks * 4, maximum_image_bytes: 8 << 20, maximum_outcome_bytes: 8 << 20 }, exportPolicies: { [input.label]: hosts.map(h => h.hostId) } }],
      bindings, labelDestinations: { [input.label]: hosts.map(h => h.hostId) }, revoked: [],
      peers: [{ hostId: other.hostId, url: other.url, servername: other.servername, fingerprint256: other.fingerprint256 }],
      tls: { ...host.tls, key: path(host.tls.key), cert: path(host.tls.cert), ca: path(host.tls.ca) },
      ...(index === 0 ? { browser: { ...host.browser, directory: path(host.browser.directory) } } : {}),
      catalogue: { issuer: { id: issuer.id, keyId: issuer.keyId, privateKey: path(issuer.privateKey) }, entries: index === 0 && provider ? [{ id: 'repository', title: `Repository ${scope.repository}`, image: installedAsset(imageRelative), programId,
        taskSchema: installedAsset(schemaPaths.session), reportSchema: installedAsset(schemaPaths.report), initialTask: 'initial.bin', modes: ['inspect', 'propose', 'publish'], principals: [input.principal],
        scope: { read: scope.readPaths, write: scope.writablePaths, checks: [profile.id], target: scope.managedRef }, profile: profile.id,
        presentation: { audience: input.origin.browser.audience, labels: [input.label], revision: input.revision } }] : [] } };
  };
  const configs = hosts.map(configFor);
  await mkdir(output, { mode: 0o700 });
  try {
    await writeFile(join(output, 'initial.bin'), initial, { mode: 0o600, flag: 'wx' });
    await writeFile(join(output, 'cleanup.bin'), encodeValue(mobilitySchemas.requirements, [required(release)]), { mode: 0o600, flag: 'wx' });
    for (const [index, config] of configs.entries()) await writeFile(join(output, index === 0 ? 'origin.json' : 'workspace.json'), JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  } catch (error) { await rm(output, { recursive: true, force: true }); throw error; }
  return { format: 'agent.repository.setup-result/v1', origin: join(output, 'origin.json'), workspace: join(output, 'workspace.json'), tasksEnabled: provider !== null,
    image: hash(image), programId, profile: profile.id, qualification: 'startup requalifies the configured runner' };
}
