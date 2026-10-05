import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { admitQualification, qualifyApplication } from '../../runtime/mobility/qualification.mjs';
const external = { origin: 'origin.json', peers: ['workspace.json'], principal: 'user', tenant: 'tenant', cases: [
  { id: 'holdout-1', entry: 'repository', base: 'a'.repeat(40), mode: 'inspect', goal: 'Inspect the approved scope.', expected: { kind: 'completed', proposalTree: null, published: false } },
] };
const configuration = lane => ({ format: 'agent.repository.qualification/v1', lanes: [lane], source: null, external: structuredClone(external), maximumSeconds: 60 });
for (const lane of ['deployed', 'live']) test(`${lane} opt-in rejects before host access or output creation`, async t => {
  const area = await mkdtemp(join(tmpdir(), 'qualification-optin-')); t.after(() => rm(area, { recursive: true, force: true }));
  const file = join(area, 'config.json'), output = join(area, 'out'); await writeFile(file, JSON.stringify(configuration(lane)));
  await assert.rejects(qualifyApplication(file, output), { code: 'QualificationOptInRequired' });
  await assert.rejects(stat(output), { code: 'ENOENT' });
  assert.equal(admitQualification(configuration(lane), { [lane]: true }).lanes[0], lane);
});
test('qualification admits only owned lanes and coherent predeclared acceptance', () => {
  assert.throws(() => admitQualification({ ...configuration('live'), lanes: ['shell'] }), { code: 'QualificationLanes' });
  assert.throws(() => admitQualification({ ...configuration('live'), lanes: ['live','deployed'] }, { live: true, deployed: true }), { code: 'QualificationOptInRequired' });
  const wrong = configuration('live'); wrong.external.cases[0].expected.published = true;
  assert.throws(() => admitQualification(wrong, { live: true }), { code: 'QualificationExpectedResult' });
  const duplicate = configuration('live'); duplicate.external.cases.push(duplicate.external.cases[0]);
  assert.throws(() => admitQualification(duplicate, { live: true }), { code: 'QualificationCorpus' });
  assert.throws(() => admitQualification(configuration('live'), { deployed: true }), { code: 'QualificationOptInRequired' });
});

test('qualification checks independent tree and exact publication result, not text claims', async () => {
  const { assessQualificationResult } = await import('../../runtime/mobility/qualification.mjs');
  const tree = 'b'.repeat(40), proposal = { digest: 'd'.repeat(64), commitOid: 'e'.repeat(40), core: { candidate: { tree } } };
  const receipt = { status: 'Published', tree, proposal: proposal.digest, commit: proposal.commitOid };
  const expected = { mode: 'publish', expected: { kind: 'completed', proposalTree: tree, published: true } };
  const report = ['1','1',2,0,[],JSON.stringify(proposal), { tag: 1, value: { tag: 0, value: { tag: 0, value: JSON.stringify(receipt) } } }];
  assert(Object.values(assessQualificationResult(expected, 'completed', report)).every(Boolean));
  assert.equal(assessQualificationResult({ ...expected, expected: { ...expected.expected, proposalTree: 'c'.repeat(40) } }, 'completed', report).tree, false);
  const declined = structuredClone(report); declined[6] = { tag: 1, value: { tag: 1, value: { tag: 0, value: JSON.stringify(receipt) } } };
  assert.equal(assessQualificationResult(expected, 'completed', declined).publication, false);
  const unrelated = structuredClone(report); unrelated[6].value.value.value = JSON.stringify({ ...receipt, commit: 'someone-else' });
  assert.equal(assessQualificationResult(expected, 'completed', unrelated).publication, false);
  assert.equal(assessQualificationResult({ mode: 'publish', expected: { kind: 'failed', proposalTree: null, published: false } }, 'failed', null).publication, false);
  assert.equal(assessQualificationResult({ mode: 'inspect', expected: { kind: 'completed', proposalTree: null, published: false } }, 'completed', null).outcome, false);
});

test('deployed qualification refuses a live provider before opening the origin', async t => {
  const area = await mkdtemp(join(tmpdir(), 'qualification-mode-')); t.after(() => rm(area, { recursive: true, force: true }));
  await writeFile(join(area, 'peer.json'), JSON.stringify({ bindings: [{ adapter: { kind: 'openai-responses-replay', mode: 'openai-live' } }] }));
  const input = configuration('deployed'); input.external.origin = 'must-not-be-opened.json'; input.external.peers = ['peer.json'];
  const file = join(area, 'config.json'); await writeFile(file, JSON.stringify(input));
  await assert.rejects(qualifyApplication(file, join(area, 'out'), { deployed: true }), { code: 'QualificationProviderMode' });
});
