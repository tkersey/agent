import { createHash } from "node:crypto";

export function buildInterpretedEffectMap({
  effects,
  manifest,
  bindings,
  effectInterfaceId
}) {
  if (effects.length !== manifest.residualEffects.length) {
    throw new Error(`interpreted_effect_catalog_count:${effects.length}:${manifest.residualEffects.length}`);
  }
  const applicationId = Buffer.from(manifest.applicationId);
  const usedResiduals = new Set();
  const usedBindings = new Set();
  return Object.freeze(effects.map((effect) => {
    const interfaceId = effectInterfaceId(effect.identity);
    const residuals = manifest.residualEffects.filter((entry) =>
      sameBytes(entry.interfaceId, interfaceId));
    if (residuals.length !== 1) {
      throw new Error(`interpreted_manifest_effect_count:${effect.identity}:${residuals.length}`);
    }
    const residual = residuals[0];
    const residualIndex = manifest.residualEffects.indexOf(residual);
    if (usedResiduals.has(residualIndex)) {
      throw new Error(`interpreted_manifest_effect_reused:${effect.identity}:${residualIndex}`);
    }
    usedResiduals.add(residualIndex);
    const admitted = bindings.filter((binding) =>
      sameBytes(binding.interfaceId, interfaceId) &&
      sameBytes(binding.payloadSchemaId, residual.payloadSchemaId) &&
      sameBytes(binding.resultSchemaId, residual.resultSchemaId) &&
      BigInt(binding.authorityRequirements) === residual.authorityRequirements &&
      binding.applicationIds.some((id) => sameBytes(id, applicationId)));
    if (admitted.length !== 1) {
      throw new Error(`interpreted_binding_count:${effect.identity}:${admitted.length}`);
    }
    const bindingIndex = bindings.indexOf(admitted[0]);
    if (usedBindings.has(bindingIndex)) {
      throw new Error(`interpreted_binding_reused:${effect.identity}:${bindingIndex}`);
    }
    usedBindings.add(bindingIndex);
    return Object.freeze({
      effect,
      interfaceId: Buffer.from(interfaceId),
      residual,
      binding: admitted[0]
    });
  }));
}

export async function resolveInterpretedEffect({
  admission,
  manifest,
  requestIdentity,
  payloadBytes,
  receiverContext,
  admitCapabilityOutcome,
  statusNames,
  beforeResolve = async () => {}
}) {
  const { effect, interfaceId, residual, binding } = admission;
  const requestId = Buffer.from(requestIdentity.digest).toString("hex");
  const idempotencyKey = createHash("sha256")
    .update("agent-interpretation-v1-idempotency\0")
    .update(requestIdentity.digest)
    .digest("hex");
  const projected = Object.freeze({
    protocolVersion: "world-effect-v1",
    requestId,
    idempotencyKey,
    interfaceId: Buffer.from(interfaceId).toString("hex"),
    siteId: residual.siteId.toString(),
    sequence: requestIdentity.sequence.toString(),
    target: Object.freeze({ ...binding.target }),
    responseSchema: Object.freeze({ statuses: statusNames(residual.allowedStatuses) }),
    limits: Object.freeze({ maximumResultBytes: manifest.limits.maximumResultBytes, maximumAttempts: 1 }),
    payload: binding.decodePayload(payloadBytes)
  });
  await beforeResolve(Object.freeze({ effect, binding, projected, requestIdentity }));
  const preflight = admitCapabilityOutcome(
    await binding.adapter.preflight(receiverContext, projected)
  );
  assertOutcome(preflight, requestId);
  if (preflight.status !== "ok") throw new Error(`interpreted_preflight_rejected:${effect.identity}:${preflight.payload?.reason ?? "unknown"}`);
  const outcome = admitCapabilityOutcome(
    await binding.adapter.resolve(receiverContext, projected)
  );
  assertOutcome(outcome, requestId);
  if (outcome.status !== "ok") throw new Error(`interpreted_effect_not_ok:${effect.identity}:${outcome.status}`);
  const responseBytes = Buffer.from(binding.encodeOutcome(outcome, projected));
  if (responseBytes.length > manifest.limits.maximumResultBytes) throw new Error("interpreted_result_limit");
  return Object.freeze({
    responseBytes,
    metadata: Object.freeze({
      bindingId: binding.bindingId,
      driverId: binding.driverId,
      recoveryClass: binding.recoveryClass ?? "pure"
    })
  });
}

function assertOutcome(value, requestId) {
  if (!value || typeof value !== "object" || value.requestId !== requestId || typeof value.status !== "string") {
    throw new Error("interpreted_outcome_invalid");
  }
}

function sameBytes(left, right) {
  return left instanceof Uint8Array && right instanceof Uint8Array && Buffer.from(left).equals(Buffer.from(right));
}
