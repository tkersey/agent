#!/usr/bin/env node
// Environmental dispatch only. Images own investigation, cache, interpretation,
// candidate selection and authority. PKO2/ERS2 remain the only control artifacts.
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMain } from './cli.mjs';
import { loadWorldRuntime } from './world.mjs';
import { decodeSchema, decodeValue, encodeValue } from './values.mjs';
import { decodeModelInvocation, encodeOpenAIResponsesRequest, performModelInvocation, admitModelEndpoint } from './model.mjs';
import { acceptanceContract, createInquiryExecutor, sourceDigest } from './inquiry.mjs';
import { executeInquiryRequest } from './inquiry_wire.mjs';
import { createInquiryDelivery } from './inquiry_delivery.mjs';
import { createDocumentEnvironment } from './document.mjs';

const variant = (tag, value = null) => ({ tag, value });
const outcomes = ['delivered', 'unresolved', 'conflict', 'declined', 'invalid', 'unavailable',
  'uncertain', 'no-change', 'stopped', 'artifact', 'other', 'not-sure', 'unoffered', 'aborted', 'closed', 'wrong-context'];
const json = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2) + '\n';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (root, path) => { const tail = relative(root, path); return tail === '' || (!isAbsolute(tail) && tail !== '..' && !tail.startsWith(`..${sep}`)); };
function exact(value, fields, optional = []) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'expected configuration object');
  assert(fields.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...fields, ...optional].includes(key)), 'unexpected or missing configuration field');
}
function text(value) { assert(typeof value === 'string' && value.length && value.isWellFormed() && !value.includes('\0'), 'expected nonempty text'); return value; }
function natural(value, maximum, minimum = 1) { assert(Number.isSafeInteger(value) && value >= minimum && value <= maximum, 'invalid resource allowance'); return value; }
async function readJson(path) { const bytes = await readFile(path); assert(bytes.length <= 256 * 1024, 'configuration too large'); return JSON.parse(bytes); }

export async function readConfiguration(path) {
  const file = await realpath(path), config = await readJson(file);
  exact(config, ['name', 'corpus', 'worldRuntime', 'images', 'targetRoot', 'strategy', 'provider', 'profile', 'allowance', 'task']);
  text(config.name); text(config.corpus);
  assert(['inquiry', 'react'].includes(config.strategy), 'unknown strategy');
  assert.equal(config.profile, 'macos-seatbelt-session-v1', 'unsupported execution profile');
  exact(config.provider, ['endpoint', 'model'], ['keyEnv']);
  text(config.provider.model); assert(Buffer.byteLength(config.provider.model) <= 64);
  if (config.provider.keyEnv !== undefined) assert(/^[A-Z][A-Z0-9_]*$/.test(config.provider.keyEnv), 'invalid credential variable name');
  const endpoint = admitModelEndpoint(text(config.provider.endpoint), config.provider.keyEnv !== undefined);
  assert(!endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash, 'endpoint cannot embed credentials or query parameters');
  exact(config.allowance, ['modelRequests', 'experiments', 'requestBytes', 'elapsedMs', 'modelTimeoutMs']);
  natural(config.allowance.modelRequests, 1024); natural(config.allowance.experiments, 64);
  natural(config.allowance.requestBytes, 64 * 1024 * 1024);
  natural(config.allowance.elapsedMs, 3_600_000); natural(config.allowance.modelTimeoutMs, config.allowance.elapsedMs);
  exact(config.task, ['investigations', 'passes', 'modelTurns', 'reusable', 'explore', 'intent', 'principal']);
  natural(config.task.investigations, 8); natural(config.task.passes, 64); natural(config.task.modelTurns, 32);
  assert(typeof config.task.reusable === 'boolean' && typeof config.task.explore === 'boolean');
  assert(['artifact', 'deliver', 'ask'].includes(config.task.intent));
  assert(typeof config.task.principal === 'string' && /^[1-9][0-9]*$/.test(config.task.principal) && BigInt(config.task.principal) <= 0xffffffffffffffffn, 'principal must be a positive u64 decimal string');
  for (const field of ['worldRuntime', 'images', 'targetRoot']) config[field] = await realpath(resolve(dirname(file), text(config[field])));
  return config;
}

