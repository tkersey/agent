// Node environmental signatures. No private key or grant enters World values.
import { createHash, randomBytes, sign, verify } from 'node:crypto';
import { canonical, parse, closed, requireThat, identifier, counter, increment, digest, integer, labels } from './canonical.mjs';
export { canonical, parse } from './canonical.mjs';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const opaqueId = () => randomBytes(32).toString('hex');
export const runId = issuer => `${identifier(issuer)}:${opaqueId()}`;
export const REASONS = Object.freeze(['unavailable', 'policy_denied', 'export_denied', 'binding_mismatch', 'runtime_mismatch', 'capacity', 'unsettled_occurrence', 'pinned_resource', 'cleanup_unsupported', 'budget_exhausted', 'withdrawn', 'expired_offer', 'already_here', 'invalid_state', 'busy', 'unsupported']);
const formats = { run: 'agent-mobility-run/v1', offer: 'agent-mobility-offer/v1', decision: 'agent-mobility-decision/v1' };
const runFields = 'format run_id issuer_id principal_ref tenant_ref image_digest program_id trusted_runtime_profile allowed_host_policy_ref deployment_policy_revision initial_classification initial_host_id initial_epoch deployment_limits key_id'.split(' ');
const offerFields = 'format run_id transfer_id source_host_id destination_host_id source_epoch destination_epoch execution_revision run_registration_digest predecessor_receipt_digest image_digest program_id outcome_digest state_digest request_digest relocation_occurrence_id placement_intent_id requirements_digest destination_observation_digest trusted_runtime_profile classification export_policy_revision deployment_limits cleanup_requirements resource_pin_summary artifact_lengths admission_deadline key_id'.split(' ');
const decisionFields = 'format run_id transfer_id offer_digest source_host_id destination_host_id source_epoch destination_epoch outcome_digest relocation_occurrence_id decision target_policy_revision key_id'.split(' ');
export function limits(value) {
  closed(value, ['maximum_moves', 'maximum_image_bytes', 'maximum_outcome_bytes']);
  integer(value.maximum_moves, 0xffffffff);
  integer(value.maximum_image_bytes, 256 << 20); integer(value.maximum_outcome_bytes, 256 << 20);
  requireThat(value.maximum_image_bytes > 0 && value.maximum_outcome_bytes > 0, 'InvalidLimits');
}
export function validate(kind, record, signed = true) {
  requireThat(Object.hasOwn(formats, kind), 'UnknownMessage');
  const carriedPublication = kind === 'offer' && record.format === 'agent-mobility-offer/v2';
  const fields = kind === 'run' ? runFields : kind === 'offer' ? [...offerFields, ...(carriedPublication ? ['publication_receipt'] : [])] : [...decisionFields,
    record.decision === 'accepted' ? 'accepted_record_digest' : 'reason_code'];
  closed(record, signed ? [...fields, 'signature'] : fields);
  requireThat(record.format === formats[kind] || carriedPublication, 'UnknownVersion');
  identifier(record.run_id, 256); requireThat(/^.+:[0-9a-f]{64}$/.test(record.run_id), 'InvalidRunId');
  identifier(record.key_id);
  if (signed) {
    requireThat(typeof record.signature === 'string' && /^[A-Za-z0-9_-]{86}$/.test(record.signature), 'InvalidSignature');
    requireThat(Buffer.from(record.signature, 'base64url').toString('base64url') === record.signature, 'InvalidSignature');
  }
  if (kind === 'run') {
    for (const name of ['issuer_id', 'principal_ref', 'tenant_ref', 'allowed_host_policy_ref', 'deployment_policy_revision', 'initial_host_id']) identifier(record[name]);
    requireThat(record.run_id === `${record.issuer_id}:${record.run_id.split(':').at(-1)}`, 'InvalidRunId');
    requireThat(record.initial_epoch === '0', 'InvalidEpoch');
    for (const name of ['image_digest', 'program_id', 'trusted_runtime_profile']) digest(record[name]);
    limits(record.deployment_limits); labels(record.initial_classification);
  } else {
    digest(record.transfer_id); digest(record.relocation_occurrence_id);
    for (const name of ['source_host_id', 'destination_host_id']) identifier(record[name]);
    requireThat(record.source_host_id !== record.destination_host_id, 'SameHost');
    counter(record.source_epoch); counter(record.destination_epoch);
    requireThat(record.destination_epoch === increment(record.source_epoch), 'InvalidEpoch');
    digest(record.outcome_digest);
    if (kind === 'offer') {
      counter(record.execution_revision);
      if (carriedPublication) {
        const receipt = record.publication_receipt;
        canonical(receipt, 16 << 10);
        requireThat(receipt?.format === 'agent.repository.publication-receipt/v1' && receipt.status === 'Published' &&
          receipt.admission?.run_id === record.run_id && receipt.admission.registration_digest === record.run_registration_digest,
          'PublicationReceiptMismatch');
        digest(receipt.proposal); digest(receipt.admission.intent_digest);
        requireThat(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(receipt.commit) &&
          /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(receipt.tree), 'PublicationReceiptMismatch');
        const observed = receipt.admission.source_version;
        requireThat(observed?.run_id === record.run_id && counter(observed.custody_epoch) <= counter(record.source_epoch) &&
          (observed.custody_epoch !== record.source_epoch || counter(observed.execution_revision) <= counter(record.execution_revision)),
          'PublicationReceiptMismatch');
      }
      for (const name of ['run_registration_digest', 'predecessor_receipt_digest', 'image_digest', 'program_id', 'state_digest', 'request_digest', 'requirements_digest', 'destination_observation_digest', 'trusted_runtime_profile']) digest(record[name]);
      identifier(record.placement_intent_id); identifier(record.export_policy_revision);
      labels(record.classification); labels(record.resource_pin_summary, 16);
      requireThat(Array.isArray(record.cleanup_requirements) && record.cleanup_requirements.length <= 16, 'InvalidCleanup');
      let previous = null;
      for (const requirement of record.cleanup_requirements) { digest(requirement); requireThat(previous === null || previous < requirement, 'InvalidCleanup'); previous = requirement; }
      limits(record.deployment_limits);
      closed(record.artifact_lengths, ['image', 'outcome']);
      integer(record.artifact_lengths.image, record.deployment_limits.maximum_image_bytes);
      integer(record.artifact_lengths.outcome, record.deployment_limits.maximum_outcome_bytes);
      if (record.admission_deadline !== null) counter(record.admission_deadline);
    } else {
      digest(record.offer_digest); identifier(record.target_policy_revision);
      requireThat(['accepted', 'refused'].includes(record.decision), 'InvalidDecision');
      if (record.decision === 'accepted') digest(record.accepted_record_digest);
      else requireThat(REASONS.includes(record.reason_code), 'InvalidReason');
    }
  }
  return record;
}
function payload(kind, record) {
  const { signature: _, ...unsigned } = record;
  return Buffer.concat([Buffer.from(`agent-mobility/v1/${kind}\0`, 'ascii'), canonical(unsigned)]);
}
export function signRecord(kind, unsigned, privateKey) {
  validate(kind, unsigned, false);
  requireThat(privateKey.asymmetricKeyType === 'ed25519', 'InvalidSigningKey');
  const signature = sign(null, payload(kind, unsigned), privateKey).toString('base64url');
  return canonical({ ...unsigned, signature });
}
/** Retired keys verify only exact historically authorized bytes. The journal
 * supplies a saved digest, or first matches a terminal receipt to an outstanding
 * offer and its frozen key binding. A peer cannot supply this authorization. */
export function verifyRecord(kind, bytes, keys, { historicalDigest = null } = {}) {
  const record = validate(kind, parse(bytes));
  const binding = keys.get(record.key_id);
  requireThat(binding && binding.publicKey.asymmetricKeyType === 'ed25519', 'UntrustedKey');
  requireThat(binding.status === 'active' || (binding.status === 'retired' && historicalDigest !== null && hash(bytes) === historicalDigest), 'RetiredKey');
  const owner = kind === 'run' ? record.issuer_id : kind === 'offer' ? record.source_host_id : record.destination_host_id;
  requireThat(binding.owner === owner, 'KeyOwnerMismatch');
  requireThat(verify(null, payload(kind, record), binding.publicKey, Buffer.from(record.signature, 'base64url')), 'InvalidSignature');
  return record;
}
export function matchesDecision(offer, decision, offerDigest) {
  requireThat(decision.offer_digest === offerDigest, 'DecisionMismatch');
  for (const key of ['run_id', 'transfer_id', 'source_host_id', 'destination_host_id', 'source_epoch', 'destination_epoch', 'outcome_digest', 'relocation_occurrence_id'])
    requireThat(decision[key] === offer[key], 'DecisionMismatch');
}
