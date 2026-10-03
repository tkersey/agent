// World alone computes successors. Local tokens bind immutable bytes to their
// predecessor/control; no browser report or JSON description can mint one.
import { hash } from './protocol.mjs';
import { requireThat, digest } from './canonical.mjs';
import { decodeMobilityRequest, schemas } from './values.mjs';
import { encodeValue } from '../values.mjs';
const equal = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);
export class WorldAdmission {
  #world; #bytes; #expected; #limit; #tokens = new WeakMap();
  constructor(world, { kernelBytes, expectedSha256, maximumArtifactBytes = 8 << 20, maximumWorkingBytes = 64 << 20, maximumInputBytes = maximumArtifactBytes, maximumOutputBytes = maximumArtifactBytes }) {
    requireThat(hash(kernelBytes) === expectedSha256, 'RuntimeMismatch');
    this.#world = world; this.#bytes = Uint8Array.from(kernelBytes); this.#expected = expectedSha256;
    this.#limit = { artifact: maximumArtifactBytes, working: maximumWorkingBytes, input: maximumInputBytes, output: maximumOutputBytes };
  }
  get runtimeProfile() { return this.#expected; }
  #bounded(bytes) { requireThat(bytes instanceof Uint8Array && bytes.length <= this.#limit.artifact, 'ArtifactCapacity'); return Uint8Array.from(bytes); }
  async #kernel(image) {
    const kernel = await this.#world.Kernel.create({ bytes: this.#bytes, expectedSha256: this.#expected });
    kernel.setLimits({ input: this.#limit.input, working: this.#limit.working, output: this.#limit.output });
    return { kernel, prepared: kernel.prepare(image) };
  }
  async #seal(image, imageDigest, outcome, programId, predecessor = null) {
    const decoded = this.#world.decodeOutcome(outcome);
    requireThat(['requested', 'progressed', 'yielded', 'completed', 'failed', 'cancelled'].includes(decoded.kind), 'NonAuthoritativeOutcome');
    let request = null, relocation = null;
    if (decoded.kind === 'requested') {
      requireThat(decoded.state !== null, 'MissingCheckpoint');
      request = await this.#world.decodeRequest(decoded.request);
      const actualProgram = Buffer.from(request.programIdentity).toString('hex');
      requireThat(programId === null || programId === actualProgram, 'ProgramMismatch'); programId = actualProgram;
      if (request.semanticIdentity === 'agent.mobility.relocate.v1') {
        const { value } = decodeMobilityRequest(request);
        relocation = { destination_host_id: value[0], placement_intent_id: value[2], export_policy_ref: value[3], remaining_move_budget: value[4], requirements: value[1], requirements_digest: hash(canonicalRequirements(value[1])) };
      }
    }
    digest(programId);
    if (['progressed', 'yielded'].includes(decoded.kind)) requireThat(decoded.state !== null, 'MissingCheckpoint');
    const metadata = { kind: decoded.kind, image_digest: imageDigest, outcome_digest: hash(outcome), state_digest: decoded.state ? hash(decoded.state) : null,
      request_digest: request ? hash(decoded.request) : null, program_id: programId, operation: request?.semanticIdentity ?? null, trusted_runtime_profile: this.#expected };
    const token = Object.freeze({}); this.#tokens.set(token, { image, outcome, metadata, relocation, predecessor }); return token;
  }
  /** Transfer admission accepts only the actual parked request. */
  async parked(imageInput, outcomeInput) {
    requireThat(imageInput instanceof Uint8Array && outcomeInput instanceof Uint8Array && imageInput.length <= this.#limit.artifact && outcomeInput.length <= this.#limit.artifact, 'ArtifactCapacity');
    const decoded = this.#world.decodeOutcome(outcomeInput);
    requireThat(decoded.kind === 'requested' && decoded.state !== null, 'NotParkedRequest');
    return this.stored(imageInput, outcomeInput, null);
  }
  /** Restore a previously committed local outcome. Incoming peers must use
   * parked(), not this trusted-store recovery entry point. */
  async stored(imageInput, outcomeInput, programId) {
    const image = this.#bounded(imageInput), outcome = this.#bounded(outcomeInput), decoded = this.#world.decodeOutcome(outcome);
    requireThat(decoded.state !== null && ['requested', 'progressed', 'yielded'].includes(decoded.kind), 'NotRestorableOutcome');
    const { kernel, prepared } = await this.#kernel(image);
    let session;
    try {
      session = kernel.restore(prepared, decoded.state);
      requireThat(equal(kernel.checkpoint(session), decoded.state), 'NonCanonicalState');
      if (decoded.kind === 'requested') requireThat(equal(kernel.drive(session, { checkpoint: true }), outcome), 'NonCanonicalParkedOutcome');
    } finally {
      if (session) kernel.checkpoint(session, { transfer: true }); kernel.releasePrepared(prepared);
    }
    return this.#seal(image, hash(image), outcome, programId);
  }
  async start(imageInput, initialArgs, programId) {
    const image = this.#bounded(imageInput), args = this.#bounded(initialArgs); digest(programId);
    const { kernel, prepared } = await this.#kernel(image);
    let session;
    try {
      session = kernel.start(prepared, args);
      const token = await this.#seal(image, hash(image), kernel.drive(session, { quantum: 10000n, checkpoint: true }), programId);
      return this.#executor(kernel, prepared, session, token);
    } catch (error) {
      if (session) { try { kernel.checkpoint(session, { transfer: true }); } catch {} }
      try { kernel.releasePrepared(prepared); } catch {}
      throw error;
    }
  }
  async resume(token) {
    const data = this.#entry(token), decoded = this.#world.decodeOutcome(data.outcome);
    requireThat(decoded.state !== null, 'NotRestorableOutcome');
    const { kernel, prepared } = await this.#kernel(data.image);
    try { return this.#executor(kernel, prepared, kernel.restore(prepared, decoded.state), token); }
    catch (error) { kernel.releasePrepared(prepared); throw error; }
  }
  #executor(kernelInput, prepared, session, initial) {
    const owner = this; let kernel = kernelInput, token = initial, retired = false, busy = false;
    return Object.freeze({
      current: () => { requireThat(!retired, 'ExecutorRetired'); return token; },
      async drive(command = { kind: 'none' }) {
        requireThat(!retired && !busy, 'ExecutorUnavailable'); busy = true;
        try {
          const prior = owner.#entry(token), decoded = owner.#world.decodeOutcome(prior.outcome);
          let control, value, binding;
          if (command.kind === 'reply') {
            requireThat(decoded.kind === 'requested', 'InvalidControl');
            const reply = owner.#bounded(command.value);
            value = await owner.#world.encodeResult(decoded.request, reply); control = 'reply'; binding = { kind: 'reply', reply_digest: hash(reply) };
          } else if (command.kind === 'cancel') {
            requireThat(typeof command.reason === 'string' && Buffer.byteLength(command.reason) <= 256, 'InvalidCancellation');
            control = 'cancel_text'; value = command.reason; binding = { kind: 'cancel', reason: command.reason };
          } else {
            requireThat(['none', 'resume_yield'].includes(command.kind), 'InvalidControl');
            control = command.kind; value = new Uint8Array(); binding = { kind: command.kind };
          }
          const output = kernel.drive(session, { control, value, quantum: 10000n, checkpoint: true });
          token = await owner.#seal(prior.image, prior.metadata.image_digest, output, prior.metadata.program_id, { outcome_digest: prior.metadata.outcome_digest, control: binding });
          return token;
        } finally { busy = false; }
      },
      usage: () => { requireThat(!retired, 'ExecutorRetired'); return kernel.usage(); },
      retire() {
        requireThat(!retired && !busy, 'ExecutorUnavailable'); retired = true;
        const usage = kernel.usage();
        try {
          const kind = owner.#entry(token).metadata.kind;
          if (['completed', 'failed', 'cancelled'].includes(kind)) kernel.close(session);
          else kernel.checkpoint(session, { transfer: true });
          kernel.releasePrepared(prepared); return usage;
        } finally { kernel = null; }
      },
    });
  }
  /** Optional integrity check for an untrusted successor report, using the same
   * public World runtime. It never performs the reported external operation. */
  async successor(previous, command, reported = null) {
    const executor = await this.resume(previous);
    try {
      const token = await executor.drive(command);
      if (reported !== null) requireThat(equal(this.#entry(token).outcome, reported), 'SuccessorMismatch');
      return token;
    } finally { executor.retire(); }
  }
  #entry(token) { const value = this.#tokens.get(token); requireThat(value !== undefined, 'UnadmittedWorldState'); return value; }
  read(token) { return structuredClone(this.#entry(token)); }
}
export function canonicalRequirements(requirements) {
  const root = schemas.requirements.types[schemas.requirements.root].vector.element;
  const itemSchema = { types: schemas.requirements.types, root };
  const rows = requirements.map(value => ({ value, bytes: encodeValue(itemSchema, value) }));
  rows.sort((a, b) => Buffer.compare(a.bytes, b.bytes));
  for (let i = 1; i < rows.length; i++) requireThat(!equal(rows[i - 1].bytes, rows[i].bytes), 'DuplicateRequirement');
  return encodeValue(schemas.requirements, rows.map(row => row.value));
}