async function outputDirectory(path, config) {
  const parent = await realpath(dirname(resolve(path)));
  const output = join(parent, relative(dirname(resolve(path)), resolve(path)));
  for (const item of Array.isArray(config) ? config : [config])
    for (const root of [item.worldRuntime, item.images, item.targetRoot]) assert(!inside(root, output), 'output must be outside runtime, images and delivery target');
  await mkdir(output, { mode: 0o700 }); // Never overwrite a prior run or adopt its counters.
  return output;
}
async function readSubject(root) {
  const files = await createDocumentEnvironment({ root, maximumContentBytes: 4096 });
  const result = await files.read({ path: 'session.mjs' });
  assert.equal(result.kind, 'success', 'subject must be a readable in-scope regular file');
  return result.observation.content;
}
async function load(config) {
  const host = await loadWorldRuntime({ runtimePath: config.worldRuntime });
  const world = await import(pathToFileURL(host.identity.entrypoint));
  const kernel = await world.admitProcessKernel(await readFile(host.identity.kernelPath), { expectedSha256: host.identity.kernelSha256 });
  const image = await readFile(join(config.images, config.strategy === 'inquiry' ? 'repair.bpi3' : 'react.bpi3'));
  return { host, world, kernel, image };
}

export function replacementDiff(base, replacement) {
  if (base === replacement) return '';
  const lines = value => value.length ? value.replace(/\n$/, '').split('\n') : [];
  const a = lines(base), b = lines(replacement);
  const side = (rows, prefix, value) => rows.map(line => prefix + line + '\n').join('') +
    (rows.length && !value.endsWith('\n') ? '\\ No newline at end of file\n' : '');
  return `--- a/session.mjs\n+++ b/session.mjs\n@@ -${a.length ? 1 : 0},${a.length} +${b.length ? 1 : 0},${b.length} @@\n` + side(a, '-', base) + side(b, '+', replacement);
}
async function artifact(output, proposal) {
  const [path, base, candidate] = proposal;
  assert.equal(path, 'session.mjs');
  await writeFile(join(output, 'base.mjs'), base[0], { flag: 'wx', mode: 0o600 });
  await writeFile(join(output, 'replacement.mjs'), candidate[0], { flag: 'wx', mode: 0o600 });
  await writeFile(join(output, 'repair.diff'), replacementDiff(base[0], candidate[0]), { flag: 'wx', mode: 0o600 });
  await writeFile(join(output, 'proposal.json'), json(proposal), { flag: 'wx', mode: 0o600 });
}

/** Each invocation receives a new explicit allowance. Reports account for
 * physical dispatch attempts and never reconstruct or select agent control. */
