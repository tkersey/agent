import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const options = parseArgs(process.argv.slice(2));
const image = JSON.parse(await readFile(options.imageEconomy, "utf8"));
const census = JSON.parse(await readFile(options.processCensus, "utf8"));
const sourceMap = JSON.parse(await readFile(options.sourceMap, "utf8"));

const binding = Object.freeze({
  format: "agent-wire-closure-baseline-binding/v1",
  agentHead: "3f0e4a4e0c2e13b41729207187edc1d5abc625f6",
  boundaryHead: "bc0f22eddfc051b24b16df5a41c3d65365d9d33b",
  worldHead: "622735238addc1c2612b060a6f6d9c2eb17a7abd",
  imageSha256: "cec599592476e13faa4b5f12d723a9d395fdfb0435727b0149da354b398fae63",
  imageByteLength: 253_427,
  reductions: 20_133,
  modelRequests: 8,
  repositoryRequests: 7,
});

assert.equal(image.format, "boundary-image-economy/v1");
assert.equal(image.imageSha256, binding.imageSha256);
assert.equal(image.imageByteLength, binding.imageByteLength);
assert.equal(census.format, "agent-process-state-census/v1");
assert.equal(census.imageSha256, binding.imageSha256);
assert.equal(census.reductionCount, binding.reductions);
assert.equal(sourceMap.format, "agent-bpi1-source-map/v1");
assert.equal(sourceMap.imageSha256, binding.imageSha256);
assert.equal(sourceMap.programTransitionDigest, image.programTransitionDigest);
assert.equal(sourceMap.segments.length, image.sections.segments.records);
assert.equal(sourceMap.functions.length, image.sections.functions.records);

const phaseRows = new Map();
for (const row of census.rows) {
  const current = phaseRows.get(row.phase) ?? {
    phase: row.phase,
    outcomes: 0,
    progressed: 0,
    firstReduction: row.reductionIndex,
    lastReduction: row.reductionIndex,
    maximumStateBytes: 0,
    maximumRequestBytes: 0,
  };
  current.outcomes += 1;
  if (row.outcomeKind === "Progressed") current.progressed += 1;
  current.lastReduction = row.reductionIndex;
  current.maximumStateBytes = Math.max(current.maximumStateBytes, row.stateByteLength);
  current.maximumRequestBytes = Math.max(
    current.maximumRequestBytes,
    row.pendingRequestByteLength,
  );
  phaseRows.set(row.phase, current);
}

const outputs = [
  [options.imageOutput, { ...image, baselineBinding: binding }],
  [options.processOutput, {
    format: "agent-wire-closure-baseline-process/v1",
    baselineBinding: binding,
    census,
  }],
  [options.phasesOutput, {
    format: "agent-wire-closure-baseline-phases/v1",
    baselineBinding: binding,
    sourceMap,
    phaseRows: [...phaseRows.values()].sort((left, right) =>
      Buffer.compare(Buffer.from(left.phase), Buffer.from(right.phase))),
  }],
];

for (const [path, value] of outputs) {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    assert(key?.startsWith("--") && value !== undefined, "invalid arguments");
    result[toCamel(key.slice(2))] = value;
  }
  for (const key of [
    "imageEconomy",
    "processCensus",
    "sourceMap",
    "imageOutput",
    "processOutput",
    "phasesOutput",
  ]) assert(key in result, `missing --${key}`);
  return result;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}
