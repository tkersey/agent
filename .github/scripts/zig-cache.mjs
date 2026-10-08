// Cache admission is diagnostic, not qualification. Never delete build outputs.
import { lstatSync, readdirSync, appendFileSync, mkdirSync, linkSync } from 'node:fs';
import { resolve, join, relative, dirname } from 'node:path';
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

// Build a separate upload tree after compilation ends. Object directories are
// indivisible; omitted objects remain local and become ordinary Zig cache misses
// on a later runner. Hard links preserve bytes/modes without copying gigabytes.
export function snapshotCache(root, destination, limitBytes = 4 * 1024 ** 3) {
  root = resolve(root); destination = resolve(destination);
  if (!Number.isSafeInteger(limitBytes) || limitBytes <= 0) throw new Error('positive cache budget required');
  const outside = path => path === '..' || path.startsWith('../');
  if (!outside(relative(root, destination)) || !outside(relative(destination, root))) throw new Error('disjoint cache paths required');
  const metadata = [], objects = [];
  function collect(path, files) {
    const stat = lstatSync(path);
    if (stat.isDirectory()) for (const name of readdirSync(path)) collect(join(path, name), files);
    else if (stat.isFile()) files.push({ path, bytes: stat.size, modified: stat.mtimeMs });
    else throw new Error('unsupported cache entry');
  }
  for (const name of readdirSync(root)) {
    if (name !== 'o') { collect(join(root, name), metadata); continue; }
    for (const object of readdirSync(join(root, name))) {
      const files = [];
      collect(join(root, name, object), files);
      objects.push({ name: object, files, bytes: files.reduce((sum, f) => sum + f.bytes, 0),
        modified: files.reduce((latest, f) => Math.max(latest, f.modified), 0) });
    }
  }
  let bytes = metadata.reduce((sum, f) => sum + f.bytes, 0);
  if (bytes > limitBytes) throw new Error('cache metadata exceeds snapshot budget');
  objects.sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
  const selected = [...metadata];
  for (const object of objects) if (bytes + object.bytes <= limitBytes) {
    bytes += object.bytes; selected.push(...object.files);
  }
  mkdirSync(destination); // Never reuse or replace an existing snapshot.
  for (const file of selected) {
    const target = join(destination, relative(root, file.path));
    mkdirSync(dirname(target), { recursive: true });
    linkSync(file.path, target);
  }
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