export async function runInquiry(config, options) {
  const output = await outputDirectory(options.out, config);
  const report = { name: config.name, corpus: config.corpus, strategy: config.strategy,
    status: 'starting', liveUsefulness: 'not-established', allowanceScope: 'this invocation, including resumed work',
    configuration: config, modelRequests: 0, experiments: 0, providerRequestBytes: 0,
    providerResponseBytes: null, providerResponseMeasurement: 'not exposed by the existing normalized transport',
    semanticRequestBytes: 0, semanticResponseBytes: 0, cleanups: 0, humanInteractions: 0,
    approvals: 0, writes: 0, writeAttempts: 0, maximumStateBytes: 0, checkpoints: [], dispatches: [] };
  async function saveReport() {
    await writeFile(join(output, 'report.tmp'), json(report), { mode: 0o600 });
    await rename(join(output, 'report.tmp'), join(output, 'report.json'));
  }
  const started = Date.now();
  let executor;
  try {
    const { host, world, kernel, image } = await load(config);
    report.imageSha256 = hash(image); report.imageBytes = image.length; report.kernelSha256 = host.identity.kernelSha256;
    executor = await createInquiryExecutor();
    report.executor = { kind: executor.kind, runner: executor.runner, reason: executor.reason };
    if (executor.kind !== 'qualified') { report.status = 'environment-unavailable'; return report; }
    const target = hash(Buffer.from(config.targetRoot));
    const delivery = await createInquiryDelivery({ root: config.targetRoot, target });
    let outcome;
    if (options.from) {
      const bytes = await readFile(options.from);
      const saved = world.decodeOutcome(bytes);
      assert(saved.state, 'resume requires a live World State');
      // Admit image/State and its pending request before dispatching any effect.
      const admitted = await kernel.run({ image, state: saved.state });
      assert.deepEqual(Buffer.from(admitted.bytes), bytes, 'checkpoint/image mismatch');
      outcome = options.result ? await kernel.run({ image, state: saved.state, result: await readFile(options.result) }) : admitted;
    } else {
      assert(!options.result, 'a result requires its saved outcome');
      const source = options.frozenSource ?? await readSubject(config.targetRoot);
      assert(Buffer.byteLength(source) <= 4096 && source.isWellFormed(), 'source exceeds application contract');
      report.subjectSha256 = sourceDigest(source);
      const requirements = await readFile(join(config.images, 'contract.txt'), 'utf8');
      const schema = decodeSchema(await readFile(join(config.images, 'task-schema.bin')));
      const task = [['session.mjs', source, executor.runner, requirements, acceptanceContract, config.task.reusable, target, 0n],
        config.provider.model, config.task.investigations, BigInt(config.task.passes), BigInt(config.task.modelTurns), true,
        BigInt(config.task.principal), 0n, config.task.explore, { deliver: 0, artifact: 1, ask: 2 }[config.task.intent]];
      outcome = await kernel.run({ image, initialArgs: encodeValue(schema, task) });
    }
    let index = 0, cancelling = false;
    for (;;) {
      const stem = String(index++).padStart(4, '0');
      const checkpoint = `${stem}.pko2`;
      await writeFile(join(output, checkpoint), outcome.bytes, { flag: 'wx', mode: 0o600 });
      report.checkpoints.push(checkpoint); report.checkpoint = checkpoint;
      report.maximumStateBytes = Math.max(report.maximumStateBytes, outcome.state?.length ?? 0);
      if (outcome.kind !== 'Requested') {
        report.status = outcome.kind.toLowerCase();
        if (outcome.kind === 'Completed') {
          const schema = decodeSchema(await readFile(join(config.images, 'outcome-schema.bin')));
          const value = decodeValue(schema, outcome.value);
          report.outcome = value; report.resultTag = value.tag; report.applicationOutcome = outcomes[value.tag];
          if ([0, 7, 9].includes(value.tag)) await artifact(output, value.value[1]);
        }
        return report;
      }
      const request = world.decodeRequest(outcome.request);
      const identity = request.semanticIdentity;
      const payload = decodeValue(decodeSchema(request.payloadSchema), request.payload);
      report.pending = identity;
      if (cancelling && identity !== 'inquiry.repair.cleanup.v1') { report.status = 'cleanup-awaiting-external-input'; return report; }
      const model = identity === 'agent.model.invoke.v3', experiment = identity === 'inquiry.repair.experiment.v1';
      const invocation = model ? decodeModelInvocation(request.payload) : null;
      const requestBytes = model ? encodeOpenAIResponsesRequest(invocation).length : 0;
      const exhausted = !cancelling && (Date.now() - started >= config.allowance.elapsedMs ||
        (model && (report.modelRequests >= config.allowance.modelRequests || report.providerRequestBytes + requestBytes > config.allowance.requestBytes)) ||
        (experiment && report.experiments >= config.allowance.experiments));
      if (exhausted) {
        cancelling = true; report.resourceStop = true;
        outcome = await kernel.run({ image, state: outcome.state, cancel: 'operator resource allowance exhausted' });
        continue;
      }
      if (model && !options.authorizeInference) { report.status = 'inference-not-authorized'; return report; }
      if (identity.startsWith('agent.interaction.exchange.v1.')) {
        report.humanInteractions++; report.status = 'awaiting-human';
        await writeFile(join(output, 'question.json'), json(await host.inspectPending(outcome.bytes)), { flag: 'wx', mode: 0o600 });
        if (identity === 'agent.interaction.exchange.v1.inquiry.repair.change') {
          report.approvals++; await artifact(output, payload[3][1]);
        }
        return report;
      }
      if (identity === 'inquiry.repair.replace.v1' && !options.allowWrite) { report.status = 'write-not-authorized'; return report; }
      let reply;
      const dispatched = { request: hash(outcome.request), effect: identity, status: 'prepared' };
      report.dispatches.push(dispatched);
      if (model) {
        assert.equal(invocation.model, config.provider.model, 'saved request selects another model');
        // Credentials are read only at an explicitly authorized dispatch. No
        // dotenv loading, key discovery or provisioning is performed.
        const apiKey = config.provider.keyEnv === undefined ? undefined : process.env[config.provider.keyEnv];
        assert(config.provider.keyEnv === undefined || apiKey, 'configured credential variable is unavailable');
        dispatched.status = 'dispatching';
        report.modelRequests++; report.providerRequestBytes += requestBytes;
        report.semanticRequestBytes += request.payload.length;
        await saveReport();
        reply = await performModelInvocation(request.payload, { endpoint: config.provider.endpoint, apiKey,
          signal: AbortSignal.timeout(Math.max(1, Math.min(config.allowance.modelTimeoutMs,
            config.allowance.elapsedMs - (Date.now() - started)))) });
        report.semanticResponseBytes += reply.length;
      } else {
        if (experiment) {
          assert.equal(payload[0][6], target, 'saved experiment selects another target');
          assert.equal(payload[0][2], executor.runner, 'saved experiment selects another execution profile');
          dispatched.status = 'dispatching'; report.experiments++; await saveReport();
          reply = await executeInquiryRequest(executor, payload, {
            signal: AbortSignal.timeout(Math.max(1, config.allowance.elapsedMs - (Date.now() - started))) });
        } else if (identity === 'inquiry.repair.cleanup.v1') { report.cleanups++; reply = null; }
        else if (identity === 'inquiry.repair.read.v1') {
          const read = await delivery.read(payload);
          reply = read.kind === 'success' ? variant(0, read.proposal) : variant(1, 'target read failed');
        } else if (identity === 'agent.approval.issue.v1.inquiry.repair.change') {
          assert.equal(payload[5], target, 'foreign approval target');
          reply = randomBytes(8).readBigUInt64LE() || 1n;
        } else if (identity === 'inquiry.repair.replace.v1') {
          dispatched.status = 'dispatching'; report.writeAttempts++; await saveReport();
          const result = await delivery.replace(payload);
          if (result.kind === 'success') report.writes++;
          const tag = { success: 0, conflict: 1, failure: 2, uncertain: 3 }[result.kind];
          assert(tag !== undefined, 'unknown delivery result');
          reply = variant(tag, tag < 2 ? [result.observation.content, result.observation.digest] : result.kind);
        } else throw new Error(`unsupported external effect: ${identity}`);
        reply = encodeValue(decodeSchema(request.resumeSchema), reply);
      }
      const result = world.encodeResult(outcome.request, reply);
      await writeFile(join(output, `${stem}.ers2`), result, { flag: 'wx', mode: 0o600 });
      dispatched.status = 'returned';
      outcome = await kernel.run({ image, state: outcome.state, result });
    }
  } catch (error) {
    report.status = 'failed'; report.error = error.message;
    report.uncertainDispatch = report.dispatches.some(row => row.status === 'dispatching');
    return report;
  } finally {
    if (executor?.kind === 'qualified') report.executorMetrics = executor.metrics();
    report.elapsedMs = Date.now() - started;
    await saveReport();
  }
}

