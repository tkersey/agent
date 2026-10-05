// Environmental publication leaf. Approval remains inside the admitted image;
// this adapter verifies its current request and commits its exact proposal.
import { decodeSchema, encodeValue } from '../values.mjs';
import { canonical, parse, requireThat } from './canonical.mjs';
import { hash } from './protocol.mjs';
import { version } from './custody.mjs';
import { checkResultSchema as admitCheckSchema, acquiredCheck } from './repository_check.mjs';

export const PUBLICATION = 'agent.repository.publish.v1';
const same = (a, b) => hash(canonical(a, 2 << 20)) === hash(canonical(b, 2 << 20));

export function repositoryPublicationBinding(metadata, { store, helper, protectedImages,
  authorizationDigest, validationPolicyDigest, requiredProfiles, checkResultSchema, services }) {
  const readOnly = metadata.operation === 'agent.repository.publication-current.v1';
  requireThat((metadata.operation === PUBLICATION || readOnly) && Array.isArray(protectedImages) && protectedImages.length > 0 &&
    protectedImages.every(row => /^[a-f0-9]{64}$/.test(row.image) && /^[a-f0-9]{64}$/.test(row.program)), 'PublicationProfile');
  requireThat([authorizationDigest, validationPolicyDigest].every(value => /^[a-f0-9]{64}$/.test(value)) &&
    Array.isArray(requiredProfiles) && requiredProfiles.length > 0 && requiredProfiles.length <= 16 &&
    new Set(requiredProfiles.map(row => row.id)).size === requiredProfiles.length && requiredProfiles.every(row =>
      typeof row.id === 'string' && row.id.length > 0 && [row.profileDigest, row.runner].every(value => /^[a-f0-9]{64}$/.test(value))), 'PublicationProfile');
  const resultSchema = decodeSchema(metadata.resultSchema), payloadSchema = decodeSchema(metadata.payloadSchema);
  const variants = resultSchema.types[resultSchema.root]?.sum;
  requireThat(Number.isSafeInteger(payloadSchema.types[payloadSchema.root]?.bounded_text) &&
    (readOnly ? resultSchema.types[resultSchema.root] === 'boolean' :
      variants?.length === 4 && variants.every(type => Number.isSafeInteger(resultSchema.types[type]?.bounded_text))), 'PublicationSchema');
  const checkSchema = admitCheckSchema(checkResultSchema);
  const images = structuredClone(protectedImages), profiles = structuredClone(requiredProfiles);
  const decode = payload => parse(Buffer.from(payload), { maximum: 2 << 20 });
  const matches = run => images.some(row => row.image === run.image_digest && row.program === run.program_id);
  const authorize = (payload, run) => {
    if (!matches(run)) return false;
    const proposal = decode(payload), owner = proposal?.core?.binding;
    return owner?.run === run.run_id && owner.principal === run.principal_ref && owner.tenant === run.tenant_ref &&
      owner.authorizationDigest === authorizationDigest && owner.validationPolicyDigest === validationPolicyDigest;
  };
  if (readOnly) return { ...metadata, authorize, async handle({ payload }) {
    let valid = false;
    try {
      const proposal = await store.verifyPublication(decode(payload));
      valid = proposal.core.binding.policyRevision === services().policy.revision &&
        await store.current() === proposal.core.destination.expectedBase;
    } catch { /* A failed read cannot authorize the protected operation. */ }
    return encodeValue(resultSchema, valid);
  } };
  const records = (journal, proposal) => {
    const target = proposal.core.destination;
    return journal.publicationRecords(proposal.core.binding.tenant, target.repository, target.generation, target.managedRef);
  };
  const history = rows => ({ proposals: rows.map(row => row.intent.proposal),
    publishedCommits: rows.filter(row => row.receipt?.status === 'Published').map(row => row.receipt.commit) });
  const envelope = (receipt, durable = true) => ({ reply: encodeValue(resultSchema, {
    tag: ({ Published: 0, Conflict: 1, NotApplied: 2 })[receipt.status], value: Buffer.from(canonical(receipt, 2 << 20)).toString('utf8') }),
    publicationReceipt: durable ? receipt : null });
  const describe = (proposal, receipt, recovered) => ({ format: 'agent.repository.publication-receipt/v1', ...receipt,
    destination: proposal.core.destination, tree: proposal.core.candidate.tree,
    validation: proposal.core.validation.map(record => record.id), policyRevision: proposal.core.binding.policyRevision, recovered });
  const binding = { ...metadata, publication: true, background: false, cancelSafe: false, authorize,
    async handle({ payload, request, run, occurrence }) {
      const proposal = decode(payload), { journal, policy } = services();
      const receipt = await store.publishManaged(proposal, helper, exact => {
        const current = journal.run(run.run_id);
        // No await between fresh policy admission and the journal transaction.
        const selected = policy.dispatch(current, request);
        requireThat(selected.binding === binding && same(decode(selected.payload), exact), 'PublicationAuthorityMismatch');
        requireThat(exact.core.binding.policyRevision === policy.revision, 'PublicationAuthorityMismatch');
        const acquired = journal.acquiredReplies(run.run_id, 'agent.repository.check.v1').map(bytes => acquiredCheck(checkSchema, bytes));
        requireThat(exact.core.validation.length === profiles.length && profiles.every(profile =>
          exact.core.validation.some(record => record.profile === profile.id && record.profileDigest === profile.profileDigest &&
            record.runner === profile.runner && acquired.some(saved => same(saved, record)))), 'PublicationValidationMissing');
        return journal.admitPublication(run.run_id, version(current), occurrence.attempt_id, exact, policy.revision);
      }, () => history(records(journal, proposal)));
      return envelope(describe(proposal, { ...receipt, commit: receipt.commit ?? null }, false), receipt.admission !== undefined);
    },
    async reconcile({ payload, run, occurrence }) {
      requireThat(matches(run), 'PublicationAuthorityMismatch');
      const proposal = decode(payload), { journal } = services(), rows = records(journal, proposal);
      if (!occurrence.publication_intent_digest) {
        const saved = history(rows);
        if (!saved.proposals.some(item => item.digest === proposal.digest)) saved.proposals.push(proposal);
        const result = await store.reconcilePublication(proposal, helper, saved.proposals, saved.publishedCommits);
        requireThat(result.status !== 'Published', 'PublicationIntentMissing');
        return envelope(describe(proposal, result, true), false);
      }
      const row = rows.find(item => item.intent_digest === occurrence.publication_intent_digest);
      requireThat(row && same(row.intent.proposal, proposal) && row.intent.admission.run_id === run.run_id &&
        row.intent.admission.occurrence_id === occurrence.id && row.intent.admission.attempt_id === occurrence.attempt_id &&
        row.intent.admission.request_digest === run.request_digest, 'PublicationIntentMismatch');
      const saved = history(rows);
      const result = await store.reconcilePublication(proposal, helper, saved.proposals, saved.publishedCommits);
      return envelope(describe(proposal, { ...result, admission: { ...row.intent.admission, intent_digest: row.intent_digest } }, true));
    },
  };
  return binding;
}
