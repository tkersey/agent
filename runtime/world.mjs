import { createHash, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { DEFAULT_LOCK, readDependencyLock, readRegular, verifyRuntime } from "../tools/agent4/dependencies.mjs";
import { decodeSchema, decodeValue } from "./values.mjs";

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
 * Authenticate the supplied, unchanged World installation against Agent's input
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
  const kernel = await world.admitProcessKernel(readRegular(observed.kernelPath), {
    expectedSha256: observed.kernelSha256,
  });
  if (JSON.stringify(kernel.inspection) !== JSON.stringify(lock.world.runtime.physicalProfile.inspection))
    throw new Error("WorldPhysicalProfileMismatch");
  // Detect accidental concurrent replacement during admission as well as before it.
  verifyRuntime(runtimePath, { lockPath });

  const decodeOutcome = (input) => {
    const canonical = bytes(input, "outcome");
    return Object.freeze({ ...world.decodeOutcome(canonical), bytes: canonical });
  };
  const start = (image, initialArgs) => kernel.run({
    image: bytes(image, "image"), initialArgs: bytes(initialArgs, "initialArgs"),
  });
  const resume = (image, state, currentRequest, canonicalReply) => {
    const saved = bytes(state, "state");
    const requestBytes = bytes(currentRequest, "request");
    const request = world.decodeRequest(requestBytes);
    const digest = createHash("sha256").update(saved).digest();
    if (!timingSafeEqual(digest, request.pendingStateDigest))
      throw new Error("RequestStateMismatch");
    // ERS2 construction and typed validation belong to World. The kernel then
    // admits the complete image/State/request binding before any transition.
    const result = world.encodeResult(requestBytes, bytes(canonicalReply, "reply"));
    return kernel.run({ image: bytes(image, "image"), state: saved, result });
  };
  const cancel = (image, state, reason) => {
    if (typeof reason !== "string" && !(reason instanceof Uint8Array))
      throw new TypeError("cancellation reason must be text or bytes");
    return kernel.run({ image: bytes(image, "image"), state: bytes(state, "state"),
      cancel: typeof reason === "string" ? reason : bytes(reason, "reason") });
  };
  const inspectPending = (outcome) => {
    // The canonical PKO2 remains authoritative; an object's display fields are
    // never trusted to select or reconstruct pending control.
    const decoded = decodeOutcome(outcome instanceof Uint8Array ? outcome : outcome?.bytes);
    if (decoded.kind !== "Requested")
      return Object.freeze({ kind: decoded.kind, authoritative: false });
    const request = Object.freeze(world.decodeRequest(decoded.request));
    const view = { kind: decoded.kind, authoritative: false, request,
      classification: "typed_request" };
    if (request.semanticIdentity.startsWith(exchangePrefix) &&
        request.semanticIdentity.length > exchangePrefix.length) {
      const schema = decodeSchema(request.payloadSchema);
      const value = decodeValue(schema, request.payload);
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
  return Object.freeze({ start, resume, cancel, inspectPending, decodeOutcome,
    identity: Object.freeze({ ...observed, packageVersion: world.packageVersion,
      abi: lock.world.runtime.abi, physicalProfile: lock.world.runtime.physicalProfile }) });
}
