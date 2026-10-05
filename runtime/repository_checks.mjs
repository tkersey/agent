// Deployment-owned finite check contracts over the immutable repository owner.
// There is no cache, scheduler, approval, or workflow state in this adapter.
import { createHash } from 'node:crypto';
import { canonical } from './mobility/canonical.mjs';
import { admitDocumentPath } from './document.mjs';

const digest = value => createHash('sha256').update(canonical(value, 2 << 20)).digest('hex');
const hash = value => createHash('sha256').update(value).digest('hex');
const require = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };
const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...names].sort().join(',');
const text = (value, max) => typeof value === 'string' && value.isWellFormed() && Buffer.byteLength(value) <= max;

function admitProfile(input) {
  const p = structuredClone(input);
  require(keys(p, ['id', 'description', 'requiredPaths', 'modules', 'harness', 'expectedStdout', 'deterministic']), 'RepositoryCheckProfile');
  require(text(p.id, 96) && /^[a-z][a-z0-9.-]{0,95}$/.test(p.id) && text(p.description, 1024) && p.description.length > 0 &&
    typeof p.deterministic === 'boolean', 'RepositoryCheckProfile');
  require(Array.isArray(p.requiredPaths) && p.requiredPaths.length > 0 && p.requiredPaths.length <= 4096 &&
    new Set(p.requiredPaths).size === p.requiredPaths.length, 'RepositoryCheckProfile');
  p.requiredPaths.sort();
  for (const path of p.requiredPaths) {
    admitDocumentPath(path);
    require(!path.startsWith('__agent_checks__/') && path.endsWith('.zig'), 'RepositoryCheckProfile');
  }
  require(keys(p.harness, ['source', 'sha256']) && text(p.harness.source, 32768) &&
    hash(p.harness.source) === p.harness.sha256, 'RepositoryCheckHarness');
  require(text(p.expectedStdout, 32768), 'RepositoryCheckObservation');
  let observations;
  try { observations = JSON.parse(p.expectedStdout); } catch { require(false, 'RepositoryCheckObservation'); }
  require(Array.isArray(observations) && observations.length > 0 && observations.length <= 64 &&
    observations.every(value => typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= 0xffffffffffffffffn) &&
    JSON.stringify(observations) + '\n' === p.expectedStdout, 'RepositoryCheckObservation');
  require(Array.isArray(p.modules) && p.modules.length > 0 && p.modules.length <= 15 &&
    new Set(p.modules.map(m => m.name)).size === p.modules.length, 'RepositoryCheckModules');
  for (const module of p.modules) require(keys(module, ['name', 'path', 'dependencies']) &&
    text(module.name, 96) && /^[a-zA-Z][a-zA-Z0-9_]*$/.test(module.name) && !['root', 'std', 'builtin'].includes(module.name) &&
    p.requiredPaths.includes(module.path) && Array.isArray(module.dependencies) && module.dependencies.length <= 15 &&
    new Set(module.dependencies).size === module.dependencies.length &&
    module.dependencies.every(name => p.modules.some(m => m.name === name)), 'RepositoryCheckModules');
  return p;
}

export function createRepositoryCheckRunner({ store, sandbox, profiles }) {
  require(store && typeof store.checkInputs === 'function', 'RepositoryCheckStore');
  require(sandbox?.kind === 'qualified' && /^[a-f0-9]{64}$/.test(sandbox.runner) && typeof sandbox.execute === 'function', 'EnvironmentUnavailable');
  require(hash(JSON.stringify(sandbox.contract)) === sandbox.runner, 'RepositoryRunnerIdentity');
  require(Array.isArray(profiles) && profiles.length > 0 && profiles.length <= 16, 'RepositoryCheckProfiles');
  const admitted = new Map();
  for (const input of profiles) {
    const profile = admitProfile(input);
    require(!admitted.has(profile.id), 'RepositoryCheckProfiles');
    admitted.set(profile.id, { profile, digest: digest(profile) });
  }
  const selectedToolchain = sandbox.contract.toolchain;
  const runner = sandbox.runner, toolchain = { version: selectedToolchain.version,
    executableSha256: selectedToolchain.executableIdentity.sha256,
    libraryInventorySha256: selectedToolchain.libraryInventorySha256 };
  return Object.freeze({
    runner,
    profiles: Object.freeze([...admitted.values()].map(({ profile, digest }) => Object.freeze({ id: profile.id, digest,
      description: profile.description, deterministic: profile.deterministic }))),
    async check({ snapshot, candidate = null, profileId, occurrence, signal }) {
      require(text(occurrence, 128) && occurrence.length > 0, 'RepositoryCheckOccurrence');
      const selected = admitted.get(profileId);
      require(selected, 'RepositoryCheckProfileDenied');
      const started = performance.now();
      // Capture ordinary caller data before awaiting storage or compilation.
      const subject = structuredClone({ snapshot, candidate });
      const { profile, digest: profileDigest } = selected;
      const input = await store.checkInputs({ ...subject, requiredPaths: profile.requiredPaths });
      const files = { ...input.files, '__agent_checks__/main.zig': profile.harness.source };
      const roots = [{ name: 'root', path: '__agent_checks__/main.zig', dependencies: profile.modules.map(m => m.name) }, ...profile.modules];
      const inputDigest = digest(Object.keys(files).sort().map(path => [path, hash(files[path])]));
      const result = await sandbox.execute(files, { roots, signal, expectedStdout: profile.expectedStdout });
      require(result.runner === runner && ['Passed', 'Failed', 'Unavailable', 'TimedOut', 'Cancelled', 'InvalidOutput', 'Incomplete'].includes(result.status), 'RepositoryCheckResult');
      const record = { format: 'agent.repository.check/v1', occurrence, snapshot: subject.snapshot,
        candidate: subject.candidate?.id ?? null, tree: input.tree, profile: profile.id, profileDigest,
        runner, toolchain: structuredClone(toolchain), inputDigest, contractDigest: digest([profileDigest, runner, inputDigest]),
        status: result.status, completedChecks: result.status === 'Passed' ? [profile.id] : [],
        reusable: profile.deterministic && result.status === 'Passed',
        physicalExecutions: result.physicalExecutions, durationMs: Math.ceil(performance.now() - started),
        diagnostics: { phase: result.phase ?? null, exitCode: result.exitCode ?? null, signal: result.signal ?? null,
          outputBytes: result.outputBytes ?? 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '',
          compilationStdout: result.compilationStdout ?? '',
          reason: result.reason ?? null }, binarySha256: result.binarySha256 ?? null };
      return { ...record, id: digest(record) };
    },
  });
}
