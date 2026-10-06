// Optional build-time inputs for the native environment. No executable, shell
// tool, or adjacent SQLite file is needed by the deployed application.
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, writeFileSync, renameSync, rmSync, readdirSync, lstatSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readRegular, sha256} from './dependencies.mjs';
import {isMain} from '../../runtime/cli.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LOCK = join(ROOT, 'conformance/agent4/native-dependencies.lock.json');
const sha3 = bytes => createHash('sha3-256').update(bytes).digest('hex');
const fail = message => { throw new Error(`NativeDependencyRejected: ${message}`); };
function lockAt(path = LOCK) {
  const bytes = readRegular(path, 65536), lock = JSON.parse(bytes);
  if (lock.format !== 'agent-native-dependencies/v1' || lock.sqlite?.license !== 'public-domain' ||
      !/^3\.\d+\.\d+$/.test(lock.sqlite.version) ||
      Object.keys(lock.sqlite.files).sort().join(',') !== 'sqlite3.c,sqlite3.h') fail('unsupported native dependency contract');
  return {bytes, sqlite: lock.sqlite};
}
function license(header) {
  const notice = header.match(/^\/\*\n([\s\S]*?)\*{20,}/)?.[1];
  if (!notice?.includes('The author disclaims copyright')) fail('SQLite license missing');
  return notice.split('\n').map(line => line.replace(/^\*\* ?/, '')).join('\n').trim() + '\n';
}
function verifyFiles(source, selected) {
  if (!lstatSync(source).isDirectory() || lstatSync(source).isSymbolicLink()) fail('SQLite source must be a real directory');
  if (readdirSync(source).sort().join(',') !== 'LICENSE,sqlite3.c,sqlite3.h') fail('unexpected SQLite source inventory');
  for (const [name, expected] of Object.entries(selected.files)) {
    const bytes = readRegular(join(source, name), 16 * 1024 * 1024);
    if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) fail(`SQLite ${name} changed`);
    if (name === 'sqlite3.c' && sha3(bytes) !== selected.amalgamationSha3_256) fail('SQLite release source mismatch');
  }
  const header = readRegular(join(source, 'sqlite3.h')).toString();
  if (!header.includes(`#define SQLITE_VERSION        "${selected.version}"`) || !header.includes(`"${selected.sourceId}"`)) fail('SQLite release identity mismatch');
  if (readRegular(join(source, 'LICENSE'), 65536).toString() !== license(header)) fail('SQLite license binding mismatch');
}

export function verifyNativeDependency(source, {lockPath = LOCK} = {}) {
  const selected = lockAt(lockPath);
  verifyFiles(source, selected.sqlite);
  return {version: selected.sqlite.version, sourceId: selected.sqlite.sourceId, lockSha256: sha256(selected.bytes), files: selected.sqlite.files};
}

export async function provisionNativeDependency(paths, {offline = false, verifyOnly = false, lockPath = LOCK} = {}) {
  const selected = lockAt(lockPath), source = join(paths.input, 'sqlite');
  if (existsSync(source)) return {source, observation: verifyNativeDependency(source, {lockPath})};
  if (verifyOnly) fail('missing native SQLite source; provision with setup --native');
  const expected = selected.sqlite.archive;
  const archivePath = join(paths.input, `${expected.root}.zip`);
  let archive;
  if (existsSync(archivePath)) archive = readRegular(archivePath, 4 * 1024 * 1024);
  else {
    if (offline) fail('missing authenticated native archive');
    const response = await fetch(expected.url, {redirect: 'error', signal: AbortSignal.timeout(120000)});
    if (!response.ok || new URL(response.url).protocol !== 'https:') fail('SQLite acquisition failed');
    const parts = [];
    let total = 0;
    for await (const part of response.body) {
      total += part.length;
      if (total > expected.bytes || total > 4 * 1024 * 1024) fail('SQLite archive capacity');
      parts.push(part);
    }
    archive = Buffer.concat(parts, total);
  }
  if (archive.length !== expected.bytes || sha256(archive) !== expected.sha256 || sha3(archive) !== expected.sha3_256) fail('SQLite archive identity mismatch');
  mkdirSync(paths.input, {recursive: true});
  if (!existsSync(archivePath)) writeFileSync(archivePath, archive, {flag: 'wx', mode: 0o644});
  // The exact archive is authenticated before invoking the build-only unzip
  // tool. Extract just the two declared regular-file byte streams, not paths.
  const command = args => execFileSync('unzip', args, {encoding: null, timeout: 30000, maxBuffer: 16 * 1024 * 1024});
  const names = command(['-Z1', archivePath]).toString().trim().split('\n').sort();
  const expectedNames = ['/', '/sqlite3.c', '/sqlite3.h', '/sqlite3ext.h', '/shell.c'].map(suffix => expected.root + suffix).sort();
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) fail('SQLite archive members mismatch');
  mkdirSync(paths.temporary, {recursive: true});
  const staged = mkdtempSync(join(paths.temporary, 'native-sqlite-'));
  try {
    for (const name of Object.keys(selected.sqlite.files)) writeFileSync(join(staged, name), command(['-p', archivePath, `${expected.root}/${name}`]), {flag: 'wx', mode: 0o644});
    writeFileSync(join(staged, 'LICENSE'), license(readRegular(join(staged, 'sqlite3.h')).toString()), {flag: 'wx', mode: 0o644});
    verifyFiles(staged, selected.sqlite);
    renameSync(staged, source);
  } finally { rmSync(staged, {recursive: true, force: true}); }
  return {source, observation: verifyNativeDependency(source, {lockPath})};
}

if (isMain(import.meta)) {
  const [command, source, ...rest] = process.argv.slice(2);
  if (command !== 'verify' || !source || rest.length) fail('expected verify SOURCE');
  console.log(JSON.stringify(verifyNativeDependency(resolve(source))));
}
