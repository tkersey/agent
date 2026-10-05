// First application slice: actual World continuation, independently expected
// evidence and retained inquiry. Custodian, real adapters and UI qualify later.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { verifyRuntime, readDependencyLock } from '../../tools/agent4/dependencies.mjs';
import { decodeSchema, decodeValue, encodeValue } from '../../runtime/values.mjs';
import { placement, resolution, observation, zeroDigest } from './mobility_fixture.mjs';
import { provisionRepository, createManagedRepositoryEnvironment } from '../../runtime/repository.mjs';

const [runtimePath, imagesPath] = process.argv.slice(2);
assert(runtimePath && imagesPath);
const identity = verifyRuntime(resolve(runtimePath));
const world = await import(pathToFileURL(identity.entrypoint));
const kernelBytes = await readFile(identity.kernelPath);
const image = await readFile(join(imagesPath, 'program.bpi3'));
const schema = async name => decodeSchema(await readFile(join(imagesPath, `${name}.schema`)));
const taskSchema = await schema('task'), reportSchema = await schema('report');
const limit = readDependencyLock().world.runtime.physicalProfile.maximumMemoryBytes;
const make = async () => {
  const kernel = await world.Kernel.create({ bytes: kernelBytes, expectedSha256: identity.kernelSha256 });
  kernel.setLimits({ input: limit, working: limit, output: limit });
  return { kernel, prepared: kernel.prepare(image) };
};
const snapshot = ['project', 'import-1', 0, 'a'.repeat(40), 'b'.repeat(40), Array(32).fill(1), Array(32).fill(2), ['shared'], 'workspace'];
const evidence = [snapshot[5], 'src/ordinary.zig', Array(32).fill(3), 'pub const answer: u32 = 42;\n', false];
const goal = 'Explain the admitted source before proposing a change.';
const humanAnswer = 'Keep this value; investigate its callers next.';

