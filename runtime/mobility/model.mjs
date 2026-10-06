// Deployment-only provider leaf. Returns proposals; it cannot execute them.
import { REPLAY_MODEL_EFFECT, decodeReplayModelInvocation, encodeOpenAIResponsesRequest, performReplayModelInvocation, admitModelEndpoint } from '../model.mjs';
import { canonical, closed, identifier, requireThat } from './canonical.mjs';
import { hash } from './protocol.mjs';
export function modelBinding(metadata, profile, hostId) {
  closed(profile, ['kind', 'owner', 'mode', 'endpoint', 'credentialEnv', 'model', 'parameters', 'timeoutMs', 'maximumRequestBytes', 'maximumResponseBytes', 'disclosure', 'allowance']);
  requireThat(profile.kind === 'openai-responses-replay' && metadata.operation === REPLAY_MODEL_EFFECT && profile.owner === hostId, 'ModelProfile');
  requireThat(['loopback-fixture', 'openai-live'].includes(profile.mode), 'ModelProfile');
  identifier(profile.model); identifier(profile.owner);
  const positive = (value, maximum) => Number.isSafeInteger(value) && value > 0 && value <= maximum;
  requireThat(positive(profile.timeoutMs, 120000) && positive(profile.maximumRequestBytes, 4 << 20) && positive(profile.maximumResponseBytes, 4 << 20), 'ModelProfile');
  closed(profile.parameters, ['maxOutputTokens', 'temperature', 'reasoning']);
  requireThat(positive(profile.parameters.maxOutputTokens, 1000000), 'ModelTokenLimit');
  closed(profile.disclosure, ['audience', 'policyRevision', 'labels']);
  identifier(profile.disclosure.policyRevision);
  if (profile.disclosure.audience !== null) identifier(profile.disclosure.audience);
  requireThat(profile.disclosure.audience === metadata.audience && Array.isArray(profile.disclosure.labels), 'ModelDisclosure');
  closed(profile.allowance, ['attempts', 'request_bytes', 'output_tokens', 'concurrent']);
  requireThat(positive(profile.allowance.concurrent, 8) && positive(profile.allowance.attempts, 32) && positive(profile.allowance.request_bytes, 128 << 20) && positive(profile.allowance.output_tokens, 32000000), 'WorkAllowance');
  const endpoint = admitModelEndpoint(profile.endpoint, profile.mode === 'openai-live');
  if (profile.mode === 'loopback-fixture') requireThat(profile.credentialEnv === null && ['127.0.0.1', '[::1]'].includes(endpoint.hostname), 'ModelEndpoint');
  else requireThat(typeof profile.credentialEnv === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(profile.credentialEnv), 'ModelCredentials');
  requireThat(!endpoint.username && !endpoint.password && !endpoint.hash && !endpoint.search, 'ModelEndpoint');
  const admitted = structuredClone(profile), grant = hash(canonical(admitted));
  const prepare = ({ request, run }) => {
    requireThat(run.classification.every(label => admitted.disclosure.labels.includes(label)), 'LeafDisclosureDenied');
    const decoded = decodeReplayModelInvocation(request.payload), invocation = decoded.invocation;
    requireThat(invocation.model === admitted.model && hash(canonical(invocation.parameters)) === hash(canonical(admitted.parameters)), 'ModelProfileMismatch');
    requireThat(invocation.maximumProviderResponseBytes <= admitted.maximumResponseBytes, 'ModelResponseLimit');
    const requestBytes = encodeOpenAIResponsesRequest(invocation, decoded.input).length;
    requireThat(requestBytes <= admitted.maximumRequestBytes, 'ModelRequestLimit');
    if (admitted.mode === 'openai-live') requireThat(typeof process.env[admitted.credentialEnv] === 'string' && process.env[admitted.credentialEnv].length > 0, 'ModelCredentialsUnavailable');
    return { requestBytes, outputTokens: invocation.parameters.maxOutputTokens };
  };
  return { ...metadata, background: true, cancelSafe: true,
    authorize: (_payload, run) => run.classification.every(label => admitted.disclosure.labels.includes(label)),
    charge(context) {
      const cost = prepare(context);
      return { owner: admitted.owner, kind: 'model', grant, limit: { ...admitted.allowance },
        amount: { request_bytes: cost.requestBytes, output_tokens: cost.outputTokens } };
    },
    async handle({ request, run, signal }) {
      prepare({ request, run });
      const bounded = AbortSignal.any([signal, AbortSignal.timeout(admitted.timeoutMs)]);
      const reply = await performReplayModelInvocation(request.payload, { endpoint: admitted.endpoint, signal: bounded,
        ...(admitted.mode === 'openai-live' ? { apiKey: process.env[admitted.credentialEnv] } : {}) });
      // Lost transport or an HTTP failure cannot justify another billable send.
      requireThat(reply[0] !== 2 && !(reply[0] === 3 && reply.readUInt32LE(1) === 0), 'ModelDeliveryUnknown');
      return reply;
    },
  };
}
