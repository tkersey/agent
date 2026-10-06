// Deployment-owned grants and conservative state restrictions. Neither a
// placement observation nor an image's effect names create authority.
import { encodeSchema, decodeSchema, encodeValue, decodeValue } from '../values.mjs';
import { hash } from './protocol.mjs';
import { identifier, requireThat, labels, digest } from './canonical.mjs';
import { canonicalRequirements } from './admission.mjs';
const equal = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);
const option = value => value === null ? { tag: 0, value: null } : { tag: 1, value };
export function requirement(binding) {
  return [binding.operation, [...Buffer.from(hash(binding.payloadSchema), 'hex')], [...Buffer.from(hash(binding.resultSchema), 'hex')], binding.role,
    binding.subject, option(binding.subjectVersion === null ? null : [...Buffer.from(binding.subjectVersion, 'hex')]), binding.scope,
    option(binding.trustDomain), option(binding.audience)];
}
export function requirementId(value) { return hash(canonicalRequirements([value])); }
function sameRequirement(wanted, binding) {
  const offered = requirement(binding);
  // No application trust-domain constraint means the deployment still decides.
  if (wanted[7].tag === 0) offered[7] = option(null);
  return equal(canonicalRequirements([wanted]), canonicalRequirements([offered]));
}
export class HostPolicy {
  #host; #domain; #profile; #revision; #deployments; #bindings; #exports; #revoked;
  constructor({ hostId, trustDomain, runtimeProfile, revision, deployments, bindings, labelDestinations, revoked = new Set() }) {
    this.#host = identifier(hostId); this.#domain = identifier(trustDomain); this.#profile = digest(runtimeProfile); this.#revision = identifier(revision);
    this.#deployments = deployments; this.#bindings = bindings; this.#exports = labelDestinations; this.#revoked = revoked;
    for (const binding of bindings) {
      identifier(binding.operation, 256); identifier(binding.role); identifier(binding.subject); identifier(binding.scope); labels(binding.classification);
      labels(binding.allowedStateLabels);
      requireThat(!['agent.mobility.resolve.v1', 'agent.mobility.relocate.v1'].includes(binding.operation), 'ProtectedBinding');
      requireThat(binding.trustDomain === trustDomain && typeof binding.authorize === 'function' && (typeof binding.handle === 'function' || (typeof binding.defer === 'function' && typeof binding.answer === 'function' && typeof binding.deferredRevision === 'string' && binding.deferredRevision.length > 0)), 'InvalidBinding');
      requireThat(binding.publication !== true || typeof binding.recoveryMatches === 'function', 'InvalidRecoveryBinding');
      for (const bytes of [binding.payloadSchema, binding.resultSchema]) requireThat(equal(encodeSchema(decodeSchema(bytes)), bytes), 'InvalidBindingSchema');
    }
    requireThat(new Set(bindings.map(binding => requirementId(requirement(binding)))).size === bindings.length, 'DuplicateBinding');
  }
  get hostId() { return this.#host; }
  get revision() { return this.#revision; }
  get trustDomain() { return this.#domain; }
  deployment(run) {
    // The signed registration fixes this issuer prefix. Peer authentication is
    // a separate grant and cannot authorize registration of another principal.
    const issuer = run.run_id.slice(0, -65);
    const entry = this.#deployments.find(item => item.imageDigest === run.image_digest && item.programId === run.program_id && item.tenant === run.tenant_ref && item.principals.includes(run.principal_ref) && Array.isArray(item.issuers) && item.issuers.includes(issuer));
    requireThat(entry && run.trusted_runtime_profile === this.#profile && entry.hosts.includes(this.#host), 'DeploymentDenied');
    return entry;
  }
  authorizeRun(run, { cleanup = false } = {}) {
    const entry = this.deployment(run);
    requireThat(cleanup || !this.#revoked.has(`${run.tenant_ref}/${run.principal_ref}`), 'PrincipalRevoked');
    const classification = run.classification ?? run.initial_classification;
    requireThat(entry.classification.every(label => classification.includes(label)), 'ClassificationDowngrade');
    requireThat((run.initial_classification ?? []).every(label => classification.includes(label)), 'ClassificationDowngrade');
    requireThat(classification.every(label => this.#exports[label]?.includes(this.#host)), 'StateImportDenied');
    return entry;
  }
  cleanupRequirements(run) { return this.deployment(run).cleanup.map(requirementId).sort(); }
  checkCleanup(run, offered = null) {
    const entry = this.deployment(run), expected = this.cleanupRequirements(run);
    if (offered !== null) requireThat(expected.length === offered.length && expected.every((value, i) => value === offered[i]), 'CleanupManifestMismatch');
    requireThat(entry.cleanup.every(item => this.bindingForRequirement(run, item, true) !== null), 'CleanupUnsupported');
    return expected;
  }
  mayExport(run, destination, exportPolicy = null) {
    const entry = this.authorizeRun(run);
    requireThat(entry.hosts.includes(destination), 'DestinationDenied');
    requireThat(run.classification.every(label => this.#exports[label]?.includes(destination)), 'StateExportDenied');
    if (exportPolicy !== null) requireThat(entry.exportPolicies[exportPolicy]?.includes(destination), 'ExportPolicyDenied');
  }
  bindingForRequirement(run, wanted, cleanup = false) {
    this.authorizeRun(run, { cleanup });
    return this.#bindings.find(binding => this.#eligible(run, binding) &&
      (!cleanup || binding.cleanup === true) && sameRequirement(wanted, binding)) ?? null;
  }
  #eligible(run, binding) {
    return binding.enabled !== false && binding.tenants.includes(run.tenant_ref) && binding.principals.includes(run.principal_ref) &&
      (run.classification ?? run.initial_classification).every(label => binding.allowedStateLabels.includes(label)) &&
      binding.classification.every(label => this.#exports[label]?.includes(this.#host));
  }
  preflight(registration, requirements, constraints, classification) {
    const run = { ...registration, classification }; this.authorizeRun(run); this.checkCleanup(run);
    const requirementsDigest = hash(canonicalRequirements(requirements));
    // Metadata is stable within this synchronous inspection. Normalize each
    // encountered binding once, not once per requested capability. Nothing is
    // cached across calls: revocation, reconfiguration and actual leaf dispatch
    // still observe current local policy.
    const encoded = new Map();
    const selected = requirements.map(wanted => {
      const bytes = canonicalRequirements([wanted]), domainFree = wanted[7].tag === 0;
      return this.#bindings.find(binding => {
        if (!this.#eligible(run, binding)) return false;
        let row = encoded.get(binding);
        if (!row) { row = { value: requirement(binding) }; encoded.set(binding, row); }
        const key = domainFree ? 'domainFree' : 'exact';
        if (!row[key]) {
          const value = [...row.value]; if (domainFree) value[7] = option(null);
          row[key] = canonicalRequirements([value]);
        }
        return equal(bytes, row[key]);
      }) ?? null;
    });
    requireThat(selected.every(Boolean), 'CapabilityUnavailable');
    const [domains, required] = constraints;
    requireThat(domains.length === 0 || domains.includes(this.#domain), 'TrustDomainDenied');
    requireThat(required.tag === 0 || required.value === this.#host, 'DestinationDenied');
    const bindingBytes = canonicalRequirements([...new Set(selected)].map(requirement));
    return { host_id: this.#host, requirements_digest: requirementsDigest, binding_digest: hash(bindingBytes), policy_revision: this.#revision, runtime_profile: this.#profile };
  }
  dispatch(run, request) {
    const entry = this.authorizeRun(run, { cleanup: true }), revoked = this.#revoked.has(`${run.tenant_ref}/${run.principal_ref}`);
    const candidates = this.#bindings.filter(binding => binding.enabled !== false && binding.operation === request.semanticIdentity && equal(binding.payloadSchema, request.payloadSchema) && equal(binding.resultSchema, request.resumeSchema) &&
      binding.tenants.includes(run.tenant_ref) && binding.principals.includes(run.principal_ref));
    for (const binding of candidates) {
      const cleanup = binding.cleanup === true && entry.cleanup.some(value => sameRequirement(value, binding));
      if (revoked && !cleanup) continue;
      if (!this.#eligible(run, binding)) continue;
      const payload = decodeValue(decodeSchema(request.payloadSchema), request.payload);
      // Payload authorization is synchronous so policy checking and durable
      // dispatch admission have no asynchronous check-then-act gap.
      const allowed = binding.authorize(payload, run);
      requireThat(!(allowed instanceof Promise), 'AsyncBindingAuthorization');
      if (allowed) return { binding, bindingId: requirementId(requirement(binding)), payload, cleanup };
    }
    requireThat(false, revoked ? 'PrincipalRevoked' : 'LeafBindingDenied');
  }
  recovery(run, request, bindingId = null) {
    // Revocation forbids new effects, but cannot erase the result of an already
    // admitted work. Recovery identifies its owner; it grants no fresh effect.
    this.authorizeRun(run, { cleanup: true });
    const payload = decodeValue(decodeSchema(request.payloadSchema), request.payload);
    const bindings = this.#bindings.filter(candidate => typeof candidate.recoveryMatches === 'function' &&
      candidate.operation === request.semanticIdentity && equal(candidate.payloadSchema, request.payloadSchema) &&
      equal(candidate.resultSchema, request.resumeSchema) && candidate.tenants.includes(run.tenant_ref) &&
      candidate.principals.includes(run.principal_ref) && (bindingId === null || requirementId(requirement(candidate)) === bindingId) &&
      run.classification.every(label => candidate.allowedStateLabels.includes(label)) &&
      candidate.classification.every(label => this.#exports[label]?.includes(this.#host)) && candidate.recoveryMatches(payload, run));
    // Older occurrences have no binding ID: recover only an unambiguous owner.
    return bindings.length === 1 ? { binding: bindings[0], payload } : null;
  }
  encodeResult(binding, value) { return encodeValue(decodeSchema(binding.resultSchema), value); }
}
