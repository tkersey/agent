// Reference host orchestration. Every next application action comes from the
// current World request; this module owns only admission, dispatch and custody.
import { encodeValue, decodeValue, decodeSchema } from '../values.mjs';
import { canonical, parse, hash } from './protocol.mjs';
import { requireThat, labels } from './canonical.mjs';
import { schemas, observationValue, decodeMobilityRequest } from './values.mjs';
import { canonicalRequirements } from './admission.mjs';
import { version, active, canAbandon, RELOCATE } from './custody.mjs';
const RESOLVE = 'agent.mobility.resolve.v1';
const same = (a, b) => hash(canonical(a)) === hash(canonical(b));
const option = value => value === null ? { tag: 0, value: null } : { tag: 1, value: BigInt(value) };
const reason = code => ({ tag: ({ StateExportDenied: 2, ExportPolicyDenied: 2, LeafDisclosureDenied: 2, PrincipalRevoked: 1, DeploymentDenied: 1, DestinationDenied: 1,
  StateImportDenied: 2, CleanupUnsupported: 8, CleanupManifestMismatch: 8, PinnedResource: 7, MoveBudget: 9, ArtifactCapacity: 5,
  ObservationMismatch: 3, RelocationMismatch: 3, ArtifactMismatch: 3, RuntimeMismatch: 4, WORLD_CAPACITY: 5, WORLD_KERNEL_REJECTED: 13, AdmissionExpired: 11, LocalCustodyConflict: 14 })[code] ?? 0, value: null });
const reasonName = code => ['unavailable', 'policy_denied', 'export_denied', 'binding_mismatch', 'runtime_mismatch', 'capacity', 'unsettled_occurrence', 'pinned_resource', 'cleanup_unsupported', 'budget_exhausted', 'withdrawn', 'expired_offer', 'already_here', 'invalid_state', 'busy', 'unsupported'][reason(code).tag];

