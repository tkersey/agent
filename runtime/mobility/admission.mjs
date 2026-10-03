// Pure World admission before durable custody. Tokens are local, unforgeable
// references to copies of admitted bytes; they are never part of a checkpoint.
import { hash } from './protocol.mjs';
import { requireThat } from './canonical.mjs';
import { decodeMobilityRequest, schemas } from './values.mjs';
import { encodeValue } from '../values.mjs';
const equal = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);
export class WorldAdmission {
  #world; #bytes; #expected; #limit; #tokens = new WeakMap();
  constructor(world, { kernelBytes, expectedSha256, maximumArtifactBytes = 8 << 20, maximumWorkingBytes = 64 << 20 }) {
    requireThat(hash(kernelBytes) === expectedSha256, 'RuntimeMismatch');
    this.#world = world; this.#bytes = Uint8Array.from(kernelBytes); this.#expected = expectedSha256;
    this.#limit = { artifact: maximumArtifactBytes, working: maximumWorkingBytes };
  }
  get runtimeProfile() { return this.#expected; }
  async parked(imageInput, outcomeInput) {
    requireThat(imageInput instanceof Uint8Array && outcomeInput instanceof Uint8Array && imageInput.length <= this.#limit.artifact && outcomeInput.length <= this.#limit.artifact, 'ArtifactCapacity');
    const image = Uint8Array.from(imageInput), outcome = Uint8Array.from(outcomeInput);
    const decoded = this.#world.decodeOutcome(outcome);
    requireThat(decoded.kind === 'requested' && decoded.state !== null, 'NotParkedRequest');
    const request = await this.#world.decodeRequest(decoded.request);
    const kernel = await this.#world.Kernel.create({ bytes: this.#bytes, expectedSha256: this.#expected });
    kernel.setLimits({ input: this.#limit.artifact, working: this.#limit.working, output: this.#limit.artifact });
    const prepared = kernel.prepare(image);
    let session;
    try {
      session = kernel.restore(prepared, decoded.state);
      requireThat(equal(kernel.drive(session, { checkpoint: true }), outcome), 'NonCanonicalParkedOutcome');
    } finally {
      if (session) kernel.checkpoint(session, { transfer: true });
      kernel.releasePrepared(prepared);
    }
    let relocation = null;
    if (request.semanticIdentity === 'agent.mobility.relocate.v1') {
      const { value } = decodeMobilityRequest(request);
      relocation = { destination_host_id: value[0], placement_intent_id: value[2], export_policy_ref: value[3], remaining_move_budget: value[4], requirements: value[1], requirements_digest: hash(canonicalRequirements(value[1])) };
    }
    const metadata = { kind: decoded.kind, image_digest: hash(image), outcome_digest: hash(outcome), state_digest: hash(decoded.state), request_digest: hash(decoded.request),
      program_id: Buffer.from(request.programIdentity).toString('hex'), operation: request.semanticIdentity, trusted_runtime_profile: this.#expected };
    const token = Object.freeze({});
    this.#tokens.set(token, { image, outcome, metadata, relocation });
    return token;
  }
  read(token) {
    const admitted = this.#tokens.get(token); requireThat(admitted !== undefined, 'UnadmittedWorldState');
    return structuredClone(admitted);
  }
}
export function canonicalRequirements(requirements) {
  const root = schemas.requirements.types[schemas.requirements.root].vector.element;
  const itemSchema = { types: schemas.requirements.types, root };
  const rows = requirements.map(value => ({ value, bytes: encodeValue(itemSchema, value) }));
  rows.sort((a, b) => Buffer.compare(a.bytes, b.bytes));
  for (let i = 1; i < rows.length; i++) requireThat(!equal(rows[i - 1].bytes, rows[i].bytes), 'DuplicateRequirement');
  return encodeValue(schemas.requirements, rows.map(row => row.value));
}
