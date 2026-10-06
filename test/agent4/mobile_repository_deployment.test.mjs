// External qualification oracle: both hosts use the extracted production loader.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { generateKeyPairSync, randomBytes, createPrivateKey } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm, realpath, stat } from 'node:fs/promises';
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
  let child, childExit, childClosed, origin, browser, provider;
  t.after(async () => {
    if (browser) await browser.close();
    if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await childExit; }
    if (origin) await origin.close();
    if (provider) { provider.closeAllConnections(); await new Promise(r => provider.close(r)); }
    await rm(area, { recursive: true, force: true });
  });
  const name = 'agent-v4.0.0-dev.0-resumable-interactions-v1';
  const archive = resolve(process.env.AGENT4_ARCHIVE ?? `${artifactRoot}/agent4-release/${name}.tar.gz`);
  execFileSync('tar', ['-xzf', archive, '-C', area]);
  const root = join(area, name), load = path => import(pathToFileURL(join(root, path)));
  await rm(join(root, 'test'), { recursive: true, force: true });
  const { decodeSchema, decodeValue } = await load('runtime/values.mjs');
  const { hash, canonical } = await load('runtime/mobility/protocol.mjs');
  const { selectZig } = await load('tools/agent4/toolchain.mjs');
  const { openDeployment } = await load('runtime/mobility/deployment.mjs');
  const { PeerClient } = await load('runtime/mobility/transport.mjs');
  const cli = join(root, 'runtime/mobility/cli.mjs');
  const cliEnv = { ...process.env, PATH: '/nonexistent' }; delete cliEnv.NODE_TEST_CONTEXT;
  const privateSentinel = 'host-only-' + randomBytes(32).toString('hex'); cliEnv.OPENAI_API_KEY = privateSentinel;
  const commandLogs = [];
  const operatorCommands = [], uiOperations = [];
  const command = (...args) => {
    const started = performance.now(), row = { command: args[0], status: 'failed' }; operatorCommands.push(row);
    try {
      const output = execFileSync(process.execPath, [cli, ...args], { cwd: root, env: cliEnv, encoding: 'utf8', timeout: 240000, maxBuffer: 4 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
      // One-use login delivery is intentionally secret-bearing operator output,
      // not an application log. It is consumed and never retained here.
      if (args[0] !== 'login-issue') commandLogs.push(output);
      const result = JSON.parse(output); row.status = 'passed'; return result;
    } catch (error) { commandLogs.push(String(error.stdout ?? ''), String(error.stderr ?? '')); throw error; }
    finally { row.durationMs = Math.round(performance.now() - started); }
  };
  const templatePath = join(area, 'template.json'); command('repository-template', templatePath);
  const template = JSON.parse(await readFile(templatePath)); assert.equal(template.provider.enabled, false);
  assert.throws(() => command('repository-template', templatePath));
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
  const image = await readFile(join(root, 'examples/mobile-repository/session.bpi3'));
  const sessionSchema = decodeSchema(await readFile(join(root, 'examples/mobile-repository/session.bin')));
  let modelCalls = 0, providerFailure, rejectPreparation = false;
  const beforeDigest = hash(Buffer.from(correct.replace('.bool => 5,', '.bool => 4,')));
  provider = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const request = JSON.parse(Buffer.concat(chunks)), turn = request.input.filter(item => item.type === 'function_call').length; modelCalls++;
      assert.equal(req.headers.authorization, undefined); assert.equal(JSON.stringify(request).includes(privateSentinel), false);
      assert.deepEqual(request.reasoning, { effort: 'medium', summary: 'auto' });
      const actions = [['edit', { operation: 'replace', path: target, old_digest: rejectPreparation ? '0'.repeat(64) : beforeDigest, content: correct }], ['check', {}], ['finish', { summary: 'Boolean bound repaired and independently checked.' }]];
      assert(turn <= actions.length);
      const [name, args] = turn === 0 ? ['ask', { question: 'Confirm the bounded scope before continuing.' }]
        : !request.tools.some(tool => tool.name === 'edit') && turn === 1
          ? ['finish', { summary: 'Inspected the incorrect boolean bound; inspect mode makes no change.' }] : actions[turn - 1];
      res.end(JSON.stringify({ status: 'completed', error: null, output: [{ type: 'function_call', id: `function-${turn}`, status: 'completed', call_id: `call-${turn}`, name, arguments: JSON.stringify(args) }] }));
    } catch (error) { providerFailure = error; res.statusCode = 500; res.end('{}'); }
  });
  await new Promise(r => provider.listen(0, '127.0.0.1', r));
  const providerProfile = { kind: 'openai-responses-replay', owner: 'W', mode: 'loopback-fixture',
    endpoint: `http://127.0.0.1:${provider.address().port}/v1/responses`, credentialEnv: null, model: 'fixture-model',
    parameters: { maxOutputTokens: 512, temperature: null, reasoning: { effort: 'medium', summary: 'auto' } }, timeoutMs: 10000,
    maximumRequestBytes: 2 << 20, maximumResponseBytes: 2 << 20, disclosure: { audience: 'fixture-provider', policyRevision: 'p1', labels: ['shared'] },
    allowance: { attempts: 4, request_bytes: 16 << 20, output_tokens: 3072, concurrent: 1 } };
  const pairs = Object.fromEntries(['issuer', 'U', 'W'].map(name => [name, generateKeyPairSync('ed25519')]));
  for (const [name, pair] of Object.entries(pairs)) for (const [kind, type] of [['public', 'spki'], ['private', 'pkcs8']])
    await writeFile(join(area, `${name}.${kind}.pem`), pair[kind + 'Key'].export({ type, format: 'pem' }), { mode: 0o600 });
  const tls = await certificates(area);
  const hostInput = (host, cert) => ({ hostId: host, keyId: host, publicKey: join(area, `${host}.public.pem`), privateKey: join(area, `${host}.private.pem`),
    installation: root, worldRuntime: resolve(process.env.AGENT_MOBILITY_RUNTIME), directory: join(area, host + '-journal'), deploymentGeneration: '1',
    url: 'https://127.0.0.1:1', servername: 'localhost', fingerprint256: tls[cert].fingerprint256,
    tls: { key: join(area, 'tls', cert + '.key'), cert: join(area, 'tls', cert + '.pem'), ca: join(area, 'tls/ca.pem'), host: '127.0.0.1', port: 0 },
    ...(host === 'U' ? { browser: { directory: join(area, 'sessions'), audience: 'human', host: '127.0.0.1', port: 0, publicOrigin: null } } : {}) });
  const setup = { ...template, trustDomain: 'fixture', revision: 'p1', label: 'shared', store,
    check: join(area, 'check.json'), qualification: await json(join(area, 'qualification.json'), qualification),
    issuer: { id: 'issuer', keyId: 'issuer', publicKey: join(area, 'issuer.public.pem'), privateKey: join(area, 'issuer.private.pem') },
    principal: { tenant: 'tenant', principal: 'user', taskPrincipal: '7' }, origin: hostInput('U', 'A'), workspace: hostInput('W', 'B'),
    task: { path: target, steps: 8, checks: 1, maximumTasks: 1, moves: 6 }, provider: { enabled: true, profile: providerProfile },
    commit: { author: { name: 'Fixture', email: 'fixture@example.invalid' }, committer: { name: 'Fixture', email: 'fixture@example.invalid' }, timestamp: 1791150000, message: 'Checked boolean bound' } };
  const setupPath = await json(join(area, 'setup.json'), setup), generated = command('configure-repository', setupPath, join(area, 'configured'));
  assert.match(generated.programId, /^[a-f0-9]{64}$/); assert.equal(generated.image, hash(image)); assert.equal(generated.tasksEnabled, true);
  assert.throws(() => command('configure-repository', setupPath, join(area, 'configured')));
  const generatedTask = decodeValue(sessionSchema, await readFile(join(area, 'configured/initial.bin')));
  assert.deepEqual(generatedTask[0].slice(4, 7), ['fixture', base, target]); assert.equal(generatedTask[0][2], 1);
  const disabled = command('configure-repository', await json(join(area, 'disabled.json'), { ...setup, provider: { enabled: false, profile: null } }), join(area, 'disabled'));
  assert.equal(disabled.tasksEnabled, false);
  assert.equal(JSON.parse(await readFile(disabled.origin)).catalogue.entries.length, 0);
  assert.equal(JSON.parse(await readFile(disabled.workspace)).bindings.some(row => row.adapter.kind === 'openai-responses-replay'), false);
  for (const [name, changed, reason] of [
    ['scope', { ...setup, task: { ...setup.task, path: 'not-granted.zig' } }, 'RepositorySetupScope'],
    ['limits', { ...setup, task: { ...setup.task, checks: 17 } }, 'RepositorySetupLimits'],
    ['principal', { ...setup, principal: { ...setup.principal, taskPrincipal: 7 } }, 'RepositorySetupPrincipal'],
  ]) {
    const target = join(area, 'rejected-' + name), config = await json(join(area, name + '.json'), changed);
    assert.throws(() => command('configure-repository', config, target), error => error.status === 1 && error.stderr.trim() === reason);
    await assert.rejects(stat(target), { code: 'ENOENT' });
  }
  const configU = generated.origin, configW = generated.workspace;
  const workspaceConfig = JSON.parse(await readFile(configW));
  const localValidation = command('validate', configU);
  assert.equal(localValidation.storage, 'not-opened'); assert.equal(localValidation.peerContact, false);
  for (const path of [setup.origin.directory, setup.origin.browser.directory, setup.workspace.directory]) await assert.rejects(stat(path), { code: 'ENOENT' });
  const missingHuman = JSON.parse(await readFile(configU)); missingHuman.bindings = missingHuman.bindings.filter(row => row.operation !== 'agent.repository.human.v1');
  const missingPath = await json(join(area, 'configured/missing-human.json'), missingHuman);
  assert.throws(() => command('validate', missingPath), error => error.status === 1 && JSON.parse(error.stdout).reason === 'RepositoryCapabilityMissing' && JSON.parse(error.stdout).operation === 'agent.repository.human.v1');
  command('init', configU); assert.equal(command('tasks', configU, 'user', 'tenant')[0].defaultMode, 'propose');
  origin = await openDeployment(configU); let service = await origin.serve();
  workspaceConfig.peers[0].url = service.url;
  const checkSandbox = workspaceConfig.bindings.find(row => row.adapter.kind === 'repository-check').adapter.sandbox;
  const scratchRoot = checkSandbox.scratchRoot;
  checkSandbox.scratchRoot = join(area, 'not-provisioned'); await json(configW, workspaceConfig);
  assert.equal(command('validate', configW).valid, true);
  command('init', configW); assert.deepEqual(command('status', configW), []);
  assert.throws(() => command('serve', configW), error => String(error.stderr).includes('EnvironmentUnavailable'),
    'inspection needs no physical qualification, but serving must qualify before listening');
  checkSandbox.scratchRoot = scratchRoot;
  // Independently granted bindings may share one qualified execution profile.
  const checkBinding = workspaceConfig.bindings.find(row => row.adapter.kind === 'repository-check');
  for (const scope of ['other-check-1', 'other-check-2']) workspaceConfig.bindings.push({ ...structuredClone(checkBinding), scope, principals: [scope] });
  await json(configW, workspaceConfig);
  console.log('deployment: both v2 configurations initialized');
  let stdout = '', stderr = '';
  child = spawn(process.execPath, [cli, 'serve', configW], { cwd: root, env: cliEnv, stdio: ['ignore', 'pipe', 'pipe'] }); childExit = once(child, 'exit'); childClosed = once(child, 'close');
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('workspace startup timeout: ' + stderr)), 240000);
    child.once('exit', code => { clearTimeout(timer); reject(Error(`workspace exited ${code}: ${stderr}`)); });
    child.stderr.on('data', bytes => { stderr += bytes; });
    child.stdout.on('data', bytes => { stdout += bytes; for (const line of stdout.split('\n')) { try { const value = JSON.parse(line); if (value.listening) { clearTimeout(timer); resolve(value); } } catch {} } });
  });
  origin.peers.get('W').close(); origin.peers.set('W', new PeerClient({ url: ready.listening, servername: 'localhost', fingerprint256: tls.B.fingerprint256, ca: tls.ca, key: tls.A.key, cert: tls.A.cert }));
  const connectedConfig = JSON.parse(await readFile(configU)); connectedConfig.peers[0].url = ready.listening; await json(configU, connectedConfig);
  // The deployed qualifier owns the ordinary origin service. No browser drives
  // this probe, so its wait deadline must retain an unexecuted, uncancelled run.
  connectedConfig.tls.port = Number(new URL(service.url).port);
  await origin.close(); origin = null; await json(configU, connectedConfig);
  const qualificationCase = id => ({ id, entry: 'repository', base, mode: 'inspect', goal: 'Inspect the approved snapshot.', expected: { kind: 'completed', proposalTree: null, published: false } });
  const mixedWorkspace = structuredClone(workspaceConfig), unrelatedModel = structuredClone(workspaceConfig.bindings.find(row => row.adapter.kind === 'openai-responses-replay'));
  Object.assign(unrelatedModel, { subject: 'unrelated-repository', scope: 'unrelated-model', principals: ['unrelated-user'] });
  Object.assign(unrelatedModel.adapter, { mode: 'openai-live', endpoint: 'https://api.openai.com/v1/responses', credentialEnv: 'UNUSED_QUALIFICATION_KEY' });
  unrelatedModel.subjectVersion = hash(canonical(unrelatedModel.adapter));
  mixedWorkspace.bindings.push(unrelatedModel);
  const mixedPeer = await json(join(area, 'configured/mixed-workspace.json'), mixedWorkspace);
  for (const [scenario, lane, expectedFailure] of [
    ['fixture', 'live', 'QualificationProviderMode'], ['live', 'deployed', 'QualificationProviderMode'],
    ['stale', 'live', 'TransportStatus'], ['unversioned', 'deployed', 'QualificationProviderVersion'],
  ]) {
    const declaration = structuredClone(mixedWorkspace);
    const selected = declaration.bindings.find(row => row.adapter.kind === 'openai-responses-replay');
    if (scenario === 'live' || scenario === 'stale') {
      Object.assign(selected.adapter, { mode: 'openai-live', endpoint: 'https://api.openai.com/v1/responses', credentialEnv: 'UNUSED_QUALIFICATION_KEY' });
      selected.subjectVersion = hash(canonical(selected.adapter));
    }
    if (scenario === 'unversioned') selected.subjectVersion = null;
    const peer = await json(join(area, `configured/wrong-${scenario}-workspace.json`), declaration);
    const input = await json(join(area, `wrong-${scenario}.json`), { format: 'agent.repository.qualification/v1', lanes: [lane], source: null,
      maximumSeconds: 1, external: { origin: configU, peers: [peer], principal: 'user', tenant: 'tenant', cases: [qualificationCase('wrong-provider-mode')] } });
    const output = join(area, `wrong-${scenario}`);
    assert.throws(() => command('qualify-application', input, output, `--${lane}`), error => error.status === 1);
    assert.equal(JSON.parse(await readFile(join(output, 'report.json'))).failure, expectedFailure);
    assert.deepEqual(command('status', configU), []); assert.equal(modelCalls, 0);
  }
  const applicationQualification = await json(join(area, 'application-qualification.json'), { format: 'agent.repository.qualification/v1', lanes: ['deployed'], source: null,
    maximumSeconds: 1, external: { origin: configU, peers: [mixedPeer], principal: 'user', tenant: 'tenant', cases: [qualificationCase('waiting-person'), qualificationCase('not-started')] } });
  const qualificationOutput = join(area, 'application-qualification');
  assert.throws(() => command('qualify-application', applicationQualification, qualificationOutput, '--deployed'), error => error.status === 1);
  const qualified = JSON.parse(await readFile(join(qualificationOutput, 'report.json')));
  assert.equal(qualified.complete, false); assert.equal(qualified.lanes[0].cases[0].status, 'incomplete');
  assert.equal(qualified.lanes[0].cases[1].status, 'not-run');
  const waiting = command('status', configU, qualified.lanes[0].cases[0].run_id);
  assert.equal(waiting.custody, 'ACTIVE'); assert.equal(waiting.cancellation_pending, false); assert.equal(modelCalls, 0);
  command('cancel', configU, waiting.run_id, 'qualification fixture cleanup');
  const runs = [...['inspect', 'propose', 'publish'].map(mode => ({ mode })), { mode: 'propose', rejected: true }].map(({ mode, rejected = false }) => ({ mode, rejected,
    run: command('task', configU, 'user', 'tenant', 'repository', mode, 'Investigate and repair the boolean JSON-size bound within the selected mode.') }));
  origin = await openDeployment(configU); service = await origin.serve();
  const runsBeforeValidation = origin.journal.recover().map(({ run }) => run.run_id);
  const connectedValidation = command('validate', configU, configW, '--peers');
  assert(connectedValidation.capabilityCoverage.some(row => row.host === 'W' && row.verified === 'authenticated-preflight'));
  assert.deepEqual(origin.journal.recover().map(({ run }) => run.run_id), runsBeforeValidation); assert.equal(modelCalls, 0);
  const { chromium } = await import(pathToFileURL(join(resolve(process.env.AGENT_MOBILITY_BROWSER_TOOLS), 'node_modules/playwright-core/index.mjs')));
  browser = await chromium.launch({ headless: true }); const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
  const login = command('login-issue', configU, 'user', 'tenant');
  await page.goto(service.browser_url + '/login'); await page.locator('#credential').fill(login.credential); await page.locator('#login button').click(); await page.waitForURL(service.browser_url + '/');
  let approvals = 0, clarifications = 0;
  for (const { mode, run, rejected } of runs) {
    rejectPreparation = rejected; const callsBefore = modelCalls;
    let cancelledAfterRestart = false;
    const actions = { mode, runFieldFills: 1, connect: 1, continue: 0, unchangedStateContinue: 0, choices: 0, answerFieldFills: 0, submits: 0 }; uiOperations.push(actions);
    await page.locator('#run').fill(run.run_id); await page.locator('#connect').click(); await page.locator('#status').filter({ hasText: 'Connected' }).waitFor();
    for (let attempt = 0; attempt < 800 && origin.custodian.status(run.run_id).custody !== 'TERMINAL'; attempt++) {
      if (providerFailure) throw providerFailure;
      // ask, edit and check are separate model turns; check performs preparation.
      if (rejected && modelCalls >= callsBefore + 3) {
        const status = command('status', configW, run.run_id);
        if (status.operation === 'agent.repository.prepare.v1' && status.occurrence === 'UNKNOWN') {
          child.kill('SIGTERM'); const [code, signal] = await childExit; assert.equal(code, 0, stderr); assert.equal(signal, null);
          await childClosed; assert.match(stderr, /RepositoryPreimage/);
          const restored = await openDeployment(configW, { qualifyChecks: false });
          try {
            await restored.custodian.cancelRun(run.run_id, 'rejected preparation');
            await restored.custodian.run(run.run_id);
            assert.equal(restored.custodian.status(run.run_id).custody, 'TERMINAL');
            const saved = restored.custodian.outcome(run.run_id);
            assert.equal(restored.world.decodeOutcome(saved.bytes).kind, 'cancelled');
            assert.equal(restored.statistics()['agent.repository.prepare.v1'].calls, 0);
            assert.equal(restored.statistics()['agent.repository.investigation-release.v1'].calls, 1);
          } finally { await restored.close(); }
          cancelledAfterRestart = true; break;
        }
      }
      if (await page.locator('#answer').isVisible()) {
        const choices = await page.locator('#choice option').evaluateAll(options => options.map(option => option.value));
        actions.choices++;
        if (choices.includes('approve')) { assert.equal(mode, 'publish'); assert.match(await page.locator('#question').textContent(), /Passed/); await page.locator('#choice').selectOption('approve'); approvals++; }
        else if (choices.includes('respond')) { assert.match(await page.locator('#question').textContent(), /Confirm the bounded scope/); await page.locator('#answer-text').fill('Proceed within the granted scope.'); await page.locator('#choice').selectOption('respond'); clarifications++; actions.answerFieldFills++; }
        else if (choices.includes('finish')) await page.locator('#choice').selectOption('finish');
        else { assert(choices.includes('stop')); await page.locator('#choice').selectOption('stop'); }
        await page.locator('#answer button').click(); actions.submits++;
      } else {
        const before = JSON.stringify(origin.custodian.status(run.run_id)); actions.continue++; await page.locator('#continue').click();
        await page.waitForFunction(() => !document.querySelector('#continue').disabled);
        if (before === JSON.stringify(origin.custodian.status(run.run_id))) actions.unchangedStateContinue++;
      }
      await page.waitForFunction(() => !document.querySelector('#continue').disabled);
      await new Promise(r => setTimeout(r, 50));
    }
    if (rejected) { assert.equal(cancelledAfterRestart, true); assert.equal(modelCalls, callsBefore + 3); continue; }
    assert.equal(origin.custodian.status(run.run_id).custody, 'TERMINAL', stderr + '\n' + await page.locator('#request').textContent());
    const exported = command('export', configU, 'user', 'tenant', run.run_id);
    assert.equal(exported.format, 'agent.repository.export/v1'); assert.equal(exported.run_id, run.run_id);
    assert.equal(exported.kind, 'completed'); assert.equal(exported.report[2], ['inspect', 'propose', 'publish'].indexOf(mode));
    assert.throws(() => command('export', configU, 'someone-else', 'tenant', run.run_id));
    if (mode !== 'publish') assert.equal(execFileSync(git, ['--git-dir=' + join(directory, 'objects.git'), 'rev-parse', 'refs/heads/agent/result'], { env: gitEnv, encoding: 'utf8' }).trim(), base);
  }
  assert.equal(approvals, 1); assert.equal(clarifications, 4); assert.equal(modelCalls, 13);
  assert.equal(sourceGit('rev-parse', 'HEAD'), base); assert.equal(sourceGit('status', '--porcelain'), '');
  const managed = (...args) => execFileSync(git, ['--git-dir=' + join(directory, 'objects.git'), ...args], { env: gitEnv, encoding: 'utf8' }).trim();
  const commit = managed('rev-parse', 'refs/heads/agent/result'); assert.notEqual(commit, base);
  assert.equal(managed('show', `${commit}:${target}`), correct.trim());
  assert.equal(child.exitCode, 0, stderr);
  const stats = JSON.parse(stdout.trim().split('\n').at(-1)).statistics;
  assert.equal(stats['agent.repository.check.v1'].calls, 2); assert.equal(stats['agent.repository.publish.v1'].calls, 1);
  assert.equal(stats['agent.repository.prepare.v1'].calls, 3);
  assert.deepEqual((await readdir(area)).filter(name => name.startsWith('agent-zig-')), [], 'qualification, repeated checks and service restart release all completed scratch ownership');
  const needles = [Buffer.from(privateSentinel)];
  for (const key of [...Object.values(pairs).map(pair => pair.privateKey), ...['A','B'].map(host => createPrivateKey(tls[host].key))]) {
    const seed = Buffer.from(key.export({ format: 'jwk' }).d, 'base64url'), pem = key.export({ format: 'pem', type: 'pkcs8' });
    needles.push(seed, Buffer.from(seed.toString('hex')), Buffer.from(seed.toString('base64url')), Buffer.from(pem), Buffer.from(JSON.stringify(pem).slice(1,-1)));
  }
  const artifacts = [image, gunzipSync(await readFile(archive)), Buffer.from(stdout), Buffer.from(stderr), ...commandLogs.map(value => Buffer.from(value))];
  for (const directory of [setup.origin.directory, setup.workspace.directory]) {
    const db = new DatabaseSync(join(directory, 'custody.sqlite'), { readOnly: true });
    try {
      for (const row of db.prepare('SELECT bytes FROM artifacts').all()) artifacts.push(Buffer.from(row.bytes));
      for (const row of db.prepare('SELECT offer, receipt FROM transfers').all()) for (const value of [row.offer,row.receipt]) if (value) artifacts.push(Buffer.from(value));
    } finally { db.close(); }
  }
  const persistence = await page.evaluate(async () => ({ local: Object.entries(localStorage), session: Object.entries(sessionStorage), cookie: document.cookie,
    caches: await caches.keys(), databases: (await indexedDB.databases()).map(row => row.name), rendered: document.body.textContent }));
  assert.deepEqual([persistence.local, persistence.session, persistence.cookie, persistence.caches, persistence.databases], [[], [], '', [], []]);
  artifacts.push(Buffer.from(JSON.stringify(persistence)));
  for (const bytes of artifacts) for (const needle of needles) assert.equal(bytes.includes(needle), false, 'host-only value entered a portable artifact, log or script-visible browser state');
  t.diagnostic(JSON.stringify({ inspectionMs: operatorCommands.filter(row => ['validate', 'init', 'status'].includes(row.command) && row.status === 'passed').map(({ command, durationMs }) => ({ command, durationMs })) }));
  if (process.env.AGENT_REPOSITORY_OPERATOR_PROOF) await writeFile(process.env.AGENT_REPOSITORY_OPERATOR_PROOF, JSON.stringify({
    format: 'mobile-repository-operator-actions/v1', sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    testSha256: hash(await readFile(import.meta.filename)), clientSha256: hash(await readFile(join(root, 'runtime/mobility/client.mjs'))), browser: browser.version(),
    method: 'Actual automated UI control activations/field fills for CLI-started tasks, including 50ms polling Continues. Unchanged-state clicks compare local custodian status before/after, not a causal or minimum-user-action count. All setup and negative-test CLI invocations are retained separately. No human-dwell or latency claim.',
    login: { credentialFieldFills: 1, submits: 1 }, uiOperations, operatorCommands, workspaceCalls: stats,
  }, null, 2) + '\n');
});
