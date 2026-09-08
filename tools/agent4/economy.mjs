#!/usr/bin/env node
// Copyright (c) 2026 Agent contributors. MIT license.
// Consumer measurements only: all computation is performed by unchanged World.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, lstat, realpath, writeFile, rename } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { loadWorldRuntime } from '../../runtime/world.mjs';
import { decodeSchema, decodeValue, encodeValue } from '../../runtime/values.mjs';
import { assertDependenciesUnchanged, readRegular, sha256, snapshotDependencies } from './dependencies.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const DEFAULT_FIXTURES = join(ROOT, '.agent4/out/economy');
const TIMING_UNMEASURED = 'UNMEASURED_CONTENDED_UNTIL_EXPLICIT_MEASURE';
const scalar = type => ({ root: 0, types: [type] });
const stringify = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2) + '\n';
const identity = bytes => ({ bytes: bytes.length, sha256: sha256(bytes) });
const errorRecord = error => ({ name: error.name, message: error.message,
  ...(error.errors ? { errors: error.errors.map(errorRecord) } : {}) });

function parseOptions(args) {
  const flags = new Map([
    ['--world-runtime', 'runtime'], ['--output', 'output'], ['--fixtures', 'fixtures'], ['--probe', 'probe'],
  ]);
  const options = { fixtures: DEFAULT_FIXTURES, probe: join(DEFAULT_FIXTURES, 'bin/economy-probe') };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) throw new Error(`DuplicateOption: ${flag}`);
    seen.add(flag);
    if (['--functional-only', '--measure', '--uncontended'].includes(flag)) { options[flag.slice(2)] = true; continue; }
    const name = flags.get(flag);
    if (!name) throw new Error(`UnknownOption: ${flag}`);
    const value = args[++i];
    if (!value || value.startsWith('--') || !isAbsolute(value) || value.includes('\0'))
      throw new Error(`AbsolutePathRequired: ${flag}`);
    options[name] = resolve(value);
  }
  if (!options.runtime || !options.output) throw new Error('RequiredOptions: --world-runtime ABSOLUTE --output ABSOLUTE');
  if (options['functional-only'] && (options.measure || options.uncontended))
    throw new Error('ConflictingOptions: --functional-only cannot be combined with --measure or --uncontended');
  if (Boolean(options.measure) !== Boolean(options.uncontended))
    throw new Error('TimingRequiresExplicitSelection: --measure and --uncontended must be supplied together');
  options['functional-only'] = !options.measure;
  return options;
}

