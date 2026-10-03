// Pure environmental transitions. World checkpoints remain opaque artifacts;
// this state contains no application phases, tool sequence or continuation.
import { canonical, requireThat, counter, increment, labels, digest } from './canonical.mjs';
import { hash, matchesDecision } from './protocol.mjs';
export const RELOCATE = 'agent.mobility.relocate.v1';
const same = (a, b) => hash(canonical(a)) === hash(canonical(b));
const join = (a, b) => { labels(a); labels(b); return [...new Set([...a, ...b])].sort(); };
export function version(run) {
  return { run_id: run.run_id, custody_epoch: run.custody_epoch, execution_revision: run.execution_revision,
    executor_incarnation: run.executor_incarnation, outcome_digest: run.outcome_digest };
}
export function expected(run, wanted) {
  requireThat(run !== null && wanted !== null && same(version(run), wanted), 'StaleExecutor');
}
export function active(run, wanted, executor = true) {
  expected(run, wanted); requireThat(run.status === 'ACTIVE', 'CustodyFrozen');
  if (executor) requireThat(run.attached, 'ExecutorNotAttached');
}
export function current(run, occurrence) {
  requireThat(occurrence !== null && run.current_occurrence_id === occurrence.id && occurrence.run_id === run.run_id && occurrence.request_digest === run.request_digest, 'OccurrenceMismatch');
}
export function initial(registration, registrationDigest, host, outcome, occurrenceId) {
  requireThat(registration.initial_host_id === host && registration.initial_epoch === '0', 'WrongInitialHost');
  const run = { run_id: registration.run_id, host_id: host, status: 'ACTIVE', custody_epoch: '0', execution_revision: '0', executor_incarnation: '0', attached: false,
    principal_ref: registration.principal_ref, tenant_ref: registration.tenant_ref, image_digest: registration.image_digest, program_id: registration.program_id,
    trusted_runtime_profile: registration.trusted_runtime_profile, registration_digest: registrationDigest, predecessor_receipt_digest: registrationDigest,
    classification: [...registration.initial_classification], deployment_limits: { ...registration.deployment_limits }, policy_revision: registration.deployment_policy_revision,
    cleanup_requirements: [], resource_pins: [], transfer_id: null, cancel_requested: null, cancel_applied: false, reply_digest: null, local_move_attempts: '0' };
  return installOutcome(run, outcome, occurrenceId);
}
function installOutcome(run, outcome, occurrenceId) {
  requireThat(['requested', 'progressed', 'yielded', 'completed', 'failed', 'cancelled'].includes(outcome.kind), 'InvalidOutcome');
  digest(outcome.outcome_digest);
  const requested = outcome.kind === 'requested';
  if (requested) { digest(outcome.request_digest); digest(outcome.state_digest); digest(occurrenceId); }
  const terminal = ['completed', 'failed', 'cancelled'].includes(outcome.kind);
  const next = { ...run, status: terminal ? 'TERMINAL' : 'ACTIVE', attached: terminal ? false : run.attached, outcome_kind: outcome.kind, outcome_digest: outcome.outcome_digest,
    state_digest: outcome.state_digest ?? null, request_digest: requested ? outcome.request_digest : null,
    current_occurrence_id: requested ? occurrenceId : null, reply_digest: null };
  return { run: next, occurrence: requested ? { id: occurrenceId, run_id: run.run_id, request_digest: outcome.request_digest,
    operation: outcome.operation, status: 'READY', attempt_id: null, reply_digest: null, reconciliation_ref: null } : null };
}
export function attach(run) {
  requireThat(run.status === 'ACTIVE', 'CustodyFrozen');
  return { ...run, executor_incarnation: increment(run.executor_incarnation), attached: true };
}
export function freeze(run, occurrence, wanted, offer, offerDigest) {
  active(run, wanted, false); current(run, occurrence);
  requireThat(run.cancel_requested === null, 'CancellationPending');
  requireThat(occurrence.status === 'READY' && occurrence.operation === RELOCATE && run.outcome_kind === 'requested' && run.reply_digest === null, 'UnsettledOccurrence');
  requireThat(run.resource_pins.length === 0, 'PinnedResource');
  for (const [field, source] of Object.entries({ run_id: 'run_id', source_host_id: 'host_id', source_epoch: 'custody_epoch', execution_revision: 'execution_revision',
    outcome_digest: 'outcome_digest', state_digest: 'state_digest', request_digest: 'request_digest', relocation_occurrence_id: 'current_occurrence_id',
    image_digest: 'image_digest', program_id: 'program_id', trusted_runtime_profile: 'trusted_runtime_profile', run_registration_digest: 'registration_digest', predecessor_receipt_digest: 'predecessor_receipt_digest' }))
    requireThat(offer[field] === run[source], 'OfferMismatch');
  requireThat(offer.destination_epoch === increment(run.custody_epoch) && offer.destination_host_id !== run.host_id, 'InvalidEpoch');
  requireThat(counter(offer.destination_epoch) <= BigInt(run.deployment_limits.maximum_moves), 'MoveBudget');
  for (const [field, value] of Object.entries({ classification: run.classification, deployment_limits: run.deployment_limits, cleanup_requirements: run.cleanup_requirements, resource_pin_summary: run.resource_pins }))
    requireThat(same(offer[field], value), 'OfferMismatch');
  return { ...run, status: 'OFFERED', transfer_id: offer.transfer_id, offer_digest: offerDigest, attached: false, local_move_attempts: increment(run.local_move_attempts) };
}
export function acceptedCore(offer, policyRevision, classification, deploymentLimits) {
  labels(classification);
  requireThat(offer.classification.every(label => classification.includes(label)), 'ClassificationDowngrade');
  for (const key of Object.keys(offer.deployment_limits)) requireThat(deploymentLimits[key] <= offer.deployment_limits[key], 'LimitsWidened');
  return { format: 'agent-mobility-accepted-core/v1', run_id: offer.run_id, transfer_id: offer.transfer_id,
    offer_digest: hash(canonical(offer)), custody_epoch: offer.destination_epoch, execution_revision: offer.execution_revision,
    image_digest: offer.image_digest, outcome_digest: offer.outcome_digest, request_digest: offer.request_digest,
    registration_digest: offer.run_registration_digest, policy_revision: policyRevision, classification, deployment_limits: deploymentLimits };
}
export function accept(existing, registration, offer, core, receiptDigest, arrivalDigest) {
  if (existing !== null) {
    requireThat(existing.status === 'DEPARTED', existing.status === 'TERMINAL' ? 'RetiredRun' : 'LocalCustodyConflict');
    requireThat(counter(offer.destination_epoch) > counter(existing.custody_epoch), 'StaleEpoch');
    requireThat(existing.registration_digest === offer.run_registration_digest, 'RegistrationMismatch');
  }
  requireThat(core.offer_digest === hash(canonical(offer)) && core.run_id === offer.run_id && core.transfer_id === offer.transfer_id && core.custody_epoch === offer.destination_epoch, 'AcceptedCoreMismatch');
  requireThat(counter(offer.destination_epoch) <= BigInt(core.deployment_limits.maximum_moves), 'MoveBudget');
  const run = { run_id: offer.run_id, host_id: offer.destination_host_id, status: 'ACTIVE', custody_epoch: offer.destination_epoch,
    execution_revision: offer.execution_revision, executor_incarnation: existing === null ? '0' : increment(existing.executor_incarnation), attached: false,
    principal_ref: registration.principal_ref, tenant_ref: registration.tenant_ref, image_digest: offer.image_digest, program_id: offer.program_id,
    trusted_runtime_profile: offer.trusted_runtime_profile, registration_digest: offer.run_registration_digest, predecessor_receipt_digest: receiptDigest,
    classification: [...core.classification], deployment_limits: { ...core.deployment_limits }, policy_revision: core.policy_revision,
    cleanup_requirements: [...offer.cleanup_requirements], resource_pins: [], transfer_id: null, cancel_requested: null, cancel_applied: false, local_move_attempts: existing?.local_move_attempts ?? '0',
    outcome_kind: 'requested', outcome_digest: offer.outcome_digest, state_digest: offer.state_digest, request_digest: offer.request_digest,
    current_occurrence_id: offer.relocation_occurrence_id, reply_digest: arrivalDigest };
  return { run, occurrence: { id: offer.relocation_occurrence_id, run_id: offer.run_id, request_digest: offer.request_digest,
    operation: RELOCATE, status: 'SETTLED_REPLY', attempt_id: null, reply_digest: arrivalDigest, reconciliation_ref: receiptDigest } };
}
export function decideSource(run, occurrence, offer, decision, decisionDigest, refusalDigest = null) {
  requireThat(run.status === 'OFFERED' && run.transfer_id === offer.transfer_id, 'TransferMismatch'); current(run, occurrence);
  matchesDecision(offer, decision, run.offer_digest);
  if (decision.decision === 'accepted') return { run: { ...run, status: 'DEPARTED', attached: false, departure_receipt_digest: decisionDigest }, occurrence };
  digest(refusalDigest);
  return { run: { ...run, status: 'ACTIVE', attached: false, executor_incarnation: increment(run.executor_incarnation), transfer_id: null, reply_digest: refusalDigest },
    occurrence: { ...occurrence, status: 'SETTLED_REPLY', reply_digest: refusalDigest, reconciliation_ref: decisionDigest } };
}
export function dispatch(run, occurrence, wanted, attemptId, classification, { cleanup = false } = {}) {
  active(run, wanted); current(run, occurrence);
  requireThat(occurrence.status === 'READY' && occurrence.operation !== RELOCATE, 'UnsettledOccurrence');
  requireThat(run.cancel_requested === null || cleanup, 'CancellationPending');
  digest(attemptId);
  return { run: { ...run, classification: join(run.classification, classification) }, occurrence: { ...occurrence, status: 'DISPATCHING', attempt_id: attemptId } };
}
export function unknown(run, occurrence, attemptId) {
  requireThat(run.status === 'ACTIVE', 'CustodyFrozen'); current(run, occurrence);
  requireThat(['DISPATCHING', 'UNKNOWN'].includes(occurrence.status) && occurrence.attempt_id === attemptId, 'AttemptMismatch');
  return { ...occurrence, status: 'UNKNOWN' };
}
export function acquired(run, occurrence, attemptId, replyDigest, classification, reconciliationRef = null) {
  requireThat(run.status === 'ACTIVE', 'CustodyFrozen'); current(run, occurrence); digest(replyDigest);
  requireThat(occurrence.attempt_id === attemptId, 'AttemptMismatch');
  if (occurrence.status === 'SETTLED_REPLY') { requireThat(occurrence.reply_digest === replyDigest, 'ReplyConflict'); return { run, occurrence }; }
  requireThat(['DISPATCHING', 'UNKNOWN'].includes(occurrence.status), 'UnsettledOccurrence');
  return { run: { ...run, classification: join(run.classification, classification), reply_digest: replyDigest },
    occurrence: { ...occurrence, status: 'SETTLED_REPLY', reply_digest: replyDigest, reconciliation_ref: reconciliationRef } };
}
export function publish(run, occurrence, wanted, control, outcome, nextOccurrenceId) {
  active(run, wanted);
  if (occurrence !== null) {
    current(run, occurrence);
    if (control.kind === 'reply') {
      requireThat(occurrence.status === 'SETTLED_REPLY' && control.reply_digest === occurrence.reply_digest, 'ReplyNotAcquired');
      requireThat(!(occurrence.operation === RELOCATE && run.cancel_requested !== null && !run.cancel_applied), 'CancellationPending');
    }
    else requireThat(control.kind === 'cancel' && control.reason === run.cancel_requested && run.cancel_requested !== null &&
      (occurrence.status === 'READY' || (occurrence.status === 'SETTLED_REPLY' && occurrence.operation === RELOCATE)), 'UnsettledOccurrence');
  } else requireThat(['none', 'resume_yield', 'cancel'].includes(control.kind) && (control.kind !== 'cancel' || (run.cancel_requested !== null && control.reason === run.cancel_requested)), 'InvalidControl');
  if (control.kind === 'cancel') requireThat(!run.cancel_applied, 'CancellationAlreadyApplied');
  if (outcome.kind === 'requested') requireThat(nextOccurrenceId !== run.current_occurrence_id, 'OccurrenceReuse');
  const result = installOutcome({ ...run, execution_revision: increment(run.execution_revision), cancel_applied: run.cancel_applied || control.kind === 'cancel' }, outcome, nextOccurrenceId);
  return { ...result, previous: occurrence === null ? null : { ...occurrence, status: 'ADMITTED' } };
}
export function cancel(run, reason) {
  requireThat(['ACTIVE', 'OFFERED'].includes(run.status), 'CustodyNotLocal');
  requireThat(typeof reason === 'string' && reason.length > 0 && Buffer.byteLength(reason) <= 256, 'InvalidCancellation');
  if (run.cancel_requested !== null) return run;
  return { ...run, cancel_requested: reason, attached: false, executor_incarnation: increment(run.executor_incarnation) };
}
export function pin(run, wanted, name, add) {
  active(run, wanted, false);
  const pins = new Set(run.resource_pins);
  if (add) pins.add(name); else requireThat(pins.delete(name), 'UnknownPin');
  const result = [...pins].sort(); labels(result, 16);
  return { ...run, resource_pins: result };
}