export class Custodian {
  #journal; #admission; #world; #policy; #peers; #residents = new Map(); #busy = new Set(); #operations = new Map(); #diagnostics = [];
  constructor({ journal, admission, world, policy, peers = new Map() }) {
    requireThat(peers.size <= 32 && !peers.has(policy.hostId), 'PeerConfiguration');
    this.#journal = journal; this.#admission = admission; this.#world = world; this.#policy = policy; this.#peers = peers;
  }
  get hostId() { return this.#policy.hostId; }
  #run(id) { const run = this.#journal.run(id); requireThat(run !== null, 'UnknownRun'); return run; }
  #registration(run) { return this.#journal.artifact(run.tenant_ref, run.registration_digest); }
  #policyValues(run) {
    const entry = this.#policy.deployment(run), sourceLimits = run.deployment_limits;
    const limits = Object.fromEntries(Object.entries(sourceLimits).map(([key, value]) => [key, Math.min(value, entry.limits?.[key] ?? value)]));
    const classification = [...new Set([...run.classification, ...(entry.admissionClassification ?? [])])].sort();
    return { cleanupRequirements: this.#policy.checkCleanup({ ...run, classification }), classification, deploymentLimits: limits, policyRevision: this.#policy.revision };
  }
  async registerRun(registrationBytes, image, initialArgs) {
    const registration = this.#journal.registration(registrationBytes); this.#policy.authorizeRun(registration); this.#policy.checkCleanup(registration);
    requireThat(registration.initial_host_id === this.hostId && hash(image) === registration.image_digest, 'RegistrationMismatch');
    const policy = this.#policyValues({ ...registration, classification: registration.initial_classification });
    requireThat(image.length <= policy.deploymentLimits.maximum_image_bytes, 'ArtifactCapacity');
    const executor = await this.#admission.start(image, initialArgs, registration.program_id);
    try {
      let run = this.#journal.register(registrationBytes, executor.current(), policy);
      if (run.status === 'ACTIVE') {
        run = this.#journal.attach(run.run_id, version(run)); this.#residents.set(run.run_id, { executor, version: version(run) });
      } else executor.retire();
      return run;
    } catch (error) { executor.retire(); throw error; }
  }
  async #resident(id) {
    let run = this.#run(id); requireThat(run.status === 'ACTIVE', 'CustodyFrozen');
    let cached = this.#residents.get(id);
    if (cached && !same(cached.version, version(run))) { this.#retire(id); cached = null; }
    if (!cached) {
      this.#policy.authorizeRun(run, { cleanup: true });
      run = this.#journal.applyPolicy(id, version(run), this.#policyValues(run));
      const token = await this.#admission.stored(this.#journal.artifact(run.tenant_ref, run.image_digest), this.#journal.artifact(run.tenant_ref, run.outcome_digest), run.program_id);
      const executor = await this.#admission.resume(token);
      try { run = this.#journal.attach(id, version(run)); } catch (error) { executor.retire(); throw error; }
      cached = { executor, version: version(run) }; this.#residents.set(id, cached);
    }
    return { run, cached };
  }
  #retire(id) {
    const cached = this.#residents.get(id); if (!cached) return;
    this.#residents.delete(id);
    try { cached.executor.retire(); } catch (error) {
      // Physical disposal cannot restore old execution authority. Keep the
      // failure separate from semantic cleanup and the transfer decision.
      const code = /^[A-Za-z0-9_]{1,80}$/.test(error.code ?? '') ? error.code : 'ExecutorRetirementFailure';
      let recorded = true;
      try { this.#journal.retirementIssue(id, cached.version, code); } catch { recorded = false; }
      this.#diagnostics = [...this.#diagnostics.slice(-63), { run_id: id, ...cached.version, code, journal_recorded: recorded }];
    }
  }
  diagnostics() { return structuredClone(this.#diagnostics); }
  metrics(id) { return this.#journal.metrics(id); }
  outcome(id) {
    const run = this.#run(id);
    return { run, bytes: Uint8Array.from(this.#journal.artifact(run.tenant_ref, run.outcome_digest)) };
  }
  noteStaleDispatch(id) { this.#journal.noteStaleDispatch(id); }
  authorizeUser(id, identity, { cleanup = false, executor = false } = {}) {
    const run = this.#run(id);
    requireThat(identity?.principal === run.principal_ref && identity?.tenant === run.tenant_ref, 'UserDenied');
    this.#policy.authorizeRun(run, { cleanup: cleanup || (executor && run.cancel_requested !== null) }); return run;
  }
  async executorAssignment(id) {
    requireThat(!this.#busy.has(id), 'ExecutorBusy'); this.#busy.add(id);
    try {
      const { run, cached } = await this.#resident(id);
      const attached = this.#journal.attach(id, version(run)); cached.version = version(attached);
      const data = this.#admission.read(cached.executor.current());
      return { version: cached.version, image: data.image, outcome: data.outcome, runtime_profile: attached.trusted_runtime_profile };
    } finally { this.#busy.delete(id); }
  }
  #assigned(id, wanted) {
    const run = this.#run(id); active(run, wanted);
    const cached = this.#residents.get(id); requireThat(cached && same(cached.version, wanted), 'ExecutorUnavailable');
    return { run, cached };
  }
  #command(run) {
    let occurrence = this.#journal.occurrence(run.current_occurrence_id);
    if (run.cancel_requested !== null && !run.cancel_applied) {
      if (!this.#operations.has(run.run_id) && canAbandon(occurrence) && ['DISPATCHING', 'UNKNOWN'].includes(occurrence.status))
        occurrence = this.#journal.abandonLeaf(run.run_id, occurrence.attempt_id);
      if (!occurrence || ['READY', 'AWAITING', 'ABANDONED'].includes(occurrence.status) || (occurrence.status === 'SETTLED_REPLY' && occurrence.operation === RELOCATE)) return { kind: 'cancel', reason: run.cancel_requested };
    }
    if (occurrence?.status === 'SETTLED_REPLY') return { kind: 'reply', value: this.#journal.artifact(run.tenant_ref, occurrence.reply_digest) };
    if (!occurrence && ['progressed', 'yielded'].includes(run.outcome_kind))
      return { kind: run.outcome_kind === 'yielded' ? 'resume_yield' : 'none' };
    return null;
  }
  async executorCommand(id, wanted) {
    requireThat(!this.#busy.has(id), 'ExecutorBusy'); this.#busy.add(id);
    try {
      const { run, cached } = this.#assigned(id, wanted);
      let command = this.#command(run);
      if (!command) {
        const occurrence = this.#journal.occurrence(run.current_occurrence_id);
        const uncertain = occurrence && ['UNKNOWN', 'DISPATCHING'].includes(occurrence.status);
        if (occurrence?.status !== 'READY' && !uncertain) return { kind: 'blocked', status: this.status(id) };
        const result = uncertain ? await this.#reconcile(run, cached.executor.current(), occurrence) : await this.#dispatch(run, cached.executor.current());
        if (!['reply_saved', 'refused', 'cancel_ready'].includes(result.kind)) return result;
        const latest = this.#assigned(id, wanted).run; command = this.#command(latest);
      }
      requireThat(command !== null, 'ControlUnavailable');
      return { kind: 'drive', command, version: wanted };
    } finally { this.#busy.delete(id); }
  }
  async publishExecutor(id, wanted, report) {
    requireThat(!this.#busy.has(id), 'ExecutorBusy'); this.#busy.add(id);
    try {
      const { run, cached } = this.#assigned(id, wanted), command = this.#command(run);
      requireThat(command !== null, 'ReplyNotAcquired');
      const input = command.kind === 'reply' ? { kind: 'reply', reply_digest: hash(command.value) } : command;
      try {
        const next = await cached.executor.drive(command), expected = this.#admission.read(next).outcome;
        requireThat(report instanceof Uint8Array && expected.length === report.length && expected.every((byte, i) => byte === report[i]), 'SuccessorMismatch');
        const published = this.#journal.publishOutcome(id, wanted, input, next); cached.version = version(published);
        if (published.status === 'TERMINAL') this.#retire(id);
        return { version: version(published), status: this.status(id) };
      } catch (error) { this.#retire(id); throw error; }
    } finally { this.#busy.delete(id); }
  }
  async stopOperations() { const operations = [...this.#operations.values()]; for (const operation of operations) operation.controller.abort(); await Promise.all(operations.map(operation => operation.settled)); }
  retireAll() { for (const id of this.#residents.keys()) this.#retire(id); }
  status(id) {
    const run = this.#run(id), occurrence = this.#journal.occurrence(run.current_occurrence_id);
    const publication = this.#journal.latestPublication(id);
    return { ...(publication ? { delivery: { status: 'published', presentation: run.status === 'TERMINAL' && run.outcome_kind === 'completed' ? 'available' : 'pending', receipt: publication } } : {}), ...this.#journal.custodyKnowledge(run), run_id: id, host_id: this.hostId, custody: run.status, epoch: run.custody_epoch, revision: run.execution_revision,
      executor_incarnation: run.executor_incarnation, operation: occurrence?.operation ?? null, occurrence: occurrence?.status ?? null,
      classification: [...run.classification], transfer_id: run.transfer_id, cancellation_pending: run.cancel_requested !== null && run.status !== 'TERMINAL' && !(run.status === 'DEPARTED' && run.cancel_forwarded), cancellation_applied: run.cancel_applied, cancellation_forwarded: run.cancel_forwarded ?? false, local_move_attempts: run.local_move_attempts };
  }
  #metadata(run, requirements, constraints) {
    return { registration: this.#registration(run), requirements: canonicalRequirements(requirements), constraints: encodeValue(schemas.constraints, constraints), classification: [...run.classification] };
  }
  preflight(peerId, metadata) {
    const registration = this.#journal.registration(metadata.registration), entry = this.#policy.deployment(registration);
    requireThat(entry.hosts.includes(peerId), 'PeerDenied'); labels(metadata.classification);
    const requirements = decodeValue(schemas.requirements, metadata.requirements), constraints = decodeValue(schemas.constraints, metadata.constraints);
    requireThat(hash(canonicalRequirements(requirements)) === hash(metadata.requirements), 'NonCanonicalRequirements');
    const observation = this.#policy.preflight(registration, requirements, constraints, metadata.classification);
    return { observation, trust_domain: this.#policy.trustDomain, cost: { transfer: '1', startup: '1', capability: '1' }, cost_revision: this.#policy.revision,
      has_image: this.#journal.hasArtifact(registration.tenant_ref, registration.image_digest) };
  }
  async #resolve(run, request) {
    const { value: [requirements, constraints] } = decodeMobilityRequest(request), metadata = this.#metadata(run, requirements, constraints);
    const digest = hash(metadata.requirements), observations = [];
    const evidence = { requirements_digest: digest, maximum_state_bytes: constraints[3].toString(), constraints: Buffer.from(metadata.constraints).toString('base64url'), observations };
    try {
      const here = this.#policy.preflight(this.#journal.registration(metadata.registration), requirements, constraints, run.classification);
      return { value: { tag: 0, value: observationValue(here) }, evidence };
    } catch (error) { if (!['CapabilityUnavailable', 'DestinationDenied', 'TrustDomainDenied', 'CleanupUnsupported'].includes(error.code)) throw error; }
    const candidates = []; let denial = 'CapabilityUnavailable';
    for (const [host, peer] of this.#peers) {
      try {
        this.#policy.mayExport(run, host);
        requireThat(this.#journal.artifact(run.tenant_ref, run.outcome_digest).length <= BigInt(constraints[3]), 'ArtifactCapacity');
        const result = await peer.preflight(metadata);
        requireThat(result.observation.host_id === host && result.observation.requirements_digest === digest && result.observation.runtime_profile === run.trusted_runtime_profile, 'ObservationMismatch');
        observations.push(result.observation);
        candidates.push([observationValue(result.observation), result.trust_domain, option(result.cost.transfer), option(result.cost.startup), option(result.cost.capability), result.cost_revision]);
      } catch (error) { denial = error.code; }
    }
    return { value: candidates.length ? { tag: 1, value: candidates } : { tag: 2, value: reason(denial) }, evidence };
  }
  async step(id) {
    requireThat(!this.#busy.has(id), 'ExecutorBusy'); this.#busy.add(id);
    try {
      const initial = this.#run(id), status = initial.status;
      if (initial.cancel_requested !== null && (status === 'OFFERED' || (status === 'DEPARTED' && !initial.cancel_forwarded))) return this.cancelRun(id, initial.cancel_requested);
      if (status !== 'ACTIVE') return { kind: status.toLowerCase(), status: this.status(id) };
      const { run, cached } = await this.#resident(id);
      const command = this.#command(run);
      if (command) {
        const input = command.kind === 'reply' ? { kind: 'reply', reply_digest: hash(command.value) } : command;
        try {
          const next = await cached.executor.drive(command);
          const published = this.#journal.publishOutcome(id, version(run), input, next);
          cached.version = version(published);
          if (published.status === 'TERMINAL') this.#retire(id);
          return { kind: published.status === 'TERMINAL' ? 'terminal' : published.outcome_kind === 'yielded' ? 'yielded' : 'published', status: this.status(id) };
        } catch (error) { this.#retire(id); throw error; }
      }
      const occurrence = this.#journal.occurrence(run.current_occurrence_id);
      if (occurrence && ['UNKNOWN', 'DISPATCHING'].includes(occurrence.status)) return this.#reconcile(run, cached.executor.current(), occurrence);
      if (occurrence?.status === 'AWAITING') return { kind: 'awaiting', status: this.status(id) };
      return await this.#dispatch(run, cached.executor.current());
    } finally { this.#busy.delete(id); }
  }
  async #reconcile(run, token, occurrence) {
    const id = run.run_id;
    const publication = occurrence.operation === 'agent.repository.publish.v1';
    if (this.#operations.has(id) || (!publication && (run.cancel_requested === null || run.cancel_applied || occurrence.work_kind === 'check')))
      return { kind: this.#operations.has(id) ? 'dispatching' : 'effect_unknown', status: this.status(id) };
    const data = this.#admission.read(token), decoded = this.#world.decodeOutcome(data.outcome);
    const request = await this.#world.decodeRequest(decoded.request), selected = this.#policy.recovery(run, request, occurrence.binding_id ?? null);
    if (!publication) {
      if (!selected?.binding.cancelSafe) return { kind: 'effect_unknown', status: this.status(id) };
      this.#journal.abandonLeaf(id, occurrence.attempt_id, { cancelSafe: true });
      return { kind: 'cancel_ready', status: this.status(id) };
    }
    requireThat(selected?.binding.publication === true, 'PublicationRecoveryDenied');
    const result = await selected.binding.reconcile({ payload: selected.payload, request, run, occurrence });
    this.#world.validateValue(request.resumeSchema, result.reply);
    this.#journal.recordReply(id, occurrence.attempt_id, result.reply, selected.binding.classification, null,
      { publicationReceipt: result.publicationReceipt });
    return { kind: 'reply_saved', status: this.status(id) };
  }
  async #dispatch(run, token) {
      const id = run.run_id;
      const data = this.#admission.read(token), decoded = this.#world.decodeOutcome(data.outcome), request = await this.#world.decodeRequest(decoded.request);
      if (request.semanticIdentity === RELOCATE) return this.#beginTransfer(run, token);
      const selected = request.semanticIdentity === RESOLVE ? null : this.#policy.dispatch(run, request);
      if (selected === null) this.#policy.authorizeRun(run);
      if (selected?.binding.defer) {
        const pending = selected.binding.defer({ payload: selected.payload, request, run });
        requireThat(!(pending instanceof Promise), 'AsyncDeferredRegistration');
        requireThat(pending.audience === selected.binding.audience, 'QuestionAudienceMismatch');
        this.#journal.deferLeaf(id, version(run), { ...pending, format: 'agent-deferred-leaf/v1',
          principal: run.principal_ref, tenant: run.tenant_ref, request_digest: run.request_digest,
          binding_revision: selected.binding.deferredRevision, result_schema: Buffer.from(request.resumeSchema).toString('base64url') }, selected.binding.classification);
        return { kind: 'awaiting', status: this.status(id) };
      }
      const charge = selected?.binding.charge?.({ payload: selected.payload, request, run }) ?? null;
      requireThat(!(charge instanceof Promise), 'AsyncWorkAdmission');
      const admitted = this.#journal.admitLeaf(id, version(run), selected?.binding.classification ?? [], { cleanup: selected?.cleanup ?? false,
        charge, cancelSafe: selected?.binding.cancelSafe === true, bindingId: selected?.bindingId ?? null });
      if (selected?.binding.background === true) {
        requireThat(!this.#operations.has(id), 'ExternalOperationBusy');
        const controller = new AbortController(), operation = { controller, settled: null };
        this.#operations.set(id, operation);
        operation.settled = (async () => {
          try {
            const reply = await selected.binding.handle({ payload: selected.payload, request, run, occurrence: admitted, signal: controller.signal });
            this.#world.validateValue(request.resumeSchema, reply);
            this.#journal.recordReply(id, admitted.attempt_id, reply, selected.binding.classification, null, { dispatchVersion: version(run) });
          } catch {
            const current = this.#run(id), pending = this.#journal.occurrence(current.current_occurrence_id);
            // The check adapter has finished reaping even when its reply is lost.
            // Preserve that fact for a later cancellation, including after restart.
            if (pending?.attempt_id === admitted.attempt_id && ['DISPATCHING', 'UNKNOWN'].includes(pending.status))
              this.#journal.markUnknown(id, admitted.attempt_id, { settled: true });
          } finally {
            const current = this.#run(id), pending = this.#journal.occurrence(current.current_occurrence_id);
            if (current.cancel_requested !== null && pending?.attempt_id === admitted.attempt_id && pending.cancel_safe === true && ['DISPATCHING', 'UNKNOWN'].includes(pending.status))
              this.#journal.abandonLeaf(id, admitted.attempt_id, { settled: true });
            this.#operations.delete(id);
          }
        })().catch(error => {
          this.#operations.delete(id);
          const code = /^[A-Za-z0-9_]{1,80}$/.test(error.code ?? '') ? error.code : 'ExternalSettlementFailure';
          this.#diagnostics = [...this.#diagnostics.slice(-63), { run_id: id, code }];
        });
        return { kind: 'dispatching', status: this.status(id) };
      }
      try {
        let reply, evidence = null, publicationReceipt = null;
        if (selected === null) {
          const resolved = await this.#resolve(this.#run(id), request); reply = encodeValue(schemas.resolution, resolved.value); evidence = resolved.evidence;
        } else {
          const result = await selected.binding.handle({ payload: selected.payload, request, run: this.#run(id), occurrence: admitted });
          if (selected.binding.publication === true) {
            requireThat(request.semanticIdentity === 'agent.repository.publish.v1', 'PublicationOperationMismatch');
            reply = result.reply; publicationReceipt = result.publicationReceipt;
          } else reply = result;
        }
        this.#world.validateValue(request.resumeSchema, reply);
        this.#journal.recordReply(id, admitted.attempt_id, reply, selected?.binding.classification ?? [], null, { placementEvidence: evidence, publicationReceipt });
        return { kind: 'reply_saved', status: this.status(id) };
      } catch (error) { this.#journal.markUnknown(id, admitted.attempt_id); throw error; }
  }
  pendingQuestion(id, identity) {
    const run = this.authorizeUser(id, identity), occurrence = this.#journal.occurrence(run.current_occurrence_id);
    if (!occurrence?.pending_digest || !['AWAITING', 'SETTLED_REPLY'].includes(occurrence.status) || run.cancel_requested !== null || run.status !== 'ACTIVE') return null;
    const pending = parse(this.#journal.artifact(run.tenant_ref, occurrence.pending_digest), { maximum: 2 << 20 });
    requireThat(identity.audiences?.includes(pending.audience), 'UserDenied');
    return { version: version(run), occurrence_id: occurrence.id, request_digest: occurrence.request_digest,
      pending_digest: occurrence.pending_digest, acquired: occurrence.status === 'SETTLED_REPLY', pending };
  }
  async answerQuestion(id, identity, submission) {
    requireThat(!this.#busy.has(id), 'ExecutorBusy'); this.#busy.add(id);
    try {
      const run = this.authorizeUser(id, identity), occurrence = this.#journal.occurrence(run.current_occurrence_id);
      active(run, submission.version, false);
      requireThat(occurrence?.pending_digest && ['AWAITING', 'SETTLED_REPLY'].includes(occurrence.status), 'QuestionNotPending');
      const pending = parse(this.#journal.artifact(run.tenant_ref, occurrence.pending_digest), { maximum: 2 << 20 });
      requireThat(identity.audiences?.includes(pending.audience), 'UserDenied');
      requireThat(submission.occurrence_id === occurrence.id && submission.request_digest === occurrence.request_digest && submission.pending_digest === occurrence.pending_digest, 'QuestionMismatch');
      const answer = submission.answer;
      requireThat(answer && Object.keys(answer).sort().join(',') === 'choice,text' && pending.alternatives.includes(answer.choice) && typeof answer.text === 'string' && Buffer.byteLength(answer.text) <= pending.maximum_text_bytes, 'InvalidAnswer');
      if (occurrence.status === 'SETTLED_REPLY') {
        requireThat(run.cancel_requested === null, 'CancellationPending');
        requireThat(hash(canonical(answer)) === occurrence.answer_digest, 'ReplyConflict');
        return { occurrence_id: occurrence.id, reply_digest: occurrence.reply_digest, status: this.status(id) };
      }
      const decoded = this.#world.decodeOutcome(this.#journal.artifact(run.tenant_ref, run.outcome_digest));
      const request = await this.#world.decodeRequest(decoded.request), selected = this.#policy.dispatch(run, request);
      requireThat(selected.binding.deferredRevision === pending.binding_revision && typeof selected.binding.answer === 'function', 'DeferredBindingChanged');
      const reply = selected.binding.answer({ answer: submission.answer, pending, request, run });
      requireThat(!(reply instanceof Promise), 'AsyncDeferredAnswer');
      this.#world.validateValue(request.resumeSchema, reply);
      const acquired = this.#journal.answerDeferred(id, submission.version, submission, identity, submission.answer, reply, selected.binding.classification);
      return { occurrence_id: acquired.id, reply_digest: acquired.reply_digest, status: this.status(id) };
    } finally { this.#busy.delete(id); }
  }
  async run(id, maximumSteps = 128) {
    requireThat(Number.isInteger(maximumSteps) && maximumSteps > 0 && maximumSteps <= 10000, 'StepBudget');
    let result;
    for (let step = 0; step < maximumSteps; step++) {
      result = await this.step(id);
      if (!['published', 'reply_saved', 'refused', 'cancel_requested', 'cancel_ready'].includes(result.kind)) return result;
    }
    return { kind: 'budget', status: this.status(id) };
  }
  async #beginTransfer(run, token) {
    const data = this.#admission.read(token), relocation = data.relocation, destination = relocation.destination_host_id;
    const id = run.run_id;
    try {
      requireThat(destination !== this.hostId, 'AlreadyHere');
      requireThat(this.#peers.has(destination), 'DestinationDenied'); this.#policy.mayExport(run, destination, relocation.export_policy_ref); this.#policy.checkCleanup(run, run.cleanup_requirements);
      requireThat(run.resource_pins.length === 0, 'PinnedResource');
      const saved = run.placement_evidence?.requirements_digest === relocation.requirements_digest ? run.placement_evidence : null;
      if (saved) requireThat(BigInt(data.outcome.length) <= BigInt(saved.maximum_state_bytes), 'ArtifactCapacity');
      const constraints = saved ? decodeValue(schemas.constraints, Buffer.from(saved.constraints, 'base64url')) : [[], { tag: 1, value: destination }, { tag: 0, value: null }, BigInt(run.deployment_limits.maximum_outcome_bytes)];
      const preflight = await this.#peers.get(destination).preflight(this.#metadata(run, relocation.requirements, constraints));
      requireThat(preflight.observation.host_id === destination && preflight.observation.requirements_digest === relocation.requirements_digest && preflight.observation.runtime_profile === run.trusted_runtime_profile, 'ObservationMismatch');
      this.#policy.mayExport(this.#run(id), destination, relocation.export_policy_ref);
      const begun = this.#journal.beginTransfer(id, version(run), token, { observationDigest: hash(encodeValue(schemas.observation, observationValue(preflight.observation))), exportPolicyRevision: this.#policy.revision });
      this.#retire(id);
      return { kind: 'offered', transfer_id: parse(begun.offer).transfer_id, observation: preflight.observation, status: this.status(id) };
    } catch (error) {
      if (this.#run(id).status !== 'ACTIVE') return { kind: 'unknown', status: this.status(id) };
      this.#journal.settleUnsentRelocation(id, version(run), token, error.code === 'AlreadyHere' ? 'already_here' : reasonName(error.code));
      return { kind: 'refused', status: this.status(id) };
    }
  }
  async #outgoingTransfer(transferId) {
    const saved = this.#journal.transfer(transferId); requireThat(saved !== null, 'UnknownTransfer');
    const offer = parse(saved.offer), run = this.#run(offer.run_id);
    requireThat(offer.source_host_id === this.hostId && run.status === 'OFFERED' && run.transfer_id === transferId, 'TransferNotPending');
    const image = this.#journal.artifact(run.tenant_ref, offer.image_digest), outcome = this.#journal.artifact(run.tenant_ref, offer.outcome_digest);
    const token = await this.#admission.parked(image, outcome), relocation = this.#admission.read(token).relocation;
    this.#authorizeTransfer(offer, relocation);
    const observation = run.placement_evidence?.observations.find(value => value.host_id === offer.destination_host_id);
    // A fresh preflight may have a newer observation than discovery. Recompute
    // delivery metadata through preflight in retryTransfer and bind its digest.
    return { relocation, envelope: { offer: saved.offer, registration: this.#registration(run), predecessor: offer.source_epoch === '0' ? null : this.#journal.artifact(run.tenant_ref, offer.predecessor_receipt_digest), observation,
      image, outcome } };
  }
  #authorizeTransfer(offer, relocation) {
    const run = this.#run(offer.run_id);
    requireThat(run.status === 'OFFERED' && run.transfer_id === offer.transfer_id, 'TransferNotPending');
    requireThat(run.cancel_requested === null, 'CancellationPending');
    requireThat(relocation !== null && relocation.destination_host_id === offer.destination_host_id, 'RelocationMismatch');
    this.#policy.mayExport(run, offer.destination_host_id, relocation.export_policy_ref);
  }
  async transferEnvelope(transferId) {
    return (await this.#outgoingTransfer(transferId)).envelope;
  }
  async retryTransfer(transferId) {
    const saved = this.#journal.transfer(transferId); requireThat(saved !== null, 'UnknownTransfer');
    const offer = parse(saved.offer), current = this.#run(offer.run_id);
    // Retry the durable intent, including after restart. Withdrawal needs no
    // fresh artifact-export permission and reconciles an acceptance that won.
    if (current.status === 'OFFERED' && current.transfer_id === transferId && current.cancel_requested !== null)
      return this.cancelRun(offer.run_id, current.cancel_requested);
    const peer = this.#peers.get(offer.destination_host_id); requireThat(peer, 'DestinationDenied');
    try {
      let receipt = await peer.status(saved.offer);
      if (receipt === null) {
        const { envelope, relocation } = await this.#outgoingTransfer(transferId);
        const run = this.#run(offer.run_id), savedConstraints = run.placement_evidence?.requirements_digest === relocation.requirements_digest ? run.placement_evidence.constraints : null;
        const constraints = savedConstraints ? decodeValue(schemas.constraints, Buffer.from(savedConstraints, 'base64url')) : [[], { tag: 1, value: offer.destination_host_id }, { tag: 0, value: null }, BigInt(run.deployment_limits.maximum_outcome_bytes)];
        this.#authorizeTransfer(offer, relocation);
        const ready = await peer.preflight(this.#metadata(run, relocation.requirements, constraints));
        requireThat(hash(encodeValue(schemas.observation, observationValue(ready.observation))) === offer.destination_observation_digest, 'ObservationMismatch');
        this.#authorizeTransfer(offer, relocation);
        envelope.observation = ready.observation; envelope.requirements = canonicalRequirements(relocation.requirements); envelope.constraints = encodeValue(schemas.constraints, constraints); envelope.image_cached = ready.has_image === true; receipt = await peer.deliver(envelope);
      }
      this.#journal.receiveDecision(saved.offer, receipt);
      return { kind: parse(receipt).decision, status: this.status(offer.run_id) };
    } catch (error) { return { kind: 'unknown', reason: error.code ?? 'TransportUnavailable', status: this.status(offer.run_id) }; }
  }
  queryTransfer(peerId, offerBytes) {
    const offer = parse(offerBytes); requireThat(offer.source_host_id === peerId && offer.destination_host_id === this.hostId, 'PeerDenied');
    return this.#journal.savedDecision(offerBytes);
  }
  transferStatus(peerId, transferId) {
    const saved = this.#journal.transfer(transferId);
    if (saved === null) {
      const staged = this.#journal.stagedOffer(transferId);
      if (staged === null) return { state: 'unseen' };
      const offer = parse(staged); requireThat(offer.source_host_id === peerId && offer.destination_host_id === this.hostId, 'PeerDenied');
      return { state: 'pending' };
    }
    const offer = parse(saved.offer);
    requireThat(offer.source_host_id === peerId && offer.destination_host_id === this.hostId, 'PeerDenied');
    return saved.receipt === null ? { state: 'pending' } : { state: 'terminal', receipt: saved.receipt };
  }
  async control(peerId, registrationBytes, id, action, reasonText = null, hops = 32) {
    const registration = this.#journal.registration(registrationBytes), run = this.#run(id), entry = this.#policy.deployment(run);
    requireThat(registration.run_id === id && hash(registrationBytes) === run.registration_digest && entry.controlPeers?.includes(peerId), 'ControlDenied');
    requireThat(['status', 'cancel'].includes(action), 'InvalidControl');
    requireThat(Number.isInteger(hops) && hops > 0 && hops <= 32, 'ControlHopBudget');
    const applied = action === 'cancel' ? await this.cancelRun(id, reasonText, hops) : null;
    const status = this.status(id);
    return { run_id: id, host_id: this.hostId, custody: status.custody, epoch: status.epoch, transfer_id: status.transfer_id, cancellation_pending: status.cancellation_pending, cancellation: applied?.kind ?? null };
  }
  async cancelRun(id, reasonText, hops = 32) {
    requireThat(Number.isInteger(hops) && hops > 0 && hops <= 32, 'ControlHopBudget');
    let run = this.#run(id); this.#policy.authorizeRun(run, { cleanup: true });
    if (run.status === 'TERMINAL') return { kind: 'terminal', status: this.status(id) };
    run = this.#journal.requestCancel(id, reasonText);
    const operation = this.#operations.get(id);
    if (operation) { operation.controller.abort(); await operation.settled; run = this.#run(id); }
    if (run.status === 'ACTIVE') this.#command(run);
    if (run.status === 'OFFERED') {
      const decision = await this.withdrawTransfer(run.transfer_id);
      if (decision.kind === 'unknown') return decision;
      run = this.#run(id);
      if (run.status === 'ACTIVE') return { kind: 'cancel_requested', status: this.status(id) };
    }
    if (run.status === 'DEPARTED') {
      if (run.cancel_forwarded) return { kind: 'cancel_forwarded', status: this.status(id) };
      const transfer = this.#journal.transfer(run.transfer_id), offer = parse(transfer.offer), peer = this.#peers.get(offer.destination_host_id);
      try {
        requireThat(peer && hops > 1, 'ControlHopBudget');
        const remote = await peer.control(this.#registration(run), id, 'cancel', run.cancel_requested, hops - 1);
        requireThat(remote.run_id === id && remote.host_id === offer.destination_host_id && ['cancel_pending', 'unknown', 'cancel_requested', 'cancel_forwarded', 'terminal'].includes(remote.cancellation), 'ControlReplyMismatch');
        if (['cancel_pending', 'unknown'].includes(remote.cancellation)) return { kind: 'cancel_pending', status: this.status(id) };
        this.#journal.cancellationForwarded(id, run.custody_epoch);
        return { kind: 'cancel_forwarded', status: this.status(id) };
      } catch (error) {
        // Custody is known departed even if cancellation delivery is uncertain.
        return { kind: 'cancel_pending', reason: error.code ?? 'TransportUnavailable', status: this.status(id) };
      }
    }
    return { kind: 'cancel_requested', status: this.status(id) };
  }
  admitTransferMetadata(peerId, envelope) {
    const offer = parse(envelope.offer);
    requireThat(offer.source_host_id === peerId && offer.destination_host_id === this.hostId, 'PeerDenied');
    const receipt = this.#journal.savedDecision(envelope.offer); if (receipt !== null) return { offer, receipt };
    const registration = this.#journal.registration(envelope.registration), entry = this.#policy.deployment(registration);
    requireThat(entry.hosts.includes(peerId) && offer.run_id === registration.run_id && offer.run_registration_digest === hash(envelope.registration), 'PeerDenied');
    for (const key of ['image_digest', 'program_id', 'trusted_runtime_profile']) requireThat(offer[key] === registration[key], 'RegistrationMismatch');
    const runView = { ...registration, classification: offer.classification, deployment_limits: offer.deployment_limits };
    this.#policy.authorizeRun(runView); this.#policy.checkCleanup(runView, offer.cleanup_requirements);
    for (const kind of ['image', 'outcome']) requireThat(offer.artifact_lengths[kind] <= Math.min(offer.deployment_limits[`maximum_${kind}_bytes`], entry.limits?.[`maximum_${kind}_bytes`] ?? Infinity), 'ArtifactCapacity');
    const requirements = decodeValue(schemas.requirements, envelope.requirements), constraints = decodeValue(schemas.constraints, envelope.constraints);
    requireThat(hash(canonicalRequirements(requirements)) === offer.requirements_digest, 'RelocationMismatch');
    const observation = this.#policy.preflight(registration, requirements, constraints, offer.classification);
    requireThat(same(observation, envelope.observation) && hash(encodeValue(schemas.observation, observationValue(observation))) === offer.destination_observation_digest, 'ObservationMismatch');
    return { offer, receipt: null };
  }
  stageArtifact(peerId, envelope, kind, bytes) {
    const admitted = this.admitTransferMetadata(peerId, envelope);
    if (admitted.receipt !== null) return { receipt: admitted.receipt };
    return this.#journal.stage(envelope, kind, bytes);
  }
  async decideStaged(peerId, offerBytes) {
    const receipt = this.queryTransfer(peerId, offerBytes); if (receipt !== null) return receipt;
    return this.receiveOffer(peerId, this.#journal.staged(offerBytes));
  }
  async withdrawTransfer(transferId) {
    const transfer = this.#journal.transfer(transferId); requireThat(transfer !== null, 'UnknownTransfer');
    const offer = parse(transfer.offer), peer = this.#peers.get(offer.destination_host_id), run = this.#run(offer.run_id);
    requireThat(peer, 'DestinationDenied');
    try {
      const receipt = await peer.withdraw({ offer: transfer.offer, registration: this.#registration(run) });
      this.#journal.receiveDecision(transfer.offer, receipt);
      return { kind: parse(receipt).decision, status: this.status(offer.run_id) };
    } catch (error) { return { kind: 'unknown', reason: error.code ?? 'TransportUnavailable', status: this.status(offer.run_id) }; }
  }
  withdraw(peerId, envelope) {
    const offer = parse(envelope.offer); requireThat(offer.source_host_id === peerId && offer.destination_host_id === this.hostId, 'PeerDenied');
    return this.#journal.refuse(envelope.offer, envelope.registration, 'withdrawn');
  }
  async receiveOffer(peerId, envelope) {
    const offerBytes = Uint8Array.from(envelope.offer), offer = parse(offerBytes);
    requireThat(offer.source_host_id === peerId && offer.destination_host_id === this.hostId, 'PeerDenied');
    const saved = this.#journal.savedDecision(offerBytes); if (saved !== null) return saved;
    const registration = this.#journal.registration(envelope.registration);
    requireThat(this.#policy.deployment(registration).hosts.includes(peerId), 'PeerDenied');
    try {
      const runView = { ...registration, classification: offer.classification, deployment_limits: offer.deployment_limits };
      this.#policy.authorizeRun(runView); this.#policy.checkCleanup(runView, offer.cleanup_requirements);
      const admitted = await this.#admission.parked(envelope.image, envelope.outcome), data = this.#admission.read(admitted);
      requireThat(data.relocation !== null, 'RelocationMismatch');
      const constraints = [[], { tag: 1, value: this.hostId }, { tag: 0, value: null }, BigInt(offer.deployment_limits.maximum_outcome_bytes)];
      const observation = this.#policy.preflight(registration, data.relocation.requirements, constraints, offer.classification);
      requireThat(same(observation, envelope.observation), 'ObservationMismatch');
      const existing = this.#journal.run(offer.run_id);
      if (existing?.status === 'OFFERED' && envelope.predecessor !== null) {
        const prior = this.#journal.transfer(existing.transfer_id);
        this.#journal.receiveDecision(prior.offer, envelope.predecessor);
      }
      const policy = this.#policyValues(runView);
      return this.#journal.accept(offerBytes, envelope.registration, admitted, { ...policy, observation, predecessorBytes: envelope.predecessor });
    } catch (error) {
      return this.#journal.refuse(offerBytes, envelope.registration, reasonName(error.code));
    }
  }
  requestCancel(id, reasonText) { this.#policy.authorizeRun(this.#run(id), { cleanup: true }); return this.#journal.requestCancel(id, reasonText); }
  recover() {
    for (const { run, occurrence } of this.#journal.recover()) if (run.status === 'ACTIVE' && occurrence?.status === 'DISPATCHING') this.#journal.markUnknown(run.run_id, occurrence.attempt_id);
    return this.#journal.recover().map(({ run }) => this.status(run.run_id));
  }
}
