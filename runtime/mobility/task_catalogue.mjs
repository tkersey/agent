// Trusted intake only. Callers choose from immutable operator grants; this module
// registers a fresh computation and never advances an application phase.
import { createPrivateKey, createPublicKey, randomBytes } from 'node:crypto';
import { decodeSchema, decodeValue, encodeValue } from '../values.mjs';
import { closed, requireThat, identifier, labels } from './canonical.mjs';
import { hash, runId, signRecord } from './protocol.mjs';

const modes = ['inspect', 'propose', 'publish'];
export function taskCatalogue(configuration, { bytes, keys, custodian, config, runtimeProfile, world }) {
  closed(configuration, ['issuer', 'entries']);
  closed(configuration.issuer, ['id', 'keyId', 'privateKey']);
  const issuer = configuration.issuer, privateKey = createPrivateKey(bytes(issuer.privateKey)), trusted = keys.get(issuer.keyId);
  requireThat(trusted?.status === 'active' && trusted.owner === issuer.id &&
    trusted.publicKey.equals(createPublicKey(privateKey)), 'CatalogueIssuer');
  requireThat(Array.isArray(configuration.entries) && configuration.entries.length <= 64, 'CatalogueCapacity');
  const entries = new Map();
  for (const entry of configuration.entries) {
    closed(entry, ['id', 'title', 'image', 'programId', 'taskSchema', 'reportSchema', 'initialTask', 'modes', 'principals', 'scope', 'profile', 'presentation']);
    identifier(entry.id); requireThat(!entries.has(entry.id), 'DuplicateCatalogueEntry');
    requireThat(typeof entry.title === 'string' && entry.title.length <= 256 && typeof entry.profile === 'string' && entry.profile.length <= 256, 'CatalogueDescription');
    closed(entry.presentation, ['audience', 'labels', 'revision']); identifier(entry.presentation.audience); identifier(entry.presentation.revision); labels(entry.presentation.labels);
    closed(entry.scope, ['read', 'write', 'checks', 'target']);
    for (const field of ['read', 'write', 'checks']) requireThat(Array.isArray(entry.scope[field]) && entry.scope[field].length <= 4096 && entry.scope[field].every(v => typeof v === 'string' && v.length <= 256), 'CatalogueScope');
    requireThat(typeof entry.scope.target === 'string' && entry.scope.target.length <= 256, 'CatalogueScope');
    requireThat(Array.isArray(entry.modes) && entry.modes.length > 0 && entry.modes.length <= 3 && new Set(entry.modes).size === entry.modes.length && entry.modes.every(mode => modes.includes(mode)), 'CatalogueModes');
    const image = bytes(entry.image), schema = decodeSchema(bytes(entry.taskSchema)), session = decodeValue(schema, bytes(entry.initialTask));
    requireThat(Array.isArray(session) && session.length === 2 && Number.isInteger(session[1]) && session[1] > 0 && session[1] <= 16, 'CatalogueSession');
    const initial = session[0];
    requireThat(Array.isArray(initial) && initial.length === 13 && typeof initial[3] === 'string' && typeof initial[12] === 'bigint', 'CatalogueTask');
    const grants = entry.principals.map(grant => {
      closed(grant, ['tenant', 'principal', 'taskPrincipal']); identifier(grant.tenant); identifier(grant.principal);
      requireThat(typeof grant.taskPrincipal === 'string' && /^[1-9][0-9]{0,19}$/.test(grant.taskPrincipal) && BigInt(grant.taskPrincipal) <= 0xffffffffffffffffn, 'CataloguePrincipal');
      const deployment = config.deployments.find(d => d.imageDigest === hash(image) && d.programId === entry.programId && d.tenant === grant.tenant && d.principals.includes(grant.principal) && d.issuers.includes(issuer.id) && d.hosts.includes(config.hostId));
      requireThat(deployment, 'CatalogueDeployment');
      return { ...grant, deployment: structuredClone(deployment) };
    });
    const reportSchema = Uint8Array.from(bytes(entry.reportSchema)); decodeSchema(reportSchema);
    entries.set(entry.id, { reportSchema, entry: structuredClone(entry), image, schema, initial, maximumTasks: session[1], grants });
  }
  const admitted = (item, identity) => item.grants.find(g => g.tenant === identity.tenant && g.principal === identity.principal && !config.revoked.includes(`${g.tenant}/${g.principal}`));
  const authorizeView = (identity, run) => {
    requireThat([...entries.values()].some(item => hash(item.image) === run.image_digest && admitted(item, identity) && identity.audiences?.includes(item.entry.presentation.audience) && run.classification.every(label => item.entry.presentation.labels.includes(label))), 'PresentationDenied');
  };
  return Object.freeze({
    authorizeView,
    async exportResult(identity, id) {
      authorizeView(identity, custodian.authorizeUser(id, identity));
      const { run, bytes: stored } = custodian.outcome(id), outcome = world.decodeOutcome(stored);
      const schema = this.resultSchema(run.image_digest); requireThat(schema, 'ResultSchemaUnavailable');
      let report = outcome.kind === 'completed' ? decodeValue(decodeSchema(schema), outcome.value) : null;
      if (outcome.kind === 'requested') {
        const request = await world.decodeRequest(outcome.request);
        if (request.semanticIdentity === 'agent.repository.next-task.v1') report = decodeValue(decodeSchema(request.payloadSchema), request.payload)[0];
      }
      const current = custodian.authorizeUser(id, identity); authorizeView(identity, current);
      requireThat(current.outcome_digest === run.outcome_digest, 'ResultChanged');
      // Both installed CLI and browser export the same identity-bound snapshot.
      return JSON.parse(JSON.stringify({ format: 'agent.repository.export/v1', run_id: id, principal: run.principal_ref, tenant: run.tenant_ref,
        image: run.image_digest, program: run.program_id, outcome: run.outcome_digest, classification: run.classification,
        kind: outcome.kind, report, delivery: custodian.status(id).delivery ?? null }, (_, value) => typeof value === 'bigint' ? value.toString() : value));
    },
    resultSchema(imageDigest) {
      const item = [...entries.values()].find(item => hash(item.image) === imageDigest);
      return item ? Uint8Array.from(item.reportSchema) : null;
    },
    list(identity) {
      return [...entries.values()].filter(item => admitted(item, identity)).map(({ entry, initial, maximumTasks }) => ({
        id: entry.id, title: entry.title, repository: initial[4], base: initial[5], scope: structuredClone(entry.scope), profile: entry.profile, modes: [...entry.modes], defaultMode: entry.modes.includes('propose') ? 'propose' : entry.modes[0],
        maximumTasks, budget: { steps: initial[10], checks: initial[11], moves: initial[7][3][0] },
      }));
    },
    async start(identity, request) {
      closed(request, ['entry', 'mode', 'goal']);
      const item = entries.get(request.entry), grant = item && admitted(item, identity);
      requireThat(grant && item.entry.modes.includes(request.mode), 'TaskDenied');
      requireThat(typeof request.goal === 'string' && request.goal.trim().length > 0 && Buffer.byteLength(request.goal) <= 4096, 'TaskGoal');
      const task = structuredClone(item.initial);
      task[0] = randomBytes(8).readBigUInt64LE() || 1n; task[1] = 0n;
      task[2] = modes.indexOf(request.mode); task[3] = request.goal; task[12] = BigInt(grant.taskPrincipal);
      const args = encodeValue(item.schema, [task, item.maximumTasks]), id = runId(issuer.id);
      const registration = signRecord('run', { format: 'agent-mobility-run/v1', run_id: id, issuer_id: issuer.id,
        principal_ref: grant.principal, tenant_ref: grant.tenant, image_digest: hash(item.image), program_id: item.entry.programId,
        trusted_runtime_profile: runtimeProfile, allowed_host_policy_ref: config.trustDomain, deployment_policy_revision: config.revision,
        initial_classification: grant.deployment.classification, initial_host_id: config.hostId, initial_epoch: '0', deployment_limits: grant.deployment.limits, key_id: issuer.keyId }, privateKey);
      await custodian.registerRun(registration, item.image, args);
      return custodian.status(id);
    },
  });
}
