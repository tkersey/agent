// A single deployment-selected check over an immutable candidate. World owns
// selection and interpretation; this leaf never advances application control.
import { decodeSchema, decodeValue, encodeValue } from '../values.mjs';
import { canonical, closed, parse, requireThat } from './canonical.mjs';
import { hash } from './protocol.mjs';

export const CHECK_STATUSES = Object.freeze(['Passed', 'Failed', 'Unavailable', 'TimedOut', 'Cancelled', 'InvalidOutput', 'Incomplete']);
export function checkResultSchema(bytes) {
  const schema = decodeSchema(bytes), fields = schema.types[schema.root]?.product;
  requireThat(fields?.length === 2 &&
    JSON.stringify(schema.types[fields[0]]?.enumeration) === '[0,1,2,3,4,5,6]' &&
    schema.types[fields[1]]?.bounded_text === (2 << 20), 'PublicationCheckSchema');
  return schema;
}
export function acquiredCheck(schema, bytes) {
  const [status, text] = decodeValue(schema, bytes);
  const record = parse(Buffer.from(text), { maximum: 2 << 20 });
  requireThat(record.status === CHECK_STATUSES[status], 'PublicationCheckStatus');
  return record;
}

export function repositoryCheckBinding(metadata, { runner, profile, hostId }) {
  closed(profile, ['owner', 'repository', 'generation', 'manifest', 'profileId', 'profileDigest', 'runner', 'disclosure', 'allowance']);
  requireThat(metadata.operation === 'agent.repository.check.v1' && metadata.role === 'write' && profile.owner === hostId &&
    metadata.subject === profile.repository && metadata.subjectVersion === profile.manifest, 'RepositoryCheckBinding');
  requireThat(runner.profiles.some(item => item.id === profile.profileId && item.digest === profile.profileDigest) &&
    /^[a-f0-9]{64}$/.test(profile.runner) && runner.runner === profile.runner, 'RepositoryCheckBinding');
  closed(profile.disclosure, ['audience', 'labels']);
  requireThat(profile.disclosure.audience === metadata.audience && Array.isArray(profile.disclosure.labels), 'CheckDisclosure');
  closed(profile.allowance, ['attempts', 'request_bytes', 'concurrent']);
  const { attempts, request_bytes, concurrent } = profile.allowance;
  requireThat(Number.isSafeInteger(attempts) && attempts > 0 && attempts <= 16 &&
    Number.isSafeInteger(request_bytes) && request_bytes > 0 && request_bytes <= (32 << 20) &&
    Number.isSafeInteger(concurrent) && concurrent > 0 && concurrent <= 8, 'WorkAllowance');
  const payloadSchema = decodeSchema(metadata.payloadSchema), resultSchema = checkResultSchema(metadata.resultSchema);
  requireThat(payloadSchema.types[payloadSchema.root]?.bounded_text === (2 << 20), 'RepositoryCheckSchema');
  const admitted = structuredClone(profile), grant = hash(canonical(admitted));
  const decode = payload => parse(Buffer.from(payload), { maximum: 2 << 20 });
  const disclosed = run => run.classification.every(label => admitted.disclosure.labels.includes(label));
  const owns = candidate => candidate?.snapshot?.repository === admitted.repository && candidate.snapshot.generation === admitted.generation;
  const admit = (payload, run) => {
    requireThat(disclosed(run), 'LeafDisclosureDenied');
    const candidate = decode(payload);
    requireThat(owns(candidate), 'RepositoryCheckSubject');
    return candidate;
  };
  return { ...metadata, background: true, cancelSafe: true,
    authorize: (payload, run) => disclosed(run) && owns(decode(payload)),
    charge({ payload, run, request }) {
      admit(payload, run);
      return { owner: admitted.owner, kind: 'check', grant,
        limit: { ...admitted.allowance, output_tokens: 0 }, amount: { request_bytes: request.payload.length, output_tokens: 0 } };
    },
    async handle({ payload, run, occurrence, signal }) {
      const candidate = admit(payload, run);
      const record = await runner.check({ snapshot: candidate.snapshot, candidate, profileId: admitted.profileId, occurrence: occurrence.id, signal });
      requireThat(record.runner === admitted.runner && record.profileDigest === admitted.profileDigest &&
        CHECK_STATUSES.includes(record.status), 'RepositoryCheckBinding');
      return encodeValue(resultSchema, [CHECK_STATUSES.indexOf(record.status), Buffer.from(canonical(record, 2 << 20)).toString('utf8')]);
    },
  };
}