function within(parent, child) {
  const suffix = relative(parent, child);
  return suffix === '' || (!suffix.startsWith(`..${sep}`) && suffix !== '..' && !isAbsolute(suffix));
}
async function noSymlinkPath(path) {
  let current = resolve(path);
  for (;;) {
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new Error(`SymlinkPathRejected: ${current}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = dirname(current);
    if (current === parent) break;
    current = parent;
  }
}
async function prepareOutput(options) {
  await noSymlinkPath(options.output);
  const runtime = await realpath(options.runtime);
  for (const protectedRoot of [join(ROOT, '.agent4/inputs'), runtime]) {
    if (within(protectedRoot, options.output)) throw new Error('OutputMayNotModifyDependency');
  }
  await mkdir(options.output, { recursive: true });
  if (!(await lstat(options.output)).isDirectory()) throw new Error('OutputMustBeDirectory');
  await noSymlinkPath(options.output);
}
async function save(output, name, data) {
  const target = join(output, name);
  if (!within(output, target)) throw new Error('InvalidArtifactPath');
  await noSymlinkPath(target);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, data, { flag: 'wx' });
  await rename(temporary, target);
  return target;
}
async function invoke(command, args, { cwd = ROOT, output, label, measure = false } = {}) {
  const started = measure ? performance.now() : null;
  let stdout = '', stderr = '';
  const exitCode = await new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.once('error', reject);
    // exit can precede the final stdout data event. close owns completion of
    // both the process and its pipes, so JSON/log consumers see complete output.
    child.once('close', (code, signal) => signal ? reject(new Error(`WorkerTerminated: ${signal}; no completion claimed`)) : accept(code));
  });
  const finished = measure ? performance.now() : null;
  if (output && label) {
    await save(output, `logs/${label}.stdout`, stdout);
    await save(output, `logs/${label}.stderr`, stderr);
  }
  if (exitCode !== 0) throw new Error(`CommandFailed(${exitCode}): ${command} ${args.join(' ')}\n${stderr.slice(-4000)}`);
  return { stdout, stderr, ...(measure ? { elapsedMilliseconds: finished - started } : {}) };
}
async function inspectState(probe, output, name, state) {
  const path = await save(output, `checkpoints/${name}.pst2`, state);
  const result = await invoke(probe, ['inspect-state', path]);
  const graph = JSON.parse(result.stdout);
  assert.equal(graph.canonicalReachable, true, 'public snapshot inspector must establish canonical reachable graph');
  return { path: relative(output, path), ...identity(state), graph };
}
async function requiredFile(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`RegularInputRequired: ${path}`);
  return readRegular(path);
}
function requireOutcome(outcome, expected, where) {
  assert.equal(outcome.kind, expected, `${where}: expected ${expected}, observed ${outcome.kind}`);
}

async function measureBuilds(options) {
  const directory = join(options.output, 'compile-measurements');
  await noSymlinkPath(directory); await mkdir(directory, { recursive: false });
  const original = await requiredFile(join(ROOT, 'test/agent4/economy.zig'));
  const source = join(directory, 'economy.zig');
  await writeFile(source, original, { flag: 'wx' });
  const args = ['build', '--build-file', join(ROOT, 'test/agent4/economy_build.zig'),
    '-Doptimize=ReleaseSafe', `-Dboundary-source=${join(ROOT, '.agent4/inputs/boundary')}`,
    `-Deconomy-source=${source}`, '--cache-dir', join(directory, 'cache'),
    '--global-cache-dir', join(directory, 'global-cache'), '--prefix', join(directory, 'prefix')];
  const records = [];
  for (const phase of ['cold', 'warm-no-change', 'edited-source']) {
    if (phase === 'edited-source') {
      const marker = 'const edited_source_value: u32 = 7;';
      const text = original.toString('utf8');
      if (text.split(marker).length !== 2) throw new Error('EditedSourceMeasurementMarkerMissingOrAmbiguous');
      await writeFile(source, text.replace(marker, 'const edited_source_value: u32 = 8;'));
    }
    const result = await invoke('zig', args, { output: options.output, label: `build-${phase}`, measure: true });
    records.push({ phase, elapsedMilliseconds: result.elapsedMilliseconds, source: identity(await requiredFile(source)),
      command: ['zig', ...args] });
  }
  return { status: 'MEASURED_EXPLICITLY_DECLARED_UNCONTENDED',
    qualification: 'Uncontended is an explicit operator declaration; the harness cannot prove absence of other machine activity.', builds: records };
}

async function measureEmission(options) {
  const directory = join(options.output, 'measured-emission');
  await noSymlinkPath(directory); await mkdir(directory, { recursive: false });
  const command = [options.probe, 'emit', directory];
  const result = await invoke(command[0], command.slice(1), {
    output: options.output, label: 'measured-emission', measure: true,
  });
  const metricsBytes = await requiredFile(join(directory, 'source-metrics.json'));
  const metrics = JSON.parse(metricsBytes);
  const images = [];
  for (const file of ['direct.bpi2', 'facade.bpi2', 'sharing-1.bpi2', 'sharing-8.bpi2', 'sharing-64.bpi2', 'conversation.bpi2']) {
    const actual = await requiredFile(join(directory, file));
    assert.deepEqual(actual, await requiredFile(join(options.fixtures, file)),
      'timed source emission must reproduce the exact functional fixture');
    images.push({ file, ...identity(actual) });
  }
  const workloadMetrics = [metrics.direct, metrics.facade, ...(metrics.sharing ?? []), metrics.conversation];
  for (const row of workloadMetrics) {
    for (const field of ['descriptorConstructionNs', 'sourceConstructionNs', 'agentAdmissionNs',
      'authoringTotalNs', 'compilerTotalNs', 'imageEmissionNs'])
      assert.ok(Number.isSafeInteger(row[field]) && row[field] >= 0,
        `Measured ${row.name}.${field} must contain an actual exact observation`);
    for (const field of ['source_copy', 'source_check', 'lowering', 'target_check',
      'direct_optimization', 'canonicalization'])
      assert.ok(Number.isSafeInteger(row.compilerPhasesNs?.[field]) && row.compilerPhasesNs[field] >= 0,
        `Measured ${row.name}.compilerPhasesNs.${field} must be observed`);
  }
  const d = metrics.direct, f = metrics.facade;
  const expectedOverhead = {
    descriptorConstructionNs: f.descriptorConstructionNs - d.descriptorConstructionNs,
    sourceConstructionNs: f.sourceConstructionNs - d.sourceConstructionNs,
    agentAdmissionNs: f.agentAdmissionNs - d.agentAdmissionNs,
    boundaryCompilerNs: f.compilerTotalNs - d.compilerTotalNs,
    loweringNs: f.compilerPhasesNs.lowering - d.compilerPhasesNs.lowering,
    authoringTotalNs: f.authoringTotalNs - d.authoringTotalNs,
    imageEmissionNs: f.imageEmissionNs - d.imageEmissionNs,
    totalThroughEmissionNs: (f.authoringTotalNs + f.imageEmissionNs) - (d.authoringTotalNs + d.imageEmissionNs),
    imageBytes: f.imageBytes - d.imageBytes,
  };
  for (const [field, expected] of Object.entries(expectedOverhead)) {
    assert.ok(Number.isSafeInteger(expected), `Overhead ${field} exceeds exact host arithmetic`);
    assert.equal(metrics.facadeOverhead?.[field], expected, `Overhead ${field} must be facade minus direct`);
  }
  const timings = workloadMetrics.map(row => ({ name: row.name,
    descriptorConstructionNs: row.descriptorConstructionNs,
    sourceConstructionNs: row.sourceConstructionNs,
    descriptorAndSourceNs: row.descriptorAndSourceNs,
    agentAdmissionNs: row.agentAdmissionNs,
    authoringTotalNs: row.authoringTotalNs,
    compilerTotalNs: row.compilerTotalNs, compilerPhasesNs: row.compilerPhasesNs,
    imageEmissionNs: row.imageEmissionNs,
    ...(row.name === 'facade' ? { compilerTotalRelation: 'Agent authoring observer measures descriptors/source/admission/Boundary call; existing Boundary observer supplies compiler subphases. No runtime instrumentation.' } : {}) }));
  return { status: 'MEASURED_EXPLICITLY_DECLARED_UNCONTENDED', command,
    elapsedMilliseconds: result.elapsedMilliseconds, images,
    sourceMetrics: { ...identity(metricsBytes), path: relative(options.output, join(directory, 'source-metrics.json')) },
    compilerSubphases: { status: 'MEASURED_EXPLICITLY_DECLARED_UNCONTENDED', values: timings,
      qualification: 'Authoring total includes Builder lifetime and compilation; image emission is separate. Compiler subphases are nested within compilerTotalNs and must not be added twice.' },
    facadeOverhead: metrics.facadeOverhead };
}

async function minimalFacade(world, kernel, fixtures) {
  const direct = await requiredFile(join(fixtures, 'direct.bpi2'));
  const facade = await requiredFile(join(fixtures, 'facade.bpi2'));
  assert.deepEqual(facade, direct, 'minimal facade must produce identical canonical BPI2 without deleting instructions');
  const observations = [];
  for (const [name, image] of [['direct', direct], ['facade', facade]]) {
    const args = await requiredFile(join(fixtures, `${name}.args`));
    assert.equal(decodeValue(scalar('u32'), args), 7);
    const parked = await kernel.run({ image, initialArgs: args });
    requireOutcome(parked, 'Requested', name);
    const request = world.decodeRequest(parked.request);
    assert.equal(request.semanticIdentity, 'example.facade.read.v1');
    assert.equal(decodeValue(decodeSchema(request.payloadSchema), request.payload), 7);
    const reply = encodeValue(decodeSchema(request.resumeSchema), 9);
    const completed = await kernel.run({ image, state: parked.state, result: world.encodeResult(parked.request, reply) });
    requireOutcome(completed, 'Completed', name);
    assert.equal(decodeValue(scalar('u32'), completed.value), 9);
    observations.push({ name, image: identity(image), initialArgs: identity(args),
      requests: 1, stateBytes: parked.state.length, result: identity(completed.value) });
  }
  return { status: 'PASS', relation: 'identical canonical BPI2 and independently prescribed effect/result', observations };
}

async function sharing(kernel, fixtures, sourceMetrics) {
  assert.ok(Array.isArray(sourceMetrics.sharing), 'source-metrics must list sharing witnesses');
  const observations = [];
  for (const count of [1, 8, 64]) {
    const image = await requiredFile(join(fixtures, `sharing-${count}.bpi2`));
    const rows = sourceMetrics.sharing.filter(row => row.installations === count);
    assert.equal(rows.length, 1, `one source metric must bind sharing-${count}`);
    const row = rows[0];
    assert.equal(row.helperFunctionCount, 1, 'repeated installs must share a single authored helper function');
    assert.equal(row.helperIncomingCalls, count);
    assert.equal(row.sharedPromptCopies, 1);
    assert.equal(row.handlerDefinitions, 1);
    assert.equal(row.imageBytes, image.length);
    assert.equal(row.imageSha256, sha256(image));
    const completed = await kernel.run({ image, initialArgs: new Uint8Array() });
    requireOutcome(completed, 'Completed', `sharing-${count}`);
    assert.equal(decodeValue(scalar('u32'), completed.value), 7);
    observations.push({ installations: count, image: identity(image), sourceMetrics: row,
      externalRequests: 0, result: 7 });
  }
  return { status: 'PASS', relation: 'one shared helper body; image/catalog costs reported separately from execution', observations };
}

async function advanceToBoundary(kernel, image, initial, expected) {
  let input = initial, advances = 0, maximumObservedStateBytes = initial.state?.length ?? 0;
  for (;;) {
    const outcome = await kernel.advance({ image, ...input });
    advances++;
    if (outcome.state) maximumObservedStateBytes = Math.max(maximumObservedStateBytes, outcome.state.length);
    if (outcome.kind !== 'Progressed') {
      assert.deepEqual(outcome.bytes, expected.bytes, 'advance and run must reach the same canonical observable boundary');
      return { publicAdvanceCalls: advances, maximumObservedStateBytes,
        relation: 'one selected boundary; public advance calls include the final observable call and are not a private instruction count' };
    }
    input = { state: outcome.state };
  }
}

function completeTraceDiagnostics(enabled) {
  return {
    status: enabled ? 'MEASURED_EVERY_PUBLIC_ADVANCE_BOUNDARY' : 'UNMEASURED',
    relation: 'Diagnostic same-image replay of prescribed canonical inputs, compared byte-for-byte with run at every observable boundary; no effect handler is called and no alternative is selected by the replay.',
    span: 'Initial computation, every prescribed reply transition, and terminal completion, including explicit conversation close.',
    publicAdvanceCalls: enabled ? 0 : null,
    maximumObservedStateBytes: enabled ? 0 : null,
    spans: [],
    limitation: 'Maximum is exact for serialized portable States at public advance boundaries in this finite trace; private engine working-memory peak remains unmeasured.',
  };
}

async function observeTraceBoundary(trace, kernel, image, input, expected, label) {
  if (trace.status === 'UNMEASURED') return;
  const observed = await advanceToBoundary(kernel, image, input, expected);
  trace.publicAdvanceCalls += observed.publicAdvanceCalls;
  trace.maximumObservedStateBytes = Math.max(trace.maximumObservedStateBytes, observed.maximumObservedStateBytes);
  trace.spans.push({ label, outcome: expected.kind, outcomeSha256: sha256(expected.bytes), ...observed });
}

async function conversations(world, kernel, options) {
  const image = await requiredFile(join(options.fixtures, 'conversation.bpi2'));
  const initialArgs = await requiredFile(join(options.fixtures, 'conversation.args'));
  assert.equal(initialArgs.length, 0);
  const observations = [];
  let firstBoundary, steadyBoundary;
  for (const turns of [1, 8, 64, 1024]) {
    let outcome = await kernel.run({ image, initialArgs });
    const portableStateTrace = completeTraceDiagnostics(options.measure);
    await observeTraceBoundary(portableStateTrace, kernel, image, { initialArgs }, outcome, 'initial');
    let steadyState, maximumObservedParkedStateBytes = 0;
    const checkpoints = [], stateByteSizes = [], requestIdentities = new Set();
    for (let turn = 1; turn <= turns; turn++) {
      requireOutcome(outcome, 'Requested', `conversation turn ${turn}`);
      const request = world.decodeRequest(outcome.request);
      assert.equal(request.semanticIdentity, 'agent.interaction.exchange.v1.economy.next');
      const value = decodeValue(decodeSchema(request.payloadSchema), request.payload);
      assert.deepEqual(value, [null, null, null, BigInt(Math.min(turn, 8))]);
      requestIdentities.add(sha256(outcome.request));
      maximumObservedParkedStateBytes = Math.max(maximumObservedParkedStateBytes, outcome.state.length);
      stateByteSizes.push(outcome.state.length);
      if (turn === 8) steadyState = Uint8Array.from(outcome.state);
      if (turn > 8) assert.deepEqual(outcome.state, steadyState,
        'after fixed-content retention fills, every quiescent PST2 must have identical reachable control and retained values');
      if ([1, 8, 9, 64, 1024].includes(turn)) {
        const checkpoint = await inspectState(options.probe, options.output, `conversation-${turns}-turn-${turn}`, outcome.state);
        assert.equal(checkpoint.graph.pending, 1);
        checkpoints.push({ turn, ...checkpoint });
      }
      if (turns === 1 && turn === 1) firstBoundary = outcome;
      if (turns === 8 && turn === 8) steadyBoundary = outcome;
      const closing = turn === turns;
      const reply = encodeValue(decodeSchema(request.resumeSchema), closing ? { tag: 1, value: null } : { tag: 0, value: 7n });
      const input = { state: outcome.state, result: world.encodeResult(outcome.request, reply) };
      outcome = await kernel.run({ image, ...input });
      await observeTraceBoundary(portableStateTrace, kernel, image, input, outcome, closing ? 'explicit-close' : `turn-${turn + 1}`);
    }
    requireOutcome(outcome, 'Completed', `conversation close after ${turns} turns`);
    assert.equal(decodeValue(scalar('u64'), outcome.value), BigInt(Math.min(turns, 8)));
    assert.equal(outcome.state, undefined, 'root completion must not expose retained continuation State');
    if (options.measure) {
      assert.equal(portableStateTrace.spans.length, turns + 1, 'complete diagnostics must cover initial, every reply, and close');
      assert.equal(portableStateTrace.spans.at(-1).outcome, 'Completed');
    }
    observations.push({ turns, externalRequests: turns, acceptedValueReplies: turns - 1, explicitCloses: 1,
      maximumObservedParkedStateBytes, quiescentStateBytes: stateByteSizes.at(-1), stateByteSizes,
      uniqueRequestContents: requestIdentities.size,
      steadyAfterTurn: turns >= 8 ? 8 : null, identicalQuiescentStatesChecked: Math.max(0, turns - 8),
      checkpoints, portableStateTrace, completedValue: Math.min(turns, 8), result: identity(outcome.value) });
  }
  let diagnosticStepping;
  if (options.measure) diagnosticStepping = {
    status: 'MEASURED_EVERY_PUBLIC_ADVANCE_BOUNDARY',
    publicAdvanceCalls: observations.reduce((total, row) => total + row.portableStateTrace.publicAdvanceCalls, 0),
    maximumObservedStateBytes: Math.max(...observations.map(row => row.portableStateTrace.maximumObservedStateBytes)),
    completeTraceCount: observations.length,
    detail: 'Per-trace inputs, observable comparisons, and spans are recorded in each observation.portableStateTrace.',
  };
  else {
    const initialDiagnostic = await advanceToBoundary(kernel, image, { initialArgs }, firstBoundary);
    const request = world.decodeRequest(steadyBoundary.request);
    const result = world.encodeResult(steadyBoundary.request, encodeValue(decodeSchema(request.resumeSchema), { tag: 0, value: 7n }));
    const stableDiagnostic = await advanceToBoundary(kernel, image, { state: steadyBoundary.state, result }, steadyBoundary);
    diagnosticStepping = { status: 'SELECTED_BOUNDARIES_ONLY', initial: initialDiagnostic, steadyTurn: stableDiagnostic };
  }
  return { status: 'PASS', image: identity(image), initialArgs: identity(initialArgs),
    memoryPolicy: { fixedInput: 7, recentWindow: 8, semanticLifetimeLimit: null },
    relation: 'actual independent World roots and byte-identical complete quiescent PST2 after retention fills',
    observations, diagnosticStepping,
    wholeConversationPortableStatePeak: options.measure
      ? { status: 'MEASURED_EVERY_PUBLIC_ADVANCE_BOUNDARY', bytes: diagnosticStepping.maximumObservedStateBytes }
      : { status: 'UNMEASURED', reason: 'Functional-only observes parked States and two selected advance spans; the complete internal trace is not measured.' },
    wholeConversationInternalPeak: 'UNMEASURED: private engine working-memory peak is distinct from portable State size' };
}

async function alternatives(world, kernel, options) {
  const path = join(ROOT, '.agent4/out/multi/multi.bpi2');
  let image;
  try { image = await requiredFile(path); }
  catch (error) {
    if (error.code === 'ENOENT') return { status: 'UNESTABLISHED', reason: 'Optional independent multi-shot fixture is not available', requiredToCompleteEconomy: true };
    throw error;
  }
  const argsSchema = { root: 0, types: [{ seq: 1 }, 'u64'] };
  const resultSchema = { root: 0, types: [{ seq: 1 }, { product: [2, 2, 2] }, 'u64'] };
  const observations = [];
  for (const count of [1, 8, 64]) {
    const candidates = Array.from({ length: count }, (_, i) => BigInt(i + 11));
    const initialArgs = encodeValue(argsSchema, candidates);
    let outcome = await kernel.run({ image, initialArgs });
    const portableStateTrace = completeTraceDiagnostics(options.measure);
    await observeTraceBoundary(portableStateTrace, kernel, image, { initialArgs }, outcome, 'initial');
    const stateByteSizes = [], checkpoints = [];
    for (let index = 0; index < count; index++) {
      requireOutcome(outcome, 'Requested', `alternative ${index + 1}/${count}`);
      const request = world.decodeRequest(outcome.request);
      assert.equal(request.semanticIdentity, 'agent4.probe.assess');
      assert.deepEqual(decodeValue(decodeSchema(request.payloadSchema), request.payload), [candidates[index], 10n]);
      stateByteSizes.push(outcome.state.length);
      if (index === 0) {
        const checkpoint = await inspectState(options.probe, options.output, `alternatives-${count}-first-request`, outcome.state);
        assert.equal(checkpoint.graph.multiTemplates, 1, 'actual State must retain one internal multi template');
        assert.equal(checkpoint.graph.cells, 2, 'template and active branch each retain their own state cell');
        assert.equal(checkpoint.graph.obligations, 0);
        assert.equal(checkpoint.graph.pending, 1);
        checkpoints.push(checkpoint);
        const restored = await kernel.run({ image, state: Uint8Array.from(outcome.state) });
        assert.deepEqual(restored.bytes, outcome.bytes, 'replacing a World instance preserves unfinished internal work');
      }
      const reply = encodeValue(decodeSchema(request.resumeSchema), candidates[index] * 3n);
      const input = { state: outcome.state, result: world.encodeResult(outcome.request, reply) };
      outcome = await kernel.run({ image, ...input });
      await observeTraceBoundary(portableStateTrace, kernel, image, input, outcome, `assessment-${index + 1}`);
    }
    requireOutcome(outcome, 'Completed', `all ${count} alternatives`);
    assert.deepEqual(decodeValue(resultSchema, outcome.value), candidates.map(candidate => [10n, candidate, candidate * 3n]));
    assert.equal(outcome.state, undefined);
    if (options.measure) {
      assert.equal(portableStateTrace.spans.length, count + 1, 'complete diagnostics must include every branch reply and terminal completion');
      assert.equal(portableStateTrace.spans.at(-1).outcome, 'Completed');
    }
    observations.push({ alternatives: count, initialArgs: identity(initialArgs), externalRequests: count,
      stateByteSizes, maximumObservedParkedStateBytes: Math.max(...stateByteSizes), checkpoints,
      portableStateTrace, result: identity(outcome.value), terminalCarriesContinuationState: false });
  }
  return { status: 'PASS', image: identity(image), relation: 'internal multi continuation, isolated cells, prescribed environmental assessments, and fresh-instance restore',
    observations,
    diagnosticStepping: options.measure ? {
      status: 'MEASURED_EVERY_PUBLIC_ADVANCE_BOUNDARY',
      publicAdvanceCalls: observations.reduce((total, row) => total + row.portableStateTrace.publicAdvanceCalls, 0),
      maximumObservedStateBytes: Math.max(...observations.map(row => row.portableStateTrace.maximumObservedStateBytes)),
      completeTraceCount: observations.length,
    } : { status: 'UNMEASURED', reason: 'Functional-only records parked States; full branch transition diagnostics require explicit measured mode.' },
    immutableSharing: 'Graph/catalog evidence records retained nodes and blobs; no claim that search or serialization is constant-time',
    terminalReleaseRelation: 'Completed returns only first-order result bytes and no portable State; private engine heap liveness is not measured' };
}

export async function runEconomy(args) {
  const options = parseOptions(args);
  await prepareOutput(options);
  const report = { format: 'agent4-economy/v1', mode: options.measure ? 'explicit-measure' : 'functional-only',
    status: 'RUNNING', timingStatus: options.measure ? 'PENDING_EXPLICIT_MEASURE' : TIMING_UNMEASURED,
    claims: { dependencyModification: false, compilePerformanceOptimization: false, lifetimeLimit: false },
    inputs: {}, checks: {}, failures: [] };
  let before;
  try {
    before = snapshotDependencies({ worldRuntime: options.runtime });
    report.dependenciesBefore = before;
    const host = await loadWorldRuntime({ runtimePath: options.runtime });
    report.inputs.world = host.identity;
    const world = await import(pathToFileURL(host.identity.entrypoint).href);
    const kernel = await world.admitProcessKernel(readRegular(host.identity.kernelPath), { expectedSha256: host.identity.kernelSha256 });
    const probeBytes = await requiredFile(options.probe);
    const metricsBytes = await requiredFile(join(options.fixtures, 'source-metrics.json'));
    const sourceMetrics = JSON.parse(metricsBytes);
    report.inputs.probe = identity(probeBytes);
    report.inputs.sourceMetrics = identity(metricsBytes);
    report.sourceMetrics = sourceMetrics;
    for (const name of ['direct', 'facade', 'conversation']) {
      const image = await requiredFile(join(options.fixtures, `${name}.bpi2`));
      assert.equal(sourceMetrics[name].imageSha256, sha256(image), `${name} metrics must bind the image actually executed`);
      assert.equal(sourceMetrics[name].imageBytes, image.length);
    }
    report.inputs.harness = identity(await requiredFile(fileURLToPath(import.meta.url)));
    report.inputs.agentHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    report.inputs.headIsSourceIdentity = false;
    report.inputs.sourceIdentityNote = 'Compiled image, probe, harness, and source-metrics hashes bind these executions; HEAD alone does not certify an uncommitted tree.';
    for (const [name, body] of [
      ['minimalFacade', () => minimalFacade(world, kernel, options.fixtures)],
      ['sharing', () => sharing(kernel, options.fixtures, sourceMetrics)],
      ['conversation', () => conversations(world, kernel, options)],
      ['alternatives', () => alternatives(world, kernel, options)],
    ]) {
      process.stderr.write(`Agent economy: ${name}\n`);
      try { report.checks[name] = await body(); }
      catch (error) { report.checks[name] = { status: 'FAIL', error: errorRecord(error) }; report.failures.push({ check: name, ...errorRecord(error) }); }
    }
    if (options.measure) {
      try {
        report.timings = await measureBuilds(options);
        report.timingStatus = report.timings.status;
        report.timings.fixtureCompilation = await measureEmission(options);
      } catch (error) { report.failures.push({ check: 'timings', ...errorRecord(error) }); report.timingStatus = 'FAILED'; }
    } else report.timings = { status: TIMING_UNMEASURED,
      qualification: 'Functional execution does not establish timing acceptance. Existing source-metrics timing fields remain diagnostic observations.',
      compileBuilds: 'UNMEASURED', descriptorConstruction: 'UNMEASURED', lowering: 'UNMEASURED', imageEmission: 'UNMEASURED' };
  } catch (error) { report.failures.push({ check: 'setup', ...errorRecord(error) }); }
  finally {
    if (before) {
      try {
        const after = snapshotDependencies({ worldRuntime: options.runtime });
        report.dependenciesAfter = after;
        assertDependenciesUnchanged(before, after);
        report.dependenciesUnchanged = true;
      } catch (error) { report.dependenciesUnchanged = false; report.failures.push({ check: 'dependency-postflight', ...errorRecord(error) }); }
    }
  }
  report.status = report.failures.length ? 'FAIL' : Object.values(report.checks).some(check => check.status !== 'PASS') ? 'INCOMPLETE' : 'PASS';
  report.completionScope = 'Functional economy witnesses only; this report does not certify the full Agent 4 acceptance matrix or unmeasured performance.';
  await save(options.output, 'economy-report.json', stringify(report));
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await runEconomy(process.argv.slice(2));
    console.log(stringify({ status: report.status, timingStatus: report.timingStatus,
      report: join(parseOptions(process.argv.slice(2)).output, 'economy-report.json'),
      checks: Object.fromEntries(Object.entries(report.checks).map(([name, check]) => [name, check.status])), failures: report.failures }));
    if (report.status !== 'PASS') process.exitCode = report.status === 'INCOMPLETE' ? 2 : 1;
  } catch (error) { console.error(`${error.name}: ${error.message}`); process.exitCode = 1; }
}