async function scenario({ local = false, moves = 2, cancelReturn = false, mode = 0, invalid = null, leaf = null, selectedSnapshot = snapshot, selectedEvidence = evidence } = {}) {
  const task = [731n, 19n, mode, goal, selectedSnapshot[0], selectedSnapshot[3], selectedEvidence[1], placement(local ? 'A' : 'B', moves, 'repository'), placement('A', 16, 'human')];
  if (invalid === 'generation') task[1] = 0n;
  if (invalid === 'empty-goal') task[3] = '';
  if (invalid === 'attempts') task[7][3][1] = 4;
  const initial = encodeValue(taskSchema, task);
  let current = await make(), session = current.kernel.start(current.prepared, initial), host = 'A';
  let bytes = current.kernel.drive(session, { checkpoint: true });
  let transfers = 0, cleanups = 0, questions = 0, epoch = 0n, cancelled = false;
  const trace = [];
  try {
    for (let step = 0; step < 64; step++) {
      const out = world.decodeOutcome(bytes);
      if (['completed', 'failed', 'cancelled'].includes(out.kind)) {
        assert.equal(cleanups, invalid ? 0 : 1, 'the original owned investigation cleans up exactly once');
        if (invalid) {
          assert.equal(out.kind, 'failed'); assert.deepEqual(trace, [], 'invalid intake performs no effects');
        } else if (cancelReturn) {
          assert.equal(out.kind, 'cancelled'); assert.equal(questions, 0);
        } else if (!local && moves === 1) {
          assert.equal(out.kind, 'failed'); assert.equal(questions, 0);
          assert.equal(transfers, 1, 'the human template cannot replenish the spent move budget');
        } else {
          assert.equal(out.kind, 'completed'); assert.equal(questions, 1);
          assert.deepEqual(decodeValue(reportSchema, out.value), [731n, 19n, mode, moves - transfers, [[1n, [goal, selectedEvidence, humanAnswer]]]]);
          assert.equal(transfers, local ? 0 : 2);
        }
        return { mode, local, moves, cancelReturn, invalid, realRepository: leaf !== null, outcome: out.kind, transfers, cleanups, trace };
      }
      if (out.kind === 'progressed' || out.kind === 'yielded') {
        bytes = current.kernel.drive(session, { control: out.kind === 'yielded' ? 'resume_yield' : 'none', checkpoint: true });
        continue;
      }
      assert.equal(out.kind, 'requested');
      const request = await world.decodeRequest(out.request);
      const payload = decodeValue(decodeSchema(request.payloadSchema), request.payload);
      trace.push([host, request.semanticIdentity]);
      let reply;
      switch (request.semanticIdentity) {
        case 'agent.mobility.resolve.v1': reply = resolution(payload, host, identity.kernelSha256); break;
        case 'agent.mobility.relocate.v1': {
          if (cancelReturn && transfers === 1 && !cancelled) {
            cancelled = true;
            bytes = current.kernel.drive(session, { control: 'cancel_text', value: 'cancel retained investigation', checkpoint: true });
            continue;
          }
          assert.notEqual(payload[0], host);
          const checkpoint = current.kernel.checkpoint(session, { transfer: true });
          assert.deepEqual(checkpoint, out.state);
          assert.throws(() => current.kernel.drive(session), { code: 'WORLD_HANDLE_INVALID' });
          current.kernel.releasePrepared(current.prepared);
          assert.equal(current.kernel.usage().workingLive, 0n);
          current = await make(); host = payload[0]; transfers++; epoch++;
          session = current.kernel.restore(current.prepared, checkpoint);
          assert.deepEqual(current.kernel.drive(session, { checkpoint: true }), bytes, 'restore exposes the exact pending successor');
          reply = { tag: 0, value: [host, epoch, `transfer-${epoch}`, zeroDigest, observation(host, identity.kernelSha256)] };
          break;
        }
        case 'agent.repository.snapshot.v1':
          assert.equal(host, local ? 'A' : 'B'); assert.deepEqual(payload, [selectedSnapshot[0], selectedSnapshot[3]]); reply = leaf ? await leaf.snapshot(payload) : selectedSnapshot; break;
        case 'agent.repository.read.v1':
          assert.equal(host, local ? 'A' : 'B'); assert.deepEqual(payload, [selectedSnapshot, selectedEvidence[1]]); reply = leaf ? await leaf.read(payload) : selectedEvidence; break;
        case 'agent.repository.human.v1':
          assert.equal(host, 'A'); assert.deepEqual(payload, [731n, 19n, goal, selectedEvidence]);
          questions++; reply = humanAnswer; break;
        case 'agent.repository.investigation-release.v1':
          assert.deepEqual(payload, [731n, 19n], 'cleanup retains the original task occurrence');
          cleanups++; reply = null; break;
        default: assert.fail(`unexpected operation ${request.semanticIdentity}`);
      }
      bytes = current.kernel.drive(session, { control: 'reply', value: await world.encodeResult(out.request, encodeValue(decodeSchema(request.resumeSchema), reply)), checkpoint: true });
    }
    assert.fail('bounded application did not terminate');
  } finally {
    current.kernel.close(session); current.kernel.releasePrepared(current.prepared);
    assert.equal(current.kernel.usage().workingLive, 0n);
  }
}
const results = [];
for (const mode of [0, 1, 2]) results.push(await scenario({ mode }));
results.push(await scenario({ local: true }), await scenario({ moves: 1 }), await scenario({ cancelReturn: true }));
for (const invalid of ['generation', 'empty-goal', 'attempts']) results.push(await scenario({ invalid }));
const area = await mkdtemp(join(tmpdir(), 'mobile repository-'));
try {
  const source = join(area, 'source'); await mkdir(join(source, 'src'), { recursive: true });
  await writeFile(join(source, evidence[1]), evidence[3]);
  const git = (...args) => execFileSync('git', ['-C', source, '-c', 'core.hooksPath=/dev/null', ...args], {
    encoding: 'utf8', env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' },
  }).trim();
  git('init', '--quiet'); git('add', '.'); git('commit', '--quiet', '-m', 'admitted source');
  const options = { directory: join(area, 'managed'), sourceGitDirectory: join(source, '.git'), base: git('rev-parse', 'HEAD'),
    gitExecutable: await realpath(execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim()),
    repository: 'project', generation: 'import-1', managedRef: 'refs/heads/agent/delivery', readPaths: [evidence[1]], writablePaths: [evidence[1]] };
  const receipt = await provisionRepository(options);
  const leaf = await createManagedRepositoryEnvironment({ ...options, ...receipt, resourceOwner: 'workspace', classification: ['shared'] });
  const selectedSnapshot = await leaf.snapshot(['project', options.base]), selectedEvidence = await leaf.read([selectedSnapshot, evidence[1]]);
  assert.equal(selectedEvidence[3], evidence[3]);
  for (const [method, inputName, outputName, input] of [
    ['list', 'list', 'listing', [selectedSnapshot, '', '']],
    ['search', 'search', 'search-result', [selectedSnapshot, 'answer', '', '']],
    ['readWindow', 'read-window', 'read-window-result', [selectedSnapshot, evidence[1], 0n, 32768]],
  ]) {
    const inputSchema = await schema(inputName), outputSchema = await schema(outputName);
    const admitted = decodeValue(inputSchema, encodeValue(inputSchema, input));
    const value = await leaf[method](admitted);
    const decoded = decodeValue(outputSchema, encodeValue(outputSchema, value));
    assert.deepEqual(decoded[0], method === 'readWindow' ? selectedEvidence : selectedSnapshot[5]);
    if (method === 'list') {
      assert.equal(decoded[1][0][0], evidence[1]); assert.equal(decoded[3], 1n);
    } else if (method === 'search') {
      assert.equal(decoded[1][0][0], evidence[1]); assert.equal(decoded[1][0][2], 1n);
    } else assert.equal(decoded[2], BigInt(Buffer.byteLength(evidence[3])));
  }
  results.push(await scenario({ leaf, selectedSnapshot, selectedEvidence }));
  assert.equal(git('status', '--porcelain'), '');
} finally { await rm(area, { recursive: true, force: true }); }
console.log(JSON.stringify({ check: 'mobile-repository-continuation', kernel: identity.kernelSha256, imageBytes: image.length, results }));
