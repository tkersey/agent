// Adaptive obligations through the existing copied binary, protocol and archive.
import assert from 'node:assert/strict';
import {createServer} from 'node:https';
import {X509Certificate} from 'node:crypto';
import {once} from 'node:events';
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {AgentClient} from '../../examples/native-minimal/stdio-client.mts';
import {certificates} from './mobility_tls_fixture.mjs';
import {readArchive, missingCaptures, tamperedAdaptiveControl} from './native_archive.mjs';
import {decodeValue} from '../../runtime/values.mjs';
import {hash} from '../../runtime/adaptive/codec.mjs';
import {application, configure} from '../../runtime/adaptive/environment.mjs';
import * as model from '../../runtime/adaptive/responses.mjs';
import * as preparation from '../../runtime/adaptive/preparation.mjs';
import * as work from '../../runtime/adaptive/work.mjs';
import {verifyRuntime} from '../../tools/agent4/dependencies.mjs';
import {measureAdaptive} from './adaptive_measurements.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, predicate) {
  for (let n = 0; n < 400; n++) {
    const value = await read(); if (predicate(value)) return value;
    assert(!['blocked', 'failed', 'unknown'].includes(value.status), `unexpected adaptive status ${JSON.stringify(value)}`);
    await delay(10);
  }
  assert.fail('adaptive task timeout');
}
const resultSchema = {root: 0, types: [{product: [1, 3]}, {array: {element: 2, length: 32}}, 'u8', 'bytes']};
function resultValue(bytes) {
  assert.equal(bytes.subarray(0, 8).toString(), 'ABL_ERS3');
  assert.equal(bytes.readBigUInt64LE(12), BigInt(bytes.length - 20));
  return Buffer.from(decodeValue(resultSchema, bytes.subarray(20))[1]);
}

