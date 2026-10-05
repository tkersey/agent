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
    binding.defer = ({ payload }) => ({ audience: binding.audience, alternatives: ['approve', 'decline'], maximum_text_bytes: 128,
      question: { kind: 'repository-publication-approval', challenge: payload[3] } });
    binding.answer = ({ answer, pending, run }) => {
      return encodeValue(result, { tag: 0, value: [pending.question.challenge, BigInt(principals[run.principal_ref]),
        answer.choice === 'approve' ? { tag: 0, value: null } : { tag: 1, value: answer.text }] });
    };
  }
  return binding;
}