export async function answerInquiry(config, options) {
  const { world } = await load(config);
  const outcome = world.decodeOutcome(await readFile(options.from));
  assert.equal(outcome.kind, 'Requested');
  const request = world.decodeRequest(outcome.request);
  const payload = decodeValue(decodeSchema(request.payloadSchema), request.payload);
  let answer;
  const abort = options.choice === 'abort', close = options.choice === 'close';
  if (request.semanticIdentity === 'agent.interaction.exchange.v1.inquiry.repair.intent') {
    if (abort || close) answer = variant(abort ? 1 : 2);
    else {
      const choice = { artifact: variant(0, 1), deliver: variant(0, 2), other: variant(1), 'not-sure': variant(2) }[options.choice];
      assert(choice, 'expected artifact, deliver, other, not-sure, abort or close');
      answer = variant(0, [payload[3], choice]);
    }
  } else {
    assert.equal(request.semanticIdentity, 'agent.interaction.exchange.v1.inquiry.repair.change');
    assert(['approve', 'decline'].includes(options.choice),
      'approval accepts approve or decline; use runtime/runner.mjs cancel to cancel the World process');
    answer = variant(0, [payload[3], BigInt(config.task.principal), options.choice === 'approve' ? variant(0) : variant(1, 'declined by operator')]);
  }
  assert(request.semanticIdentity.startsWith('agent.interaction.exchange.v1.inquiry.repair.'), 'not an inquiry human interaction');
  await writeFile(options.out, world.encodeResult(outcome.request, encodeValue(decodeSchema(request.resumeSchema), answer)), { flag: 'wx', mode: 0o600 });
  return { status: 'answer-written', output: resolve(options.out) };
}

