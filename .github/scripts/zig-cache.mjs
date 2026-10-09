// Cache admission is diagnostic, not qualification. Never delete build outputs.
import { lstatSync, readdirSync, appendFileSync, mkdirSync, linkSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export function inspectCache(root, limitBytes = 8 * 1024 ** 3) {
  if (!Number.isSafeInteger(limitBytes) || limitBytes <= 0) throw new Error('positive cache budget required');
  const groups = Object.create(null), report = { bytes: 0, files: 0, unsupported: 0, groups, limitBytes };
  function visit(path, group) {
    const stat = lstatSync(path);
    if (stat.isDirectory()) for (const name of readdirSync(path)) visit(join(path, name), group ?? name);
    else if (stat.isFile()) {
      report.bytes += stat.size; report.files++;
      groups[group ?? '.'] = (groups[group ?? '.'] ?? 0) + stat.size;
    } else report.unsupported++;
  }
  try { visit(resolve(root)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; report.unsupported++; }
  // Object bytes distinguish useful compiler output from an empty/metadata-only cache.
  report.save = report.unsupported === 0 && (groups.o ?? 0) > 0 && report.bytes <= limitBytes;
  report.reason = report.save ? 'nonempty compiler objects within budget' :
    report.unsupported ? 'absent or unsupported cache entries' :
    report.bytes > limitBytes ? 'over budget; retain the previous remote cache without deleting local data' : 'no compiler objects';
  return report;
}

// Zig's manifests can retain cross-object links, including implicit compiler
// runtime archives. A snapshot is the whole cache or nothing; selecting only
// some object directories can turn a cache hit into a missing linker input.
// Build the upload tree only after compilation stops, without changing source.
export function snapshotCache(root, destination, limitBytes = 4 * 1024 ** 3) {
  root = resolve(root); destination = resolve(destination);
  if (!Number.isSafeInteger(limitBytes) || limitBytes <= 0) throw new Error('positive cache budget required');
  const outside = path => path === '..' || path.startsWith('../');
  if (!outside(relative(root, destination)) || !outside(relative(destination, root))) throw new Error('disjoint cache paths required');
  try {
    lstatSync(destination);
    throw Object.assign(new Error('snapshot destination already exists'), { code: 'EEXIST' });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const admission = inspectCache(root, limitBytes);
  if (admission.unsupported) throw new Error('unsupported cache entry');
  if (!admission.save) return admission;
  function copy(source, target) {
    const stat = lstatSync(source);
    if (stat.isDirectory()) {
      mkdirSync(target); // Include empty directories; never reuse a snapshot.
      for (const name of readdirSync(source)) copy(join(source, name), join(target, name));
    } else if (stat.isFile()) linkSync(source, target);
    else throw new Error('unsupported cache entry');
  }
  copy(root, destination);
  return inspectCache(destination, limitBytes);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root = '.zig-cache', phase = 'final', destination] = process.argv.slice(2);
  const report = { phase, restoredKey: process.env.RESTORED_CACHE_KEY || null,
    ...(destination ? snapshotCache(root, destination) : inspectCache(root)) };
  console.log(JSON.stringify(report, null, 2));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `save=${report.save}\nbytes=${report.bytes}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### Zig cache: ${phase}\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`);
}
