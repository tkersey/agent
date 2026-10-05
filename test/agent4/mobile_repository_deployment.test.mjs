// External qualification oracle: both hosts use the extracted production loader.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { certificates } from './mobility_tls_fixture.mjs';
import { artifactRoot } from './artifacts.mjs';

const gitEnv = { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 'Deployment fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Deployment fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };

test('installed CLI and v2 deployment run all modes through two TLS hosts and a real browser', { timeout: 900000 }, async t => {
  const area = await mkdtemp(join(tmpdir(), 'mobile deployed application '));
  let child, childExit, origin, browser, provider;
  t.after(async () => {
    if (browser) await browser.close();
    if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await childExit; }
    if (origin) await origin.close();
    if (provider) { provider.closeAllConnections(); await new Promise(r => provider.close(r)); }
    await rm(area, { recursive: true, force: true });
  });
  const name = 'agent-v4.0.0-dev.0-resumable-interactions-v1';
  execFileSync('tar', ['-xzf', resolve(process.env.AGENT4_ARCHIVE ?? `${artifactRoot}/agent4-release/${name}.tar.gz`), '-C', area]);
  const root = join(area, name), load = path => import(pathToFileURL(join(root, path)));
  await rm(join(root, 'test'), { recursive: true, force: true });
  const { encodeValue, decodeSchema } = await load('runtime/values.mjs');
  const { hash } = await load('runtime/mobility/protocol.mjs');
  const { requirement } = await load('runtime/mobility/policy.mjs');
  const { schemas: mobilitySchemas } = await load('runtime/mobility/values.mjs');
  const { verifyRuntime } = await load('tools/agent4/dependencies.mjs');
  const { selectZig } = await load('tools/agent4/toolchain.mjs');
  const { openDeployment } = await load('runtime/mobility/deployment.mjs');
  const { PeerClient } = await load('runtime/mobility/transport.mjs');
  const cli = join(root, 'runtime/mobility/cli.mjs');
  const cliEnv = { ...process.env, PATH: '/nonexistent' }; delete cliEnv.NODE_TEST_CONTEXT;
  const command = (...args) => JSON.parse(execFileSync(process.execPath, [cli, ...args], { cwd: root, env: cliEnv, encoding: 'utf8', timeout: 240000, maxBuffer: 4 << 20, stdio: ['ignore', 'pipe', 'pipe'] }));
  const json = async (path, value) => { await writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); return path; };
  const source = join(area, 'source'); await mkdir(source); await mkdir(join(source, 'src'));
  const correct = await readFile(new URL('../../src/model_json.zig', import.meta.url), 'utf8'), target = 'src/model_json.zig';
  await writeFile(join(source, target), correct.replace('.bool => 5,', '.bool => 4,'));
  const git = await realpath('/usr/bin/git');
  const sourceGit = (...args) => execFileSync(git, ['-C', source, ...args], { env: gitEnv, encoding: 'utf8' }).trim();
  sourceGit('init', '--quiet'); sourceGit('add', '.'); sourceGit('commit', '--quiet', '-m', 'incorrect boolean bound');
  const base = sourceGit('rev-parse', 'HEAD'), directory = join(area, 'managed');
  const provision = await json(join(area, 'provision.json'), { directory, sourceGitDirectory: join(source, '.git'), base, gitExecutable: git,
    repository: 'fixture', generation: '1', managedRef: 'refs/heads/agent/result', readPaths: [target], writablePaths: [target] });
  const imported = command('provision-repository', provision);
  assert.throws(() => command('provision-repository', provision), 'provisioning cannot replace an existing store');
  const store = { directory, gitExecutable: git, repository: 'fixture', generation: '1', manifestSha256: imported.manifestSha256 };
  const toolchain = selectZig([]), helpers = {};
  for (const [key, file] of [['launcher', 'agent-check-limit'], ['processLock', 'libagent-check-lock.dylib']]) {
    const path = join(root, 'examples/native', file); helpers[key] = { path, sha256: hash(await readFile(path)) };
  }
  const checkProfile = JSON.parse(await readFile(join(root, 'runtime/repository-profiles/agent.model-json-bounds.v1.json')));
  const sandbox = { zigExecutable: toolchain.executable, libraryDirectory: toolchain.identity.library, ...helpers,
    scratchRoot: area, timeoutMs: 30000, maximumOutputBytes: 262144, scratchBytes: 256 << 20 };
  const qualification = command('qualify-check', await json(join(area, 'check.json'), { sandbox, checkProfile }));
  assert.equal(qualification.kind, 'qualified'); assert.equal(qualification.profile.id, checkProfile.id);
  console.log('deployment: installed provisioning and runner qualification passed');
  const requiredProfiles = [{ id: checkProfile.id, profileDigest: qualification.profile.digest, runner: qualification.runner }];
  const examples = join(root, 'examples'), schemaPaths = {}, schemas = {};
  for (const [group, names] of [
    ['repository-approval', ['preparation', 'proposal', 'delivery', 'check-result', 'human', 'human-reply', 'identifier', 'boolean']],
    ['mobile-repository', ['session', 'task', 'report', 'snapshot-request', 'snapshot', 'read', 'evidence', 'read-window', 'read-window-result', 'candidate-preparation', 'cleanup', 'unit', 'model-request', 'model-result', 'review', 'review-answer', 'next-task', 'next-task-answer']],
  ]) for (const name of names) { schemaPaths[name] = join(examples, group, name + '.bin'); schemas[name] = decodeSchema(await readFile(schemaPaths[name])); }
  const imagePath = join(examples, 'mobile-repository/session.bpi3'), image = await readFile(imagePath);
  const metadata = (operation, input, output, role) => ({ operation, payloadSchema: schemaPaths[input], resultSchema: schemaPaths[output], role,
    subject: 'fixture', subjectVersion: operation.startsWith('agent.repository.') && !['interaction', 'approval'].includes(role) ? imported.manifestSha256 : null,
    scope: operation, audience: ['approval', 'interaction'].includes(role) ? 'human' : null, trustDomain: 'fixture',
    tenants: ['tenant'], principals: ['user'], classification: ['shared'], allowedStateLabels: ['shared'], cleanup: false });
  const requirementFor = async metadata => requirement({ ...metadata, payloadSchema: await readFile(metadata.payloadSchema), resultSchema: await readFile(metadata.resultSchema) });
  const query = metadata('agent.repository.snapshot.v1', 'snapshot-request', 'snapshot', 'read');
  const human = metadata('agent.interaction.exchange.v1.repository.publish', 'human', 'human-reply', 'approval');
  const placement = required => [[[required], [[], { tag: 0, value: null }, { tag: 0, value: null }, 8n << 20n]], 'placement', 'shared', [4, 1]];
  const task = [1n, 0n, 1, 'Bounded change', 'fixture', base, target, placement(await requirementFor(query)), placement(await requirementFor(human)),
    ['fixture-model', [{ tag: 1, value: 512 }, { tag: 0, value: null }, { tag: 0, value: null }]], 8, 1, 7n];
  const initialArgs = encodeValue(schemas.session, [task, 1]);
  const taskPath = join(area, 'initial.bin'); await writeFile(taskPath, initialArgs);
  const identity = verifyRuntime(resolve(process.env.AGENT_MOBILITY_RUNTIME)), world = await import(pathToFileURL(identity.entrypoint));
  const kernel = await world.Kernel.create({ bytes: await readFile(identity.kernelPath), expectedSha256: identity.kernelSha256 });
  kernel.setLimits({ input: 8 << 20, working: 64 << 20, output: 8 << 20 });
  const prepared = kernel.prepare(image), session = kernel.start(prepared, initialArgs);
  const first = world.decodeOutcome(kernel.drive(session, { checkpoint: true }));
  const programId = Buffer.from((await world.decodeRequest(first.request)).programIdentity).toString('hex');
  kernel.checkpoint(session, { transfer: true }); kernel.releasePrepared(prepared);
  const protectedImages = [{ image: hash(image), program: programId }], common = { store, protectedImages,
    authorizationDigest: '1'.repeat(64), validationPolicyDigest: '2'.repeat(64), requiredProfiles, checkResultSchema: schemaPaths['check-result'] };
  let modelCalls = 0, providerFailure;
  const beforeDigest = hash(Buffer.from(correct.replace('.bool => 5,', '.bool => 4,')));
  provider = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const request = JSON.parse(Buffer.concat(chunks)), turn = request.input.filter(item => item.type === 'function_call').length; modelCalls++;
      const actions = [['edit', { operation: 'replace', path: target, old_digest: beforeDigest, content: correct }], ['check', {}], ['finish', { summary: 'Boolean bound repaired and independently checked.' }]];
      assert(turn < actions.length);
      const [name, args] = turn === 0 && !request.tools.some(tool => tool.name === 'edit')
        ? ['finish', { summary: 'Inspected the incorrect boolean bound; inspect mode makes no change.' }] : actions[turn];
      res.end(JSON.stringify({ status: 'completed', error: null, output: [{ type: 'function_call', id: `function-${turn}`, status: 'completed', call_id: `call-${turn}`, name, arguments: JSON.stringify(args) }] }));
    } catch (error) { providerFailure = error; res.statusCode = 500; res.end('{}'); }
  });
  await new Promise(r => provider.listen(0, '127.0.0.1', r));
  const binding = (meta, adapter) => ({ ...meta, adapter });
  const release = { ...metadata('agent.repository.investigation-release.v1', 'cleanup', 'unit', 'read'), cleanup: true };
  const cleanupPath = join(area, 'cleanup.bin'); await writeFile(cleanupPath, encodeValue(mobilitySchemas.requirements, [await requirementFor(release)]));
  const publicationHelper = { path: join(root, 'examples/native/agent-publication-gate'), sha256: hash(await readFile(join(root, 'examples/native/agent-publication-gate'))) };
  const W = [
    ...[['snapshot', 'snapshot-request', 'snapshot'], ['read', 'read', 'evidence'], ['read-window', 'read-window', 'read-window-result'], ['prepare', 'candidate-preparation', 'proposal']].map(([op, input, output]) =>
      binding(metadata(`agent.repository.${op}.v1`, input, output, op === 'prepare' ? 'write' : 'read'), { kind: op === 'prepare' ? 'repository-prepare' : 'repository-query', store, classification: ['shared'] })),
    binding(metadata('agent.repository.check.v1', 'proposal', 'check-result', 'write'), { kind: 'repository-check', store, sandbox, checkProfile,
      profile: { owner: 'W', repository: 'fixture', generation: '1', manifest: imported.manifestSha256, profileId: checkProfile.id, profileDigest: qualification.profile.digest, runner: qualification.runner,
        disclosure: { audience: null, labels: ['shared'] }, allowance: { attempts: 1, request_bytes: 4 << 20, concurrent: 1 } } }),
    binding(metadata('agent.repository.proposal.v1', 'preparation', 'proposal', 'write'), { kind: 'repository-proposal', ...common,
      commit: { author: { name: 'Fixture', email: 'fixture@example.invalid' }, committer: { name: 'Fixture', email: 'fixture@example.invalid' }, timestamp: 1791150000, message: 'Checked boolean bound' } }),
    ...[['agent.repository.publication-current.v1', 'boolean', 'read'], ['agent.repository.publish.v1', 'delivery', 'commit']].map(([op, out, role]) => binding(metadata(op, 'proposal', out, role),
      { kind: 'repository-publication', ...common, helper: publicationHelper })),
    binding(metadata('agent.model.invoke.v4', 'model-request', 'model-result', 'model'), { kind: 'openai-responses-replay', owner: 'W', mode: 'loopback-fixture',
      endpoint: `http://127.0.0.1:${provider.address().port}/v1/responses`, credentialEnv: null, model: 'fixture-model', parameters: { maxOutputTokens: 512, temperature: null, reasoning: null }, timeoutMs: 10000,
      maximumRequestBytes: 2 << 20, maximumResponseBytes: 2 << 20, disclosure: { audience: null, policyRevision: 'p1', labels: ['shared'] }, allowance: { attempts: 3, request_bytes: 16 << 20, output_tokens: 3072, concurrent: 1 } }),
    binding(release, { kind: 'repository-release' }),
  ];
  const U = [binding(metadata('agent.approval.issue.v1.repository.publish', 'proposal', 'identifier', 'approval'), { kind: 'repository-approval-issuer' }),
    binding(human, { kind: 'repository-approval-human', revision: 'approval-1', principalIds: { user: '7' } }),
    binding(metadata('agent.repository.review.v1', 'review', 'review-answer', 'interaction'), { kind: 'repository-review-human', revision: 'review-1' }),
    binding(metadata('agent.repository.next-task.v1', 'next-task', 'next-task-answer', 'interaction'), { kind: 'repository-next-task-human', revision: 'next-1', modes: ['inspect', 'propose', 'publish'] }),
    binding(release, { kind: 'repository-release' })];
  const pairs = Object.fromEntries(['issuer', 'U', 'W'].map(name => [name, generateKeyPairSync('ed25519')]));
  for (const [name, pair] of Object.entries(pairs)) for (const [kind, type] of [['public', 'spki'], ['private', 'pkcs8']])
    await writeFile(join(area, `${name}.${kind}.pem`), pair[kind + 'Key'].export({ type, format: 'pem' }), { mode: 0o600 });
  const tls = await certificates(area), limits = { maximum_moves: 4, maximum_image_bytes: 8 << 20, maximum_outcome_bytes: 8 << 20 };
  const configs = {};
  for (const host of ['U', 'W']) {
    const cert = host === 'U' ? 'A' : 'B', peer = host === 'U' ? 'W' : 'U';
    configs[host] = { format: 'agent-mobility-deployment/v2', hostId: host, trustDomain: 'fixture', revision: 'p1', worldRuntime: resolve(process.env.AGENT_MOBILITY_RUNTIME),
      directory: join(area, host + '-journal'), deploymentGeneration: '1', execution: host === 'U' ? 'browser' : 'node',
      keys: Object.keys(pairs).map(owner => ({ keyId: owner, owner, status: 'active', publicKey: join(area, `${owner}.public.pem`) })),
      signer: { keyId: host, privateKey: join(area, `${host}.private.pem`), policyRevision: 'p1' },
      deployments: [{ imageDigest: hash(image), programId, tenant: 'tenant', principals: ['user'], issuers: ['issuer'], hosts: ['U', 'W'], classification: ['shared'],
        cleanup: cleanupPath, controlPeers: ['U', 'W'], limits, exportPolicies: { shared: ['U', 'W'] } }],
      bindings: host === 'U' ? U : W, labelDestinations: { shared: ['U', 'W'] }, revoked: [],
      peers: [{ hostId: peer, url: 'https://127.0.0.1:1', servername: 'localhost', fingerprint256: tls[peer === 'U' ? 'A' : 'B'].fingerprint256 }],
      tls: { key: join(area, 'tls', cert + '.key'), cert: join(area, 'tls', cert + '.pem'), ca: join(area, 'tls/ca.pem'), host: '127.0.0.1', port: 0 },
      catalogue: { issuer: { id: host === 'U' ? 'issuer' : 'W', keyId: host === 'U' ? 'issuer' : 'W', privateKey: join(area, `${host === 'U' ? 'issuer' : 'W'}.private.pem`) }, entries: [] } };
  }
  configs.U.browser = { directory: join(area, 'sessions'), audience: 'human', host: '127.0.0.1', port: 0, publicOrigin: null };
  configs.U.catalogue.entries.push({ id: 'repository', title: 'Qualified repository', image: imagePath, programId, taskSchema: schemaPaths.session, reportSchema: schemaPaths.report, initialTask: taskPath,
    modes: ['inspect', 'propose', 'publish'], principals: [{ tenant: 'tenant', principal: 'user', taskPrincipal: '7' }],
    scope: { read: [target], write: [target], checks: [checkProfile.id], target: 'refs/heads/agent/result' }, profile: checkProfile.id, presentation: { audience: 'human', labels: ['shared'], revision: 'p1' } });
  const configU = await json(join(area, 'U.json'), configs.U), configW = join(area, 'W.json');
  command('init', configU); assert.equal(command('tasks', configU, 'user', 'tenant')[0].defaultMode, 'propose');
  const runs = ['inspect', 'propose', 'publish'].map(mode => ({ mode,
    run: command('task', configU, 'user', 'tenant', 'repository', mode, 'Investigate and repair the boolean JSON-size bound within the selected mode.') }));
  origin = await openDeployment(configU); const service = await origin.serve();
  configs.W.peers[0].url = service.url; await json(configW, configs.W); command('init', configW);
  console.log('deployment: both v2 configurations initialized');
  let stdout = '', stderr = '';
  child = spawn(process.execPath, [cli, 'serve', configW], { cwd: root, env: cliEnv, stdio: ['ignore', 'pipe', 'pipe'] }); childExit = once(child, 'exit');
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('workspace startup timeout: ' + stderr)), 240000);
    child.once('exit', code => { clearTimeout(timer); reject(Error(`workspace exited ${code}: ${stderr}`)); });
    child.stderr.on('data', bytes => { stderr += bytes; });
    child.stdout.on('data', bytes => { stdout += bytes; for (const line of stdout.split('\n')) { try { const value = JSON.parse(line); if (value.listening) { clearTimeout(timer); resolve(value); } } catch {} } });
  });
  origin.peers.get('W').close(); origin.peers.set('W', new PeerClient({ url: ready.listening, servername: 'localhost', fingerprint256: tls.B.fingerprint256, ca: tls.ca, key: tls.A.key, cert: tls.A.cert }));
  const { chromium } = await import(pathToFileURL(join(resolve(process.env.AGENT_MOBILITY_BROWSER_TOOLS), 'node_modules/playwright-core/index.mjs')));
  browser = await chromium.launch({ headless: true }); const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
  const login = command('login-issue', configU, 'user', 'tenant');
  await page.goto(service.browser_url + '/login'); await page.locator('#credential').fill(login.credential); await page.locator('#login button').click(); await page.waitForURL(service.browser_url + '/');
  let approvals = 0;
  for (const { mode, run } of runs) {
    await page.locator('#run').fill(run.run_id); await page.locator('#connect').click(); await page.locator('#status').filter({ hasText: 'Connected' }).waitFor();
    for (let attempt = 0; attempt < 800 && origin.custodian.status(run.run_id).custody !== 'TERMINAL'; attempt++) {
      if (providerFailure) throw providerFailure;
      if (await page.locator('#answer').isVisible()) {
        const choices = await page.locator('#choice option').evaluateAll(options => options.map(option => option.value));
        if (choices.includes('approve')) { assert.equal(mode, 'publish'); assert.match(await page.locator('#question').textContent(), /Passed/); await page.locator('#choice').selectOption('approve'); approvals++; }
        else if (choices.includes('finish')) await page.locator('#choice').selectOption('finish');
        else { assert(choices.includes('stop')); await page.locator('#choice').selectOption('stop'); }
        await page.locator('#answer button').click();
      } else await page.locator('#continue').click();
      await page.waitForFunction(() => !document.querySelector('#continue').disabled);
      await new Promise(r => setTimeout(r, 50));
    }
    assert.equal(origin.custodian.status(run.run_id).custody, 'TERMINAL', stderr + '\n' + await page.locator('#request').textContent());
    if (mode !== 'publish') assert.equal(execFileSync(git, ['--git-dir=' + join(directory, 'objects.git'), 'rev-parse', 'refs/heads/agent/result'], { env: gitEnv, encoding: 'utf8' }).trim(), base);
  }
  assert.equal(approvals, 1); assert.equal(modelCalls, 7);
  assert.equal(sourceGit('rev-parse', 'HEAD'), base); assert.equal(sourceGit('status', '--porcelain'), '');
  const managed = (...args) => execFileSync(git, ['--git-dir=' + join(directory, 'objects.git'), ...args], { env: gitEnv, encoding: 'utf8' }).trim();
  const commit = managed('rev-parse', 'refs/heads/agent/result'); assert.notEqual(commit, base);
  assert.equal(managed('show', `${commit}:${target}`), correct.trim());
  child.kill('SIGTERM'); const [code, signal] = await childExit; assert.equal(code, 0, stderr); assert.equal(signal, null);
  const stats = JSON.parse(stdout.trim().split('\n').at(-1)).statistics;
  assert.equal(stats['agent.repository.check.v1'].calls, 2); assert.equal(stats['agent.repository.publish.v1'].calls, 1);
});
