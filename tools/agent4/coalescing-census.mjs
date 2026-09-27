// Compare recorded reference and canonical corpora; pass savings use the current pass input.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {readDependencyLock, sha256, DEFAULT_LOCK} from './dependencies.mjs';

const [referenceRoot, canonicalRoot, output, repeatRoot] = process.argv.slice(2);
assert.ok(referenceRoot && canonicalRoot && output,
  'usage: node tools/agent4/coalescing-census.mjs REFERENCE_ROOT CANONICAL_ROOT OUTPUT [REPEAT_ROOT]');
assert.ok(process.argv.length <= 6);
function records(value, map = new Map()) {
  if (!value || typeof value !== 'object') return map;
  if (value.name && value.imageBytes !== undefined) {
    assert.ok(!map.has(value.name), 'duplicate workload'); map.set(value.name, value);
  } else for (const child of Object.values(value)) records(child, map);
  return map;
}
const referenceMetrics = readFileSync(join(referenceRoot, 'source-metrics.json'));
const canonicalMetrics = readFileSync(join(canonicalRoot, 'source-metrics.json'));
const reference = records(JSON.parse(referenceMetrics));
const canonical = records(JSON.parse(canonicalMetrics));
assert.deepEqual([...reference.keys()], [...canonical.keys()]);
const realConsumers = new Set(['document', 'document-consequence', 'clarify-first',
  'inquiry-repair', 'inquiry-repeated', 'inquiry-react', 'review-mid_review',
  'review-clarify_first', 'review-human', 'review-model', 'review-rule', 'review-react']);
function counts(root, row) {
  const image = readFileSync(join(root, `${row.name}.bpi3`));
  assert.equal(image.length, row.imageBytes);
  assert.equal(sha256(image), row.imageSha256);
  const selected = row.coalescing.selected;
  assert.equal(selected.catalogs.length, 10);
  assert.equal(selected.bytes, row.imageBytes);
  assert.equal(selected.catalogs[3], row.functions);
  return {bytes: row.imageBytes, sha256: row.imageSha256,
    catalogues: selected.catalogs, instructions: selected.instructions};
}
const rows = [...reference].map(([name, a]) => {
  const b = canonical.get(name), before = counts(referenceRoot, a), after = counts(canonicalRoot, b);
  assert.ok(['no_change', 'applied', 'size_guard'].includes(b.coalescing.outcome));
  assert.ok(after.bytes <= b.coalescing.baseline.bytes, 'current pass enlarged its input');
  if (repeatRoot) assert.deepEqual(readFileSync(join(repeatRoot, `${name}.bpi3`)),
    readFileSync(join(canonicalRoot, `${name}.bpi3`)), `canonical repeat differs: ${name}`);
  return {name, realConsumer: realConsumers.has(name),
    reference: before, canonical: after, outcome: b.coalescing.outcome,
    functionBodiesRemoved: b.coalescing.baseline.catalogs[3] - after.catalogues[3],
    constructorsRemoved: b.coalescing.baseline.catalogs[9] - after.catalogues[9],
    referenceBytesDelta: after.bytes - before.bytes,
    passInputBytes: b.coalescing.baseline.bytes,
    fullCandidate: b.coalescing.full, descriptionsCandidate: b.coalescing.descriptions,
    discoveryWork: b.coalescing.work, exactComparisons: b.coalescing.comparisons};
});
const lock = readDependencyLock();
const sources = ['test/consumers/document/main.zig', 'test/consumers/document/consequence.zig',
  'test/consumers/review/main.zig', 'test/consumers/inquiry/main.zig', 'test/agent4/economy.zig'];
const report = {
  scope: 'Recorded-reference/canonical structural census; pass savings use the canonical compiler input, and cross-version deltas do not establish causation or runtime acceptance',
  boundary: lock.boundary.commit, world: lock.world.commit,
  referenceMetricsSha256: sha256(referenceMetrics), canonicalMetricsSha256: sha256(canonicalMetrics),
  kernelSha256: lock.world.runtime.kernel.sha256, lockSha256: sha256(readFileSync(DEFAULT_LOCK)),
  workloadSources: sources.map(path => ({path, sha256: sha256(readFileSync(path))})),
  catalogueOrder: ['schema', 'constant', 'effect', 'function', 'block', 'handler',
    'capture', 'region', 'resource', 'constructor'],
  realConsumerCodeBenefitObserved: rows.some(row =>
    row.realConsumer && (row.functionBodiesRemoved > 0 || row.constructorsRemoved > 0) &&
      row.canonical.bytes < row.passInputBytes),
  canonicalRepeatMatches: repeatRoot ? true : null,
  rows,
};
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({workloads: rows.length,
  realConsumerCodeBenefitObserved: report.realConsumerCodeBenefitObserved,
  output}));
