// Build-time metadata only. The deployed executable never starts this tool.
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {selectZig} from './toolchain.mjs';
import {verifyNativeDependency} from './native-dependencies.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const args = process.argv.slice(2);
if (args.length !== 13) throw new Error('native-manifest: expected image, application, lock, three licenses, SQLite source/heap/flags, state quota, target, optimize, output');
const [imagePath, applicationPath, lockPath, agentLicense, worldLicense, boundaryLicense, sqliteSource, sqliteHeap, sqliteFlags, stateBytes, target, optimize, output] = args;
const image = readFileSync(imagePath), applicationBytes = readFileSync(applicationPath);
const application = JSON.parse(applicationBytes), lock = JSON.parse(readFileSync(lockPath));
if (application.program_sha256 !== hash(image)) throw new Error('native image binding mismatch');
const toolchain = selectZig([]);
const sqlite = verifyNativeDependency(sqliteSource);
sqlite.heap_bytes = Number(sqliteHeap);
sqlite.compile_flags = JSON.parse(sqliteFlags);
if (!Number.isSafeInteger(sqlite.heap_bytes) || sqlite.heap_bytes <= 0 || sqlite.heap_bytes > 16 * 1024 * 1024 || !Array.isArray(sqlite.compile_flags)) throw new Error('invalid native SQLite profile');
if (!Number.isSafeInteger(Number(stateBytes)) || Number(stateBytes) <= 1024 * 1024 || Number(stateBytes) > 256 * 1024 * 1024 || Number(stateBytes) % 4096 !== 0) throw new Error('invalid native state quota');
const {executableIdentity, libraryInventorySha256, libraryEntries, libraryBytes, version} = toolchain.identity;
const zigLicensePath = [resolve(dirname(toolchain.executable), 'LICENSE'), resolve(dirname(toolchain.executable), '../LICENSE'), resolve(toolchain.identity.library, '../LICENSE'), resolve(toolchain.identity.library, '../../LICENSE')]
  .find(path => existsSync(path) && readFileSync(path, 'utf8').includes('Copyright (c) Zig contributors'));
if (!zigLicensePath) throw new Error('selected Zig distribution license unavailable');
const manifest = {
  format: 'agent-native-build/v1',
  application_id: application.application_id,
  application_version: application.application_version,
  native_host_contract: 'agent-native-host/1.0',
  protocol: 'agent-host/1.0',
  client_mapping: 'agent-client-values/1.0',
  state_format: 'agent-native-state/3',
  state_database_bytes: Number(stateBytes),
  target, optimize,
  program_sha256: hash(image),
  program_identity: application.program_identity,
  application_assets_sha256: hash(applicationBytes),
  dependencies: {world: lock.world.commit, boundary: lock.boundary.commit, dependency_lock_sha256: hash(readFileSync(lockPath)), sqlite},
  compiler: {version, executable_sha256: executableIdentity.sha256, library_inventory_sha256: libraryInventorySha256, library_entries: libraryEntries, library_bytes: libraryBytes},
  runtime_dependencies: target.includes('macos') ? ['macOS system libSystem', 'readable executing artifact', 'OS trust roots for HTTPS'] : ['Linux kernel', 'procfs executing artifact handle', 'OS trust roots for HTTPS'],
  binary_identity: 'Final executable SHA-256 is recorded externally; this manifest does not authenticate itself.',
  signing: 'unsigned or toolchain ad-hoc; no release signing or notarization claimed',
  licenses: [
    {component: 'Agent', text: readFileSync(agentLicense, 'utf8')},
    {component: 'World', text: readFileSync(worldLicense, 'utf8')},
    {component: 'Boundary', text: readFileSync(boundaryLicense, 'utf8')},
    {component: 'Zig standard library', text: readFileSync(zigLicensePath, 'utf8')},
    {component: 'SQLite', text: readFileSync(resolve(sqliteSource, 'LICENSE'), 'utf8')},
  ],
};
if (target.includes('linux')) manifest.licenses.push({component: 'musl libc', text: readFileSync(resolve(toolchain.identity.library, 'libc/musl/COPYRIGHT'), 'utf8')});
toolchain.assertUnchanged();
writeFileSync(output, JSON.stringify(manifest));
