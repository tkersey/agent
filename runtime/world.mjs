import { createHash, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { DEFAULT_LOCK, readDependencyLock, readRegular, verifyRuntime } from "../tools/agent4/dependencies.mjs";
import { decodeSchema, decodeValue, ValueCodecError } from "./values.mjs";

const exchangePrefix = "agent.interaction.exchange.v1.";
const classifications = new Map([
  ["message", "awaiting_message"],
  ["clarification", "awaiting_clarification"],
  ["approval", "awaiting_approval"],
]);

function bytes(value, name) {
  if (!(value instanceof Uint8Array)) throw new TypeError(`${name} must be canonical bytes`);
  return Uint8Array.from(value);
}

/**
 * Authenticate the supplied World installation against Agent's input
 * lock before importing its public module. No authoring source is loaded.
 */
export async function loadWorldRuntime(options) {
  if (!options || typeof options !== "object" || Array.isArray(options))
    throw new TypeError("runtime options are required");
  for (const name of Object.keys(options))
    if (!["runtimePath", "lockPath"].includes(name)) throw new Error(`UnknownRuntimeOption: ${name}`);
  const { runtimePath, lockPath = DEFAULT_LOCK } = options;
  if (typeof runtimePath !== "string" || runtimePath.length === 0)
    throw new TypeError("runtimePath must name an immutable World installation");
  const observed = verifyRuntime(runtimePath, { lockPath });
  const lock = readDependencyLock(lockPath);
  const world = await import(pathToFileURL(observed.entrypoint).href);
  if (world.packageVersion !== lock.world.version)
    throw new Error("WorldPackageVersionMismatch");
  if (JSON.stringify(Object.keys(world).sort()) !== JSON.stringify(lock.world.runtime.exports))
    throw new Error("WorldPublicApiMismatch");
  const kernelBytes = readRegular(observed.kernelPath);
  if (JSON.stringify(world.inspectKernelWasm(kernelBytes)) !== JSON.stringify(lock.world.runtime.physicalProfile.inspection))
    throw new Error("WorldPhysicalProfileMismatch");
  const kernel = await world.Kernel.create({ bytes: kernelBytes, expectedSha256: observed.kernelSha256 });
  // Detect accidental concurrent replacement during admission as well as before it.
  verifyRuntime(runtimePath, { lockPath });

  const decodeOutcome = (input) => {
    const canonical = bytes(input, "outcome");
    return Object.freeze({ ...world.decodeOutcome(canonical), bytes: canonical });
  };
  const invoke = (input) => decodeOutcome(kernel.invoke(world.encodeInput(input)));
  const start = (image, initialArgs) => invoke({
    image: bytes(image, "image"), initialArgs: bytes(initialArgs, "initialArgs"),
  });
  const resume = async (image, state, currentRequest, canonicalReply) => {
    const program = bytes(image, "image");
    const saved = bytes(state, "state");
    const requestBytes = bytes(currentRequest, "request");
    const reply = bytes(canonicalReply, "reply");
    const request = await world.decodeRequest(requestBytes);
    const digest = createHash("sha256").update("boundary.pending-state/v3\0").update(saved).digest();
    if (!timingSafeEqual(digest, request.pendingStateDigest))
      throw new Error("RequestStateMismatch");
    // ERS3 construction and typed validation belong to World. The kernel then
    // admits the complete image/State/request binding before any transition.
    const result = await world.encodeResult(requestBytes, reply);
    return invoke({ image: program, state: saved, control: "reply", value: result });
  };
  const cancel = (image, state, reason) => {
    if (typeof reason !== "string" && !(reason instanceof Uint8Array))
      throw new TypeError("cancellation reason must be text or bytes");
    return invoke({ image: bytes(image, "image"), state: bytes(state, "state"),
      control: typeof reason === "string" ? "cancel_text" : "cancel_bytes", value: typeof reason === "string" ? reason : bytes(reason, "reason") });
  };
  const continueExecution = (image, outcome) => {
    const saved = decodeOutcome(outcome instanceof Uint8Array ? outcome : outcome?.bytes);
    if (!["progressed", "yielded"].includes(saved.kind) || !saved.state) throw new Error("continue requires a progressed or yielded checkpoint");
    return invoke({ image: bytes(image, "image"), state: saved.state,
      control: saved.kind === "yielded" ? "resume_yield" : "none" });
  };
  const inspectPending = async (outcome) => {
    // The canonical PKO3 remains authoritative; an object's display fields are
    // never trusted to select or reconstruct pending control.
    const decoded = decodeOutcome(outcome instanceof Uint8Array ? outcome : outcome?.bytes);
    if (decoded.kind !== "requested")
      return Object.freeze({ kind: decoded.kind, authoritative: false });
    const request = Object.freeze(await world.decodeRequest(decoded.request));
    const view = { kind: decoded.kind, authoritative: false, request,
      classification: "typed_request" };
    if (request.semanticIdentity.startsWith(exchangePrefix) &&
        request.semanticIdentity.length > exchangePrefix.length) {
      const schema = decodeSchema(request.payloadSchema);
      let value;
      try { value = decodeValue(schema, request.payload); }
      catch (error) {
        // Presentation is optional. Host allocation limits do not invalidate a
        // canonical request or prevent binary-only clients from answering it.
        if (error instanceof ValueCodecError && error.code === "ValueCapacity")
          return Object.freeze(view);
        throw error;
      }
      if (Array.isArray(value) && value.length === 4) {
        const [channel, purpose, presentation, outgoing] = value;
        view.interaction = Object.freeze({ channel, purpose, presentation, outgoing });
        // Only self-describing textual purposes receive display labels. Numeric
        // application enums retain their actual typed value without guessing.
        view.classification = classifications.get(purpose) ?? "awaiting_interaction";
      }
    }
    return Object.freeze(view);
  };
  return Object.freeze({ start, resume, cancel, continueExecution, inspectPending, decodeOutcome,
    identity: Object.freeze({ ...observed, packageVersion: world.packageVersion,
      abi: lock.world.runtime.abi, physicalProfile: lock.world.runtime.physicalProfile }) });
}