export async function compareInquiry(configPaths, options) {
  assert(Array.isArray(configPaths) && configPaths.length > 0 && configPaths.length <= 100, 'corpus requires 1..100 configuration paths');
  const configs = await Promise.all(configPaths.map(readConfiguration));
  assert(configs.every(c => c.task.intent === 'artifact'), 'comparisons require artifact-only delivery');
  assert.equal(new Set(configs.map(c => c.name)).size, configs.length, 'case names must be unique');
  const output = await outputDirectory(options.out, configs);
  const results = [];
  for (let i = 0; i < configs.length; i++) {
    const config = configs[i];
    let source, inputError;
    try { source = await readSubject(config.targetRoot); }
    catch (error) { inputError = error.message; }
    for (const strategy of ['inquiry', 'react']) {
      const report = inputError ? { status: 'input-unavailable', error: inputError } : await runInquiry({ ...config, strategy }, { ...options,
        out: join(output, `${i}-${strategy}`), from: undefined, result: undefined, frozenSource: source });
      results.push({ name: config.name, strategy, status: report.status,
        applicationOutcome: report.applicationOutcome, resourceStop: report.resourceStop ?? false,
        modelRequests: report.modelRequests ?? 0, experiments: report.experiments ?? 0,
        ...(inputError ? { error: inputError } : { report: `${i}-${strategy}/report.json` }) });
      await writeFile(join(output, 'comparison.json'), json({ results, complete: results.length === 2 * configs.length,
        scope: 'one attempt per configured case and strategy; per-attempt allowances; no automatic retries' }), { mode: 0o600 });
    }
  }
  return { status: 'comparison-recorded', output, results };
}

export async function inquiryCli(argv) {
  const [command, ...args] = argv;
  assert(['run', 'answer', 'compare'].includes(command), 'expected run, answer or compare');
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]; assert(['--config', '--corpus', '--out', '--from', '--result', '--choice', '--authorize-inference', '--allow-write'].includes(flag), 'unknown argument');
    const key = flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    assert(!Object.hasOwn(options, key), 'duplicate argument');
    if (['--authorize-inference', '--allow-write'].includes(flag)) options[key] = true;
    else {
      const value = args[++i];
      assert(typeof value === 'string' && !value.startsWith('--'), 'missing argument value');
      options[key] = text(value);
    }
  }
  text(options.out);
  if (command === 'compare') {
    assert(options.corpus && !options.config && !options.from && !options.result && !options.choice && !options.allowWrite);
    const corpus = await realpath(options.corpus);
    const paths = await readJson(corpus);
    assert(Array.isArray(paths));
    return compareInquiry(paths.map(path => resolve(dirname(corpus), text(path))), options);
  }
  assert(options.config && !options.corpus);
  const config = await readConfiguration(options.config);
  if (command === 'answer') {
    assert(options.from && options.choice && !options.result && !options.authorizeInference && !options.allowWrite);
    return answerInquiry(config, options);
  }
  assert(!options.choice);
  assert(!options.result || options.from, 'a result requires its saved outcome');
  return runInquiry(config, options);
}

if (isMain(import.meta)) inquiryCli(process.argv.slice(2)).then(result => {
  console.log(json(result));
  if (result.status === 'failed' || result.status === 'environment-unavailable') process.exitCode = 1;
}).catch(error => { console.error(`inquiry: ${error.message}`); process.exitCode = 1; });