export async function verifyAdaptiveNative({app, applicationPath, worldRuntime}) {
  const assetBytes = await readFile(applicationPath), asset = JSON.parse(assetBytes);
  const fixture = JSON.parse(Buffer.from(asset.resources.find(row => row.id === 'adaptive-agent.offline-responses').base64url, 'base64url'));
  const root = join(app.data, 'controlled snapshot'), state = join(app.data, 'controlled state'), configPath = join(app.data, 'adaptive.json');
  await mkdir(join(root, 'src'), {recursive: true});
  const source = 'pub fn main() void {\n    // The offline fixture has no external effects.\n}\n';
  await writeFile(join(root, 'src/main.zig'), source);
  const tls = await certificates(app.controller), trust = join(app.data, 'adaptive-root.der');
  await writeFile(trust, new X509Certificate(tls.ca).raw);
  const requests = [], requestTimes = [], sockets = new Set();
  let providerFailure, announceHeld, releaseHeld;
  const held = new Promise(resolve => { announceHeld = resolve; }), release = new Promise(resolve => { releaseHeld = resolve; });
  const server = createServer(tls.A, async (request, response) => {
    const started = performance.now();
    try {
      const chunks = []; for await (const bytes of request) chunks.push(bytes);
      const bytes = Buffer.concat(chunks), body = JSON.parse(bytes), index = requests.length;
      requests.push({bytes, body});
      assert(index < fixture.length); assert.equal(request.url, '/v1/responses'); assert.equal(request.headers.authorization, 'Bearer qualification-only');
      assert.equal(body.model, index >= 6 && index <= 8 ? 'fixture-model-b' : 'fixture-model-a');
      assert.equal(body.reasoning.effort, index >= 5 && index <= 8 ? 'high' : 'medium');
      assert.deepEqual(body.reasoning, {mode: 'standard', context: 'auto', effort: body.reasoning.effort});
      assert.equal(body.tools.length, 7); assert(!body.tools.some(tool => tool.name === 'inspect'));
      for (const key of ['store', 'stream', 'background', 'parallel_tool_calls']) assert.equal(body[key], false);
      assert.equal(body.truncation, 'disabled'); assert(!Object.hasOwn(body, 'previous_response_id') && !Object.hasOwn(body, 'conversation'));
      assert.equal(body.tool_choice.tools.some(tool => tool.name === 'inspect'), index >= 3 && index <= 6);
      if (index === 0) { announceHeld(); await release; }
      response.writeHead(200, {'content-type': 'application/json'}); response.end(JSON.stringify(fixture[index]));
      requestTimes.push(performance.now() - started);
    } catch (error) { providerFailure = error; response.writeHead(500); response.end('{}'); }
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const profile = (id, model) => ({id, model, reasoning_mode: 'standard', reasoning_context: 'auto', efforts: ['medium', 'high'], effort_update: false,
    explicit_cache: true, additional_tools: true, cache_diagnostics: true, opaque_family: 'fixture', max_output_tokens: 4096,
    request_bytes: 256 * 1024, response_bytes: 512 * 1024, timeout_ms: 10000});
  const skills = [];
  for (const id of ['repository-orientation', 'invariant-review', 'technical-reporting']) {
    const resource = asset.resources.find(row => row.id === id), markdown = join(app.data, `${id}.md`);
    await writeFile(markdown, Buffer.from(resource.base64url, 'base64url'));
    skills.push({id, version: '1', description: id, markdown, tools: Array.from({length: 8}, (_value, index) => id === 'invariant-review' && index === 7)});
  }
  const config = {workspace: 'adaptive-controlled', snapshot_root: root, endpoint: `https://127.0.0.1:${server.address().port}/v1/responses`, audience: 'controlled-adaptive',
    profiles: [profile('analysis', 'fixture-model-a'), profile('deep', 'fixture-model-b')], initial_profile: 'analysis', initial_effort: 'medium', skills,
    maximum_model_calls: 16, maximum_control_revision: 16};
  await writeFile(configPath, JSON.stringify(config));
  const invoke = (...args) => {
    const result = spawnSync(app.command, [...args, '--test-provider', '--trust-root', trust], {cwd: app.data, env: {PATH: '/nonexistent'}, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024});
    assert.equal(result.status, 0, result.error ?? `${result.stderr}\n${result.stdout}`); return JSON.parse(result.stdout);
  };
  let client;
  const launch = async extra => {
    client = new AgentClient(app.command, ['--state-dir', state, '--authorize-inference', '--test-provider', '--trust-root', trust, ...extra], {cwd: app.data, env: {PATH: '/nonexistent'}});
    await client.initialize(); return client;
  };
  const started = performance.now();
  try {
    invoke('validate', '--config', configPath); assert.equal(requests.length, 0);
    for (const [field, value] of [['id', 'review/guards'], ['version', '1.0.0+local']]) {
      const invalid = structuredClone(config), path = join(app.data, `invalid-skill-${field}.json`);
      invalid.skills[0][field] = value;
      await writeFile(path, JSON.stringify(invalid));
      const rejected = spawnSync(app.command, ['validate', '--config', path, '--test-provider', '--trust-root', trust],
        {cwd: app.data, env: {PATH: '/nonexistent'}, encoding: 'utf8', timeout: 10000});
      assert.equal(rejected.status, 64, `${field}: ${rejected.error ?? rejected.stdout}`);
      assert.equal(requests.length, 0, 'invalid catalog admission cannot dispatch inference');
    }
    const credential = join(app.data, 'synthetic-private-credential'), leakedConfig = join(app.data, 'credential-profile.json');
    await writeFile(credential, 'qualification-only\n', {mode: 0o600});
    await writeFile(leakedConfig, JSON.stringify({...config, endpoint: 'https://api.openai.com/v1/responses', workspace: 'qualification-only'}));
    const leaked = spawnSync(app.command, ['validate', '--config', leakedConfig, '--credential-file', credential],
      {cwd: app.data, env: {PATH: '/nonexistent'}, encoding: 'utf8', timeout: 10000});
    assert.equal(leaked.status, 64); assert(!`${leaked.stdout}${leaked.stderr}`.includes('qualification-only'));
    assert.equal(requests.length, 0, 'credential validation cannot dispatch inference');
    await launch(['--config', configPath]);
    const description = await client.call('describe');
    const accepted = await client.call('task.submit', {client_operation_id: 'adaptive-controlled-submit', application_id: 'adaptive-agent', profile_id: description.profile.id,
      input: {schema_id: 'adaptive-agent.input.v1', value: {task: 'Explain the fixture entry point using source evidence and exercise the approved adaptive controls.'}}});
    let timer;
    try { await Promise.race([held, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('provider hold timeout')), 15000); })]); }
    finally { clearTimeout(timer); }
    if (providerFailure) throw providerFailure;
    const pingStart = performance.now(); await client.call('ping', {}, 2000); const pingMs = performance.now() - pingStart;
    const statusStart = performance.now(); const heldStatus = await client.call('task.status', {task_id: accepted.task_id}, 2000); const statusMs = performance.now() - statusStart;
    assert.equal(heldStatus.profile_digest, accepted.profile_digest);
    const message = {client_operation_id: 'adaptive-held-followup', task_id: accepted.task_id,
      message: {schema_id: 'adaptive-agent.message.v1', value: {message: 'FOLLOWUP-A: distinguish observations from unrun checks.'}}};
    const queued = await client.call('task.message', message, 2000); assert.equal(queued.disposition, 'queued');
    assert.equal(requests.length, 1); assert(!requests[0].bytes.includes('FOLLOWUP-A'));
    releaseHeld();
    const waiting = await until(() => client.call('task.status', {task_id: accepted.task_id}), value => value.question != null);
    if (providerFailure) throw providerFailure;
    assert.equal(requests.length, 13); assert(requests[1].bytes.includes('FOLLOWUP-A'));
    assert(requests[7].bytes.includes('OPAQUE-SKILL-CONTEXT-6'));
    assert(!requests[8].bytes.includes('OPAQUE-SKILL-CONTEXT-6'));
    assert(!requests[8].body.input.some(item => item.type === 'additional_tools' && item.tools.some(tool => tool.name === 'inspect')));
    assert.equal(waiting.profile_digest, accepted.profile_digest);
    app.signal(client.child, 'SIGKILL'); await client.closed; client = null;
    await writeFile(join(root, 'src/main.zig'), 'changed after admission\n');
    const changedConfig = join(app.data, 'changed-adaptive.json');
    await writeFile(changedConfig, JSON.stringify({...config, initial_effort: 'high'}));
    const refused = spawnSync(app.command, ['resume', '--state-dir', state, '--task-id', accepted.task_id, '--config', changedConfig, '--test-provider', '--trust-root', trust],
      {cwd: app.data, env: {PATH: '/nonexistent'}, encoding: 'utf8', timeout: 10000});
    assert.equal(refused.status, 64); assert.equal(requests.length, 13);
    await launch(['--profile-task', accepted.task_id]);
    const reopenedDescription = await client.call('describe');
    assert.equal(reopenedDescription.profile.resource_identity, description.profile.resource_identity);
    const reopened = await client.call('task.status', {task_id: accepted.task_id});
    assert.deepEqual(reopened.question, waiting.question); assert.equal(requests.length, 13);
    await client.call('task.resume', {client_operation_id: 'adaptive-resume', task_id: accepted.task_id, expected_revision: reopened.revision});
    await client.call('task.respond', {client_operation_id: 'adaptive-answer', task_id: accepted.task_id,
      question_id: waiting.question.question_id, question_revision: waiting.question.question_revision, request_digest: waiting.question.request_digest,
      answer: {schema_id: waiting.question.answer_schema_id, value: {message: 'Focus on observable behavior.'}}});
    const result = await until(() => client.call('task.result', {task_id: accepted.task_id}), value => value.ready);
    if (providerFailure) throw providerFailure;
    assert.equal(requests.length, 14); assert.equal(result.outcome.value.control.selection.control_revision, '8');
    assert.equal(result.outcome.value.control.eviction_generation, '2'); assert.equal(result.outcome.value.evidence[0].sha256, hash(Buffer.from(source)));
    assert.deepEqual(await client.close(), {code: 0, signal: null}); client = null;
    const archivePath = join(app.data, 'adaptive-complete.bundle');
    invoke('export-checkpoint', '--state-dir', state, '--task-id', accepted.task_id, '--output', archivePath);
    const archiveBytes = await readFile(archivePath), archive = readArchive(archiveBytes);
    const importedState = join(app.data, 'adaptive imported');
    const imported = invoke('import-checkpoint', '--state-dir', importedState, '--input', archivePath, '--operation-id', 'adaptive-import');
    assert.equal(imported.task_id, accepted.task_id);
    assert.deepEqual(invoke('result', '--state-dir', importedState, '--task-id', accepted.task_id).outcome.value, result.outcome.value);
    const appData = application(assetBytes, archive.object(archive.task.image));
    assert.throws(() => configure(appData, {config: leakedConfig, credential}), /credential embedded in task profile/);
    const base = configure(appData, {testTrustRoot: trust}, {profile: archive.object(archive.task.profile), resources: archive.task.resources.map(archive.object)});
    const ctx = {...base, task: archive.task.id, tenant: archive.task.tenant, object: ref => archive.object([ref.digest, BigInt(ref.bytes)])};
    const world = await import(pathToFileURL(verifyRuntime(worldRuntime).entrypoint).href);
    let providerProjections = 0, controlProjections = 0, workProjections = 0;
    const measurementRows = [];
    for (const [kind, id, reference] of archive.manifest[6]) {
      if (kind !== 4) continue;
      const capture = decodeValue(archive.schemas.get('capture'), archive.object(reference));
      const attemptRow = archive.manifest[6].find(([tag, candidate]) => tag === 5 && Buffer.from(candidate).equals(Buffer.from(id)));
      const attempt = decodeValue(archive.schemas.get('attempt'), archive.object(attemptRow[2]));
      const request = await world.decodeRequest(archive.object(attempt[3])), prepared = archive.object(capture[3]), raw = archive.object(capture[4].value);
      let projected;
      if (request.semanticIdentity === 'agent.model.invoke.v6') {
        projected = model.interpret(ctx, request.payload, prepared, raw); providerProjections++;
        const index = Number(ctx.codec.decode('AdaptivePrepared', prepared).request.plan.watermark);
        measurementRows.push({prepared, captured: raw, request_ms: requestTimes[index]});
      }
      else if (request.semanticIdentity === 'agent.adaptive.context.prepare.v1') { projected = preparation.interpret(ctx, request.payload, prepared, raw); controlProjections++; }
      else { projected = work.interpret(ctx, request.payload, prepared, raw, request.semanticIdentity === 'agent.adaptive.snapshot.guards.v1'); workProjections++; }
      assert(Buffer.from(projected.reply).equals(resultValue(archive.object(capture[6].value[0]))), 'JS reproduces the native committed projection');
      assert.deepEqual(projected.objects.map(hash), capture[6].value[1].map(ref => Buffer.from(ref[0]).toString('hex')));
    }
    assert.equal(providerProjections, 14); assert.equal(controlProjections, 22); assert.equal(workProjections, 4);
    for (const [name, bytes] of [['missing-capture', missingCaptures(archiveBytes, 'one')], ['tampered-control', tamperedAdaptiveControl(archiveBytes, appData.codec)]]) {
      const path = join(app.data, `${name}.bundle`); await writeFile(path, bytes, {mode: 0o600});
      const rejected = spawnSync(app.command, ['import-checkpoint', '--state-dir', join(app.data, `${name}-state`), '--input', path, '--operation-id', name,
        '--test-provider', '--trust-root', trust], {cwd: app.data, env: {PATH: '/nonexistent'}, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024});
      assert.equal(rejected.status, 64, name);
    }
    assert.equal(requests.length, 14, 'recovery, import and pure projection replay perform no inference');
    const measurements = measureAdaptive(ctx, measurementRows, {archive_bytes: archiveBytes.length, archive_objects: archive.objects.size,
      namespace_object_bytes: [...archive.objects.values()].reduce((sum, bytes) => sum + bytes.length, 0),
      request_time_scope: 'controlled provider request-body acquisition to response send; includes deliberate first-request hold',
      task_ms: performance.now() - started});
    console.log(JSON.stringify({adaptive_native: 'controlled HTTPS, held inbox, frozen policy, killed question, archive and JS parity',
      model_attempts: requests.length, request_bytes: requests.map(item => item.bytes.length), request_ms: requestTimes,
      held_ping_ms: pingMs, held_status_ms: statusMs, task_ms: performance.now() - started, archive_bytes: archiveBytes.length,
      provider_projections: providerProjections, context_projections: controlProjections, work_projections: workProjections,
      layout_comparison: measurements.comparison.map(({policy, total_request_bytes, summed_local_visible_prefix_bytes, actual_execution, hard_eviction}) =>
        ({policy, total_request_bytes, summed_local_visible_prefix_bytes, actual_execution, hard_eviction})), live_provider: false}));
  } finally {
    releaseHeld(); if (client) { client.child.kill('SIGKILL'); await client.closed; }
    for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve));
  }
}
