// Structural observations from the same existing workload emitter in both modes.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {readDependencyLock, sha256, DEFAULT_LOCK} from './dependencies.mjs';

const [offRoot, safeRoot, output] = process.argv.slice(2);
assert.ok(offRoot && safeRoot && output,
  'usage: node tools/agent4/coalescing-census.mjs OFF_ROOT SAFE_ROOT OUTPUT');
function records(value, map = new Map()) {
  if (!value || typeof value !== 'object') return map;
  if (value.name && value.imageBytes !== undefined) {
    assert.ok(!map.has(value.name), 'duplicate workload'); map.set(value.name, value);
  } else for (const child of Object.values(value)) records(child, map);
  return map;
}
const off = records(JSON.parse(readFileSync(join(offRoot, 'source-metrics.json'))));
const safe = records(JSON.parse(readFileSync(join(safeRoot, 'source-metrics.json'))));
assert.deepEqual([...off.keys()], [...safe.keys()]);
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
const rows = [...off].map(([name, a]) => {
  const b = safe.get(name), before = counts(offRoot, a), after = counts(safeRoot, b);
  assert.equal(a.coalescing.outcome, 'disabled');
  assert.ok(['no_change', 'applied', 'size_guard'].includes(b.coalescing.outcome));
  assert.ok(after.bytes <= before.bytes);
  return {name, realConsumer: realConsumers.has(name),
    off: before, safe: after, outcome: b.coalescing.outcome,
    functionBodiesRemoved: before.catalogues[3] - after.catalogues[3],
    constructorsRemoved: before.catalogues[9] - after.catalogues[9],
    fullCandidate: b.coalescing.full, descriptionsCandidate: b.coalescing.descriptions,
    discoveryWork: b.coalescing.work, exactComparisons: b.coalescing.comparisons};
});
const lock = readDependencyLock();
const sources = ['test/consumers/document/main.zig', 'test/consumers/document/consequence.zig',
  'test/consumers/review/main.zig', 'test/consumers/inquiry/main.zig', 'test/agent4/economy.zig'];
const report = {
  scope: 'Existing workload B1/B2 structural census; timing and runtime qualification remain separate',
  boundary: lock.boundary.commit, world: lock.world.commit,
  kernelSha256: lock.world.runtime.kernel.sha256, lockSha256: sha256(readFileSync(DEFAULT_LOCK)),
  workloadSources: sources.map(path => ({path, sha256: sha256(readFileSync(path))})),
  catalogueOrder: ['schema', 'constant', 'effect', 'function', 'block', 'handler',
    'capture', 'region', 'resource', 'constructor'],
  realConsumerCodeBenefitObserved: rows.some(row =>
    row.realConsumer && (row.functionBodiesRemoved > 0 || row.constructorsRemoved > 0) &&
      row.safe.bytes < row.off.bytes),
  rows,
};
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({workloads: rows.length,
  realConsumerCodeBenefitObserved: report.realConsumerCodeBenefitObserved,
  output}));
