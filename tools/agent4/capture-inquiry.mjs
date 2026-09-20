#!/usr/bin/env node
// Capture prescribed canonical invocations without changing fixture assertions.
// Replay timings belong to World's standalone replay probe, not this capture run.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve, dirname, basename, relative, isAbsolute, sep, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [sourceArg, runtimeArg, fixturesArg, nativeArg, inspectorArg, mode, format, outputArg, ...extra] = process.argv.slice(2);
assert(sourceArg && runtimeArg && fixturesArg && nativeArg && inspectorArg && outputArg && !extra.length &&
  ['cases', 'repeated'].includes(mode) && ['bpi2', 'bpc1', 'bpi3'].includes(format),
  'expected Agent source, runtime, fixtures, native executable, inspector, cases|repeated, bpi2|bpc1|bpi3, and new output directory');
const [source, runtime, fixtures, native, inspector] = [sourceArg, runtimeArg, fixturesArg, nativeArg, inspectorArg].map(path => realpathSync(path));
const requested = resolve(outputArg), output = join(realpathSync(dirname(requested)), basename(requested));
for (const root of [source, runtime, fixtures, dirname(native), dirname(inspector)]) {
  const r = relative(root, output);
  assert(r && (r === '..' || r.startsWith(`..${sep}`) || isAbsolute(r)), 'capture output overlaps immutable inputs');
}
const path = join(source, 'test/agent4', mode === 'cases' ? 'inquiry_cases_runtime.mjs' : 'inquiry_repeated_runtime.mjs');
const original = readFileSync(path, 'utf8'), url = pathToFileURL(path);
const legacy = original.includes('.bpi2"');
assert.equal(legacy, format !== 'bpi3', 'fixture source and image format disagree');
let driver = original.replace(/from "(\.\.?\/[^\"]+)"/g, (_, p) => `from "${new URL(p, url).href}"`)
  .replace(/new URL\("(\.\.?\/[^\"]+)", import\.meta\.url\)/g, (_, p) => `new URL(${JSON.stringify(new URL(p, url).href)})`);
if (format === 'bpc1') driver = driver.replaceAll('.bpi2"', '.bpc1"');
const anchor = `const file = join(scratch, "input.${legacy ? 'pki2' : 'pki3'}");`;
assert.equal(driver.split(anchor).length, 2, 'fixture capture anchor changed');
const capture = `const capture = join(captureRoot, String(captureIndex++).padStart(4, "0") + "-" + ${mode === 'cases' ? 'name' : '"repeated"'});
  await writeFile(capture + ".input", world.encodeInput(${legacy ? '{ ...input, mode: "run" }' : 'input'}));
  await writeFile(capture + ".output", output.bytes);
  ${anchor}`;
driver = `const captureRoot = ${JSON.stringify(output)};\nlet captureIndex = 0;\n` + driver.replace(anchor, capture);
mkdirSync(output); // Do not overwrite another observation or input directory.
const driverPath = join(output, 'driver.mjs');
writeFileSync(driverPath, driver);
const result = execFileSync(process.execPath, [driverPath, runtime, fixtures, native, inspector,
  ...(mode === 'cases' ? ['--comparison-only'] : [])], { maxBuffer: 16 << 20, timeout: 600000 });
assert.equal(readFileSync(path, 'utf8'), original, 'fixture source changed during capture');
writeFileSync(join(output, 'result.json'), result);
process.stdout.write(result);
