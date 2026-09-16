import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, access, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { inquiryCli } from '../../runtime/inquiry_cli.mjs';
import { reset, monotonic } from '../consumers/inquiry/fixtures/cases.mjs';

const describe = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item);
const runtime = resolve(process.env.AGENT4_WORLD_RUNTIME ?? '.agent4/out/world-runtime');
const images = resolve(process.env.AGENT4_INQUIRY_IMAGES ?? 'zig-out/agent4/inquiry');
const action = (name, args) => ({ type: 'function_call', status: 'completed', call_id: 'reused-provider-id', name, arguments: JSON.stringify(args) });

test('unsupported host selection refuses experiment execution', () => {
  // Exercise the unsupported-platform selector in a separate process on every
  // host. This is branch coverage, not a claim of a Linux execution qualification.
  const module = new URL('../../runtime/inquiry.mjs', import.meta.url).href;
  const result = execFileSync(process.execPath, ['--input-type=module', '-e',
    `Object.defineProperty(process, 'platform', { value: 'linux' });
     const { createInquiryExecutor } = await import(${JSON.stringify(module)});
     console.log(JSON.stringify(await createInquiryExecutor()));`], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(result), { kind: 'unavailable', reason: 'unsupported_host' });
});

test('opt-in dispatcher preserves checkpoints, human authority and explicit allowances', {
  timeout: 120_000,
  skip: process.platform !== 'darwin' ? 'inquiry execution unavailable: macOS Seatbelt profile required' : false,
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'inquiry-live-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, 'subject'); await mkdir(target); await writeFile(join(target, 'session.mjs'), reset);
  let requests = 0;
  const server = createServer(async (req, res) => {
    const parts = []; for await (const part of req) parts.push(part);
    const body = JSON.parse(Buffer.concat(parts)); requests++;
    assert.equal(body.model, 'local-fixture-model'); assert.equal(req.headers.authorization, undefined);
    assert.equal(body.input[2].content, reset);
    const context = body.input[4].content;
    const initial = context.includes('Investigation 0;');
    const output = initial ? [action('hypothesis', { explanation: 'An ordinary synthetic explanation; test the proposed source.' })]
      : [action('repair', { source: monotonic, observation: Number(context.match(/observation (\d+)/)[1]) })];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'completed', error: null, output }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const config = {
    name: 'local-dispatch-fixture', corpus: 'synthetic-cli-contract', worldRuntime: runtime, images,
    targetRoot: target, strategy: 'inquiry', provider: { endpoint: `http://127.0.0.1:${server.address().port}/v1/responses`, model: 'local-fixture-model' },
    profile: 'macos-seatbelt-session-v1', allowance: { modelRequests: 4, experiments: 2,
      requestBytes: 256000, elapsedMs: 30000, modelTimeoutMs: 5000 },
    task: { investigations: 1, passes: 4, modelTurns: 3, reusable: true, explore: false, intent: 'artifact', principal: '7' },
  };
  const path = join(root, 'config.json');
  const save = () => writeFile(path, JSON.stringify(config)); await save();
  await assert.rejects(inquiryCli(['run', '--config', path, '--out', '--allow-write']), /missing argument value/);
  const run = (name, extra = []) => inquiryCli(['run', '--config', path, '--out', join(root, name), ...extra]);
  const paused = await run('paused');
  assert.equal(paused.status, 'inference-not-authorized'); assert.equal(requests, 0);
  const origin = join(root, 'paused', paused.checkpoint);
  const original = await readFile(origin);
  const finished = await run('artifact', ['--from', origin, '--authorize-inference']);
  assert.equal(finished.status, 'completed', describe(finished)); assert.equal(finished.resultTag, 9);
  assert.equal(requests, 2); assert.equal(finished.modelRequests, 2); assert.equal(finished.experiments, 1);
  assert.equal(finished.executorMetrics.physicalExecutions, 16);
  assert.equal(await readFile(join(target, 'session.mjs'), 'utf8'), reset);
  assert.equal(await readFile(join(root, 'artifact/replacement.mjs'), 'utf8'), monotonic);
  const diffTarget = join(root, 'diff-check'); await mkdir(diffTarget);
  await writeFile(join(diffTarget, 'session.mjs'), reset);
  execFileSync('git', ['apply', join(root, 'artifact/repair.diff')], { cwd: diffTarget });
  assert.equal(await readFile(join(diffTarget, 'session.mjs'), 'utf8'), monotonic);
  assert.deepEqual(await readFile(origin), original);
  const staleResult = join(root, 'artifact/0000.ers2');
  const wrongBoundary = join(root, 'artifact/0001.pko2');
  const stale = await run('stale', ['--from', wrongBoundary, '--result', staleResult, '--authorize-inference']);
  assert.equal(stale.status, 'failed'); assert.equal(stale.modelRequests, 0);

  config.task.intent = 'ask'; await save();
  const intent = await run('intent'); assert.equal(intent.status, 'awaiting-human');
  const choiceFile = join(root, 'intent.ers2'), intentState = join(root, 'intent', intent.checkpoint);
  await inquiryCli(['answer', '--config', path, '--from', intentState, '--choice', 'deliver', '--out', choiceFile]);
  const approval = await run('approval', ['--from', intentState, '--result', choiceFile, '--authorize-inference']);
  assert.equal(approval.status, 'awaiting-human', describe(approval)); assert.equal(approval.approvals, 1);
  assert.equal(await readFile(join(root, 'approval/replacement.mjs'), 'utf8'), monotonic);
  assert.equal(await readFile(join(target, 'session.mjs'), 'utf8'), reset);
  const approvalState = join(root, 'approval', approval.checkpoint), grant = join(root, 'approval.ers2');
  await inquiryCli(['answer', '--config', path, '--from', approvalState, '--choice', 'approve', '--out', grant]);
  const pendingWrite = await run('pending-write', ['--from', approvalState, '--result', grant]);
  assert.equal(pendingWrite.status, 'write-not-authorized'); assert.equal(pendingWrite.writes, 0);
  const delivered = await run('delivered', ['--from', join(root, 'pending-write', pendingWrite.checkpoint), '--allow-write']);
  assert.equal(delivered.status, 'completed', describe(delivered)); assert.equal(delivered.resultTag, 0);
  assert.equal(await readFile(join(target, 'session.mjs'), 'utf8'), monotonic);

  await writeFile(join(target, 'session.mjs'), reset);
  config.task.intent = 'artifact'; config.allowance.modelRequests = 1; await save();
  const bounded = await run('bounded', ['--authorize-inference']);
  assert.equal(bounded.status, 'cancelled', describe(bounded)); assert.equal(bounded.resourceStop, true);
  assert.equal(bounded.modelRequests, 1); assert.equal(bounded.experiments, 0); assert.equal(bounded.cleanups, 1);
  assert.equal(await readFile(join(target, 'session.mjs'), 'utf8'), reset);

  config.allowance.modelRequests = 4; await save();
  const corpus = join(root, 'corpus.json'); await writeFile(corpus, JSON.stringify(['config.json']));
  const compared = await inquiryCli(['compare', '--corpus', corpus, '--out', join(root, 'comparison'), '--authorize-inference']);
  assert.equal(compared.results.length, 2);
  assert(compared.results.every(row => row.status === 'completed'), describe(compared));
  const reports = await Promise.all(compared.results.map(row => readFile(join(root, 'comparison', row.report), 'utf8').then(JSON.parse)));
  assert.deepEqual(reports.map(r => r.resultTag), [9, 9]);
  assert.deepEqual(reports.map(r => r.modelRequests), [2, 1]);
  assert.equal(reports[0].subjectSha256, reports[1].subjectSha256);
  assert.equal(await readFile(join(target, 'session.mjs'), 'utf8'), reset);
  await assert.rejects(run('artifact'), /EEXIST/);
  config.provider.endpoint += '?key=not-a-secret'; await save();
  await assert.rejects(run('invalid-endpoint'), /endpoint cannot embed/);
  await assert.rejects(access(join(root, 'invalid-endpoint')));
  config.provider.endpoint = config.provider.endpoint.split('?')[0]; await save();
  await writeFile(join(root, 'outside.mjs'), reset);
  await rm(join(target, 'session.mjs'));
  await symlink(join(root, 'outside.mjs'), join(target, 'session.mjs'));
  const before = requests;
  const escaped = await run('symlink', ['--authorize-inference']);
  assert.equal(escaped.status, 'failed'); assert.equal(escaped.modelRequests, 0); assert.equal(requests, before);
  const badCorpus = await inquiryCli(['compare', '--corpus', corpus, '--out', join(root, 'bad-corpus'), '--authorize-inference']);
  assert.deepEqual(badCorpus.results.map(r => r.status), ['input-unavailable', 'input-unavailable']);
  assert.equal(requests, before);
});
