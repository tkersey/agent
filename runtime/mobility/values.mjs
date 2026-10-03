// Browser-neutral v1 application contracts, using the existing Boundary codec.
import { encodeSchema, encodeValue, decodeSchema, decodeValue } from '../values.mjs';
import { requireThat, identifier, digest } from './canonical.mjs';
const types = [], add = shape => { types.push(shape); return types.length - 1; };
const unit = add('unit'), id = add({ bounded_text: 128 }), operation = add({ bounded_text: 256 });
const byte = add('u8'), hash = add({ array: { element: byte, length: 32 } });
const counter = add('u64'), budget = add('u32');
const optional = child => add({ sum: [unit, child] });
const optionalHash = optional(hash), optionalId = optional(id), optionalCounter = optional(counter);
const product = fields => add({ product: fields }), vector = (element, maximum) => add({ vector: { element, maximum } });
const requirementsRoot = vector(product([operation, hash, hash, id, id, optionalHash, id, optionalId, optionalId]), 16);
const constraints = product([vector(id, 16), optionalId, optionalId, counter]);
const observationRoot = product([id, hash, hash, id, hash]);
const candidate = product([observationRoot, id, optionalCounter, optionalCounter, optionalCounter, id]);
const reason = add({ sum: Array(16).fill(unit) });
const resolveRoot = product([requirementsRoot, constraints]);
const resolutionRoot = add({ sum: [observationRoot, vector(candidate, 32), reason] });
const relocateRoot = product([id, requirementsRoot, id, id, budget]);
const arrival = product([id, counter, id, hash, observationRoot]);
const evidence = add({ sum: [reason, hash] });
const refusal = product([reason, id, evidence]);
const relocationReplyRoot = add({ sum: [arrival, refusal] });
export const schemas = Object.freeze({
  requirements: { types, root: requirementsRoot }, observation: { types, root: observationRoot },
  constraints: { types, root: constraints },
  resolve: { types, root: resolveRoot }, resolution: { types, root: resolutionRoot },
  relocate: { types, root: relocateRoot }, relocationReply: { types, root: relocationReplyRoot },
});
const same = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
export const digestBytes = value => { digest(value); return value.match(/../g).map(pair => Number.parseInt(pair, 16)); };
export function observationValue(value) {
  return [identifier(value.host_id), digestBytes(value.requirements_digest), digestBytes(value.binding_digest), identifier(value.policy_revision), digestBytes(value.runtime_profile)];
}
export function encodeArrival(offer, receiptDigest, observation) {
  requireThat(observation.host_id === offer.destination_host_id, 'ObservationMismatch');
  return encodeValue(schemas.relocationReply, { tag: 0, value: [offer.destination_host_id, offer.destination_epoch, offer.transfer_id, digestBytes(receiptDigest), observationValue(observation)] });
}
const reasons = ['unavailable', 'policy_denied', 'export_denied', 'binding_mismatch', 'runtime_mismatch', 'capacity', 'unsettled_occurrence', 'pinned_resource', 'cleanup_unsupported', 'budget_exhausted', 'withdrawn', 'expired_offer', 'already_here', 'invalid_state', 'busy', 'unsupported'];
export function encodeRefusal(destination, reasonCode, receiptDigest = null) {
  const tag = reasons.indexOf(reasonCode); requireThat(tag >= 0, 'InvalidReason'); identifier(destination);
  const reason = { tag, value: null };
  return encodeValue(schemas.relocationReply, { tag: 1, value: [reason, destination, receiptDigest === null ? { tag: 0, value: reason } : { tag: 1, value: digestBytes(receiptDigest) }] });
}
export function decodeMobilityRequest(request) {
  const kind = request.semanticIdentity === 'agent.mobility.resolve.v1' ? 'resolve' : request.semanticIdentity === 'agent.mobility.relocate.v1' ? 'relocate' : null;
  requireThat(kind !== null, 'NotMobility');
  requireThat(same(request.payloadSchema, encodeSchema(schemas[kind])) && same(request.resumeSchema, encodeSchema(schemas[kind === 'resolve' ? 'resolution' : 'relocationReply'])), 'MobilitySchemaMismatch');
  const value = decodeValue(decodeSchema(request.payloadSchema), request.payload);
  return { kind, value };
}
