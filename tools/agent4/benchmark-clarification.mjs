#!/usr/bin/env node
// Matched fixture benchmark. The selected Agent source retains all policy/assertions.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep, dirname, basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const [sourceArg, runtimeArg, imageArg, outputArg, ...extra] = process.argv.slice(2);
assert(sourceArg && runtimeArg && imageArg && outputArg && (extra.length === 0 || (extra.length === 1 && extra[0] === '--capture')),
  'expected Agent source, authenticated World runtime, image, new output directory, and optional --capture');
const capture = extra.length === 1;
const source = realpathSync(sourceArg), runtime = realpathSync(runtimeArg), image = realpathSync(imageArg);
const requestedOutput = resolve(outputArg);
const output = join(realpathSync(dirname(requestedOutput)), basename(requestedOutput));
const within = (parent, child) => { const r = relative(parent, child); return !r || (!r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r)); };
for (const input of [source, runtime, dirname(image)]) assert(!within(input, output), 'output must be outside immutable inputs');
mkdirSync(output); // Never overwrite an earlier observation.
const original = readFileSync(join(source, 'test/agent4/consequence_runtime.mjs'), 'utf8');
const legacy = original.includes('\"clarify-first.bpi2\"');
let driver = original;
const replace = (before, after) => {
  assert.equal(driver.split(before).length, 2, `fixture anchor changed: ${before}`);
  driver = driver.replace(before, after);
};
driver = driver.replaceAll('"../../runtime/', `"${pathToFileURL(join(source, 'runtime')).href}/`)
  .replaceAll('"./independent/', `"${pathToFileURL(join(source, 'test/agent4/independent')).href}/`);
replace('const root = resolve(import.meta.dirname, "../..");', `const root = ${JSON.stringify(source)};`);
replace('const output = join(root, ".agent4/out/clarification");', `const output = ${JSON.stringify(output)};`);
replace('const fresh = async input =>', 'const freshImplementation = async input =>');
replace('// Independent fixture oracle:', `let freshNanoseconds = 0n, freshCalls = 0, captureIndex = 0;
const fresh = async input => {
  const start = process.hrtime.bigint();
  try {
    const result = await freshImplementation(input);
    ${capture ? "const prefix = join(output, 'capture-'+String(captureIndex++).padStart(3,'0')); await writeFile(prefix+'.input', world.encodeInput(" + (legacy ? '{...input, mode:"run"}' : 'input') + ")); await writeFile(prefix+'.output', result.bytes);" : ''}
    return result;
  }
  finally { freshNanoseconds += process.hrtime.bigint() - start; freshCalls++; }
};

// Independent fixture oracle:`);
replace('async function scenario(name, options = {}) {', `async function scenario(name, options = {}) {
  const started = process.hrtime.bigint(), initialFresh = freshNanoseconds, initialCalls = freshCalls;`);
replace('return { name, modelCalls,', 'return { name, scenarioNanoseconds: Number(process.hrtime.bigint() - started), freshNanoseconds: Number(freshNanoseconds - initialFresh), freshCalls: freshCalls - initialCalls, modelCalls,');
if (driver.includes('"clarify-first.bpi2"'))
  replace('"clarify-first.bpi2"', 'imagePath.endsWith(".bpc1") ? "clarify-first.bpc1" : "clarify-first.bpi2"');
const path = join(output, 'driver.mjs');
writeFileSync(path, driver);
const env = { ...process.env };
delete env.AGENT4_NATIVE;
delete env.AGENT4_MULTI_INSPECTOR;
const start = process.hrtime.bigint();
execFileSync(process.execPath, [path, runtime, image, '--economy-only'], { env, stdio: 'pipe', timeout: 180000, maxBuffer: 4 << 20 });
const processNanoseconds = Number(process.hrtime.bigint() - start);
const result = JSON.parse(readFileSync(join(output, 'economy-results.json')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { method: 'Unchanged four-case economy fixture policy; fresh-call and whole-scenario clocks are separate. One process observation is not acceptance.',
  timingStatus: capture ? 'UNQUALIFIED_CAPTURE_IO' : 'SINGLE_PROCESS_OBSERVATION', node: process.version, fixtureSourceSha256: hash(original), driverSha256: hash(driver), processNanoseconds,
  imageSha256: hash(readFileSync(image)), ...result };
writeFileSync(join(output, 'benchmark.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output: join(output, 'benchmark.json'), cases: result.results.length, processNanoseconds }));
