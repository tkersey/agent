// Authenticated deferred approval leaves; the private grant remains image-owned.
import { decodeSchema, encodeValue } from '../values.mjs';
import { closed, parse, requireThat } from './canonical.mjs';
export function repositoryApprovalBinding(metadata, adapter) {
  const binding = { ...metadata };
  if (adapter.kind === 'repository-approval-issuer') {
    closed(adapter, ['kind']);
    requireThat(binding.operation === 'agent.approval.issue.v1.repository.publish', 'AdapterContract');
    binding.authorize = (payload, run) => {
      const proposal = parse(Buffer.from(payload), { maximum: 2 << 20 });
      return proposal.core.binding.run === run.run_id && proposal.core.binding.principal === run.principal_ref && proposal.core.binding.tenant === run.tenant_ref;
    };
    // Issuing the challenge identifier performs no publication or external work.
    binding.cancelSafe = true;
    binding.recoveryMatches = binding.authorize;
    binding.handle = ({ occurrence }) => encodeValue(decodeSchema(binding.resultSchema), occurrence.id);
  } else {
    requireThat(adapter.kind === 'repository-approval-human', 'AdapterContract');
    closed(adapter, ['kind', 'revision', 'principalIds']);
    requireThat(binding.operation === 'agent.interaction.exchange.v1.repository.publish' && typeof adapter.revision === 'string' && adapter.revision.length > 0 &&
      typeof binding.audience === 'string' && binding.principals.every(principal => typeof adapter.principalIds[principal] === 'string' &&
        /^(0|[1-9][0-9]*)$/.test(adapter.principalIds[principal]) && BigInt(adapter.principalIds[principal]) <= 0xffffffffffffffffn), 'AdapterContract');
    const principals = structuredClone(adapter.principalIds), result = decodeSchema(binding.resultSchema);
    binding.deferredRevision = adapter.revision;
    binding.authorize = (payload, run) => {
      if (payload[0] !== 'repository-human' || payload[1] !== 'approval') return false;
      const proposal = parse(Buffer.from(payload[3][1]), { maximum: 2 << 20 });
      return proposal.core.binding.run === run.run_id && proposal.core.binding.principal === run.principal_ref && proposal.core.binding.tenant === run.tenant_ref;
    };
    binding.defer = ({ payload }) => ({ audience: binding.audience, alternatives: ['approve', 'decline', 'question', 'amend'], maximum_text_bytes: 4096,
      question: { kind: 'repository-publication-approval', challenge: payload[3] } });
    binding.answer = ({ answer, pending, run }) => {
      return encodeValue(result, { tag: 0, value: [pending.question.challenge, BigInt(principals[run.principal_ref]),
        answer.choice === 'approve' ? { tag: 0, value: null } : { tag: 1, value: { tag: ['decline', 'question', 'amend'].indexOf(answer.choice), value: answer.text } }] });
    };
  }
  return binding;
}

// Non-publishing review is ordinary authenticated interaction. Its response can
// resume an investigation, but cannot create a private publication grant.
export function repositoryReviewBinding(metadata, adapter) {
  closed(adapter, ['kind', 'revision']);
  requireThat(adapter.kind === 'repository-review-human' && metadata.operation === 'agent.repository.review.v1' &&
    metadata.role === 'interaction' && typeof metadata.audience === 'string' && typeof adapter.revision === 'string' && adapter.revision.length > 0, 'AdapterContract');
  const result = decodeSchema(metadata.resultSchema);
  return { ...metadata, deferredRevision: adapter.revision, authorize: () => true,
    defer: ({ payload }) => ({ audience: metadata.audience, alternatives: ['finish', 'decline', 'question', 'amend'], maximum_text_bytes: 4096,
      question: { kind: 'repository-review', task_id: String(payload[0]), generation: String(payload[1]), mode: payload[2], summary: payload[3], proposal: payload[4] } }),
    answer: ({ answer }) => encodeValue(result, { tag: ['finish', 'decline', 'question', 'amend'].indexOf(answer.choice), value: answer.choice === 'finish' ? null : answer.text }),
  };
}

export function repositoryClarificationBinding(metadata, adapter) {
  closed(adapter, ['kind', 'revision']);
  const input = decodeSchema(metadata.payloadSchema), result = decodeSchema(metadata.resultSchema);
  requireThat(adapter.kind === 'repository-clarification-human' && metadata.operation === 'agent.repository.human.v1' &&
    metadata.role === 'interaction' && typeof metadata.audience === 'string' && typeof adapter.revision === 'string' && adapter.revision.length > 0 &&
    input.types[input.root]?.product?.length === 6 && result.types[result.root]?.bounded_text === 4096, 'AdapterContract');
  return { ...metadata, deferredRevision: adapter.revision, authorize: () => true,
    defer: ({ payload }) => ({ audience: metadata.audience, alternatives: ['respond'], maximum_text_bytes: 4096,
      question: { kind: 'repository-clarification', task_id: String(payload[0]), generation: String(payload[1]), goal: payload[2], evidence: payload[3], question: payload[4] } }),
    answer: ({ answer }) => encodeValue(result, answer.text) };
}

// Only an authenticated person's goal/mode enters the next authored iteration.
// Identity, repository, scope, generation and allowances cannot be supplied here.
export function repositoryNextTaskBinding(metadata, adapter) {
  closed(adapter, ['kind', 'revision', 'modes']);
  const modes = ['inspect', 'propose', 'publish'];
  requireThat(adapter.kind === 'repository-next-task-human' && metadata.operation === 'agent.repository.next-task.v1' &&
    metadata.role === 'interaction' && typeof metadata.audience === 'string' && typeof adapter.revision === 'string' && adapter.revision.length > 0 &&
    Array.isArray(adapter.modes) && adapter.modes.length > 0 && adapter.modes.length <= 3 && new Set(adapter.modes).size === adapter.modes.length && adapter.modes.every(mode => modes.includes(mode)), 'AdapterContract');
  const allowed = [...adapter.modes], result = decodeSchema(metadata.resultSchema);
  return { ...metadata, deferredRevision: adapter.revision, authorize: () => true,
    defer: ({ payload }) => ({ audience: metadata.audience, alternatives: ['stop', ...allowed], maximum_text_bytes: 4096,
      question: { kind: 'repository-next-task', task_id: String(payload[0][0]), generation: String(payload[0][1]), next_generation: String(payload[1]),
        summary: payload[0][4][0]?.[1]?.[2] ?? '', proposal: payload[0][5], publication: payload[0][6],
        allocation: { steps: payload[2], checks: payload[3], moves: payload[4] }, memory: 'No model transcript or candidate is reused.' } }),
    answer: ({ answer }) => {
      requireThat(answer.choice === 'stop' || (allowed.includes(answer.choice) && typeof answer.text === 'string' && answer.text.trim().length > 0 && Buffer.byteLength(answer.text) <= 4096), 'InvalidTaskAnswer');
      return encodeValue(result, answer.choice === 'stop' ? { tag: 0, value: null } : { tag: 1, value: [answer.text, modes.indexOf(answer.choice)] });
    },
  };
}
