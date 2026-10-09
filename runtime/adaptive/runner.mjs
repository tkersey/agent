// Drive one actual World image. Application branching remains inside that image.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {verifyRuntime, readDependencyLock, DEFAULT_LOCK, readRegular} from '../../tools/agent4/dependencies.mjs';
import {WorldAdmission} from '../mobility/admission.mjs';
import {Journal} from './journal.mjs';
import {application, configure, bindings, readFile} from './environment.mjs';
import {hash} from './codec.mjs';
import {same} from './admission.mjs';
import {canonical} from './json.mjs';
import * as model from './responses.mjs';
import * as preparation from './preparation.mjs';
import * as work from './work.mjs';
import {observe} from './observations.mjs';

const contracts = new Map([
  ['agent.adaptive.bindings.v1', ['Unit', 'Bindings', 'snapshot']],
  ['agent.adaptive.context.prepare.v1', ['Preparation', 'PreparationResult', 'context']],
  ['agent.adaptive.snapshot.work.v1', ['WorkRequest', 'WorkReply', 'snapshot']],
  ['agent.adaptive.snapshot.guards.v1', ['WorkRequest', 'WorkReply', 'invariant-review']],
  ['agent.adaptive.question.v1', ['Question', 'Answer', 'user']],
  ['agent.input.inbox.v1', ['Unit', 'Inbox', 'user']],
  ['agent.model.invoke.v6', ['AdaptiveRequest', 'AdaptiveResult', 'inference']],
]);
const terminal = kind => ['completed', 'failed', 'cancelled'].includes(kind);

export class AdaptiveRunner {
  // Cancellation also covers the gap between durable dispatch and acquisition;
  // a later request must not replace an already-aborted signal.
  #app; #world; #admission; #journal; #ctx; #executor; #options; #busy = false; #controller = new AbortController(); #onBoundary;
  static async open(options, {fault = () => {}, onBoundary = async () => {}} = {}) {
    assert.equal(process.platform, 'linux', 'adaptive JS execution is Linux-qualified only');
    const lockPath = options.lockPath ?? DEFAULT_LOCK;
    const observed = verifyRuntime(options.worldRuntime, {lockPath});
    const lock = readDependencyLock(lockPath), world = await import(pathToFileURL(observed.entrypoint).href);
    assert.equal(world.packageVersion, lock.world.version);
    assert.deepEqual(Object.keys(world).sort(), [...lock.world.runtime.exports].sort());
    const kernelBytes = readRegular(observed.kernelPath);
    assert.deepEqual(world.inspectKernelWasm(kernelBytes), lock.world.runtime.physicalProfile.inspection);
    const image = readFile(options.image, 16 * 1024 * 1024), appBytes = readFile(options.application, 16 * 1024 * 1024);
    const app = application(appBytes, image);
    const admission = new WorldAdmission(world, {kernelBytes, expectedSha256: observed.kernelSha256, maximumArtifactBytes: 16 * 1024 * 1024,
      maximumInputBytes: 64 * 1024, maximumWorkingBytes: 1024 * 1024, maximumOutputBytes: 64 * 1024});
    assert.deepEqual(verifyRuntime(options.worldRuntime, {lockPath}), observed, 'runtime changed during admission');
    const journal = await Journal.open({directory: options.stateDir, binding: {application: hash(appBytes), image: hash(image),
      runtime: observed.kernelSha256, client_mapping: app.value.client_mapping}, admission, create: !!options.create, fault});
    try {
      const task = journal.task();
      const saved = task ? {profile: journal.object(task.profile), resources: task.resources.map(id => journal.object(id))} : null;
      const ctx = configure(app, options, saved);
      const runner = new AdaptiveRunner(app, world, admission, journal, ctx, options, onBoundary);
      if (task) {
        runner.#ctx.task = [...Buffer.from(task.task_id, 'hex')];
        runner.#ctx.object = ref => journal.object(ref);
        await runner.#audit();
        if (!terminal(task.kind)) {
          const token = await admission.stored(image, journal.object(task.outcome), task.program);
          runner.#executor = await admission.resume(token);
        }
      }
      return runner;
    } catch (error) { await journal.close(); throw error; }
  }
  constructor(app, world, admission, journal, ctx, options, onBoundary) {
    this.#app = app; this.#world = world; this.#admission = admission; this.#journal = journal;
    this.#ctx = ctx; this.#options = options; this.#onBoundary = onBoundary;
    assert.equal(app.value.capabilities.length, contracts.size);
    for (const [identity, [input, output, role]] of contracts) {
      const entries = app.value.capabilities.filter(entry => entry.identity === identity && entry.resource_role === role &&
        entry.payload_sha256 === hash(ctx.codec.schema(input)) && entry.resume_sha256 === hash(ctx.codec.schema(output)));
      assert.equal(entries.length, 1, 'application capability mismatch');
    }
  }
  async start(input) {
    assert(!this.#executor && this.#journal.task() === null && !this.#busy, 'task already exists');
    const bytes = this.#ctx.codec.encode('Input', input), taskId = randomBytes(16).toString('hex');
    this.#ctx.task = [...Buffer.from(taskId, 'hex')];
    const executor = await this.#admission.start(this.#app.image, bytes, this.#app.value.program_identity);
    try {
      this.#journal.start(executor.current(), {profile: this.#ctx.profile, resources: this.#ctx.resources, input: bytes, taskId,
        attempts: this.#ctx.policy.model_attempts});
      this.#ctx.object = ref => this.#journal.object(ref); this.#executor = executor;
    } catch (error) { executor.retire(); throw error; }
    return this.status();
  }
  #request(outcome) {
    return this.#world.decodeRequest(this.#world.decodeOutcome(outcome).request);
  }
  #binding(request) {
    const value = contracts.get(request.semanticIdentity); assert(value, 'unavailable capability');
    const [input, output] = value;
    assert(Buffer.from(request.programIdentity).toString('hex') === this.#app.value.program_identity &&
      same(request.payloadSchema, this.#ctx.codec.schema(input)) && same(request.resumeSchema, this.#ctx.codec.schema(output)), 'capability schema mismatch');
    this.#ctx.codec.decode(input, request.payload); return value;
  }
  #prepare(request) {
    const identity = request.semanticIdentity, ctx = this.#ctx;
    this.#binding(request);
    if (identity === 'agent.adaptive.bindings.v1') return {bytes: bindings(ctx)};
    if (identity === 'agent.adaptive.context.prepare.v1') return {bytes: preparation.prepare(ctx, request.payload)};
    if (identity === 'agent.adaptive.snapshot.work.v1') return {bytes: work.prepare(ctx, request.payload)};
    if (identity === 'agent.adaptive.snapshot.guards.v1') return {bytes: work.prepare(ctx, request.payload, true)};
    if (identity === 'agent.model.invoke.v6') return {bytes: model.prepare(ctx, request.payload)};
    assert.equal(identity, 'agent.input.inbox.v1');
    const first = this.#journal.task().inbox[0] ?? null;
    const value = first ? {tag: 'message', value: {id: first.id, value: ctx.codec.decode('Message', this.#journal.object(first.value))}} : {tag: 'empty', value: null};
    return {bytes: ctx.codec.encode('Inbox', value), inbox: first?.id ?? null};
  }
  #project(request, prepared, captured, occurrence) {
    const identity = request.semanticIdentity, ctx = this.#ctx;
    this.#binding(request);
    if (identity === 'agent.model.invoke.v6') return model.interpret(ctx, request.payload, prepared, captured);
    if (identity === 'agent.adaptive.context.prepare.v1') return preparation.interpret(ctx, request.payload, prepared, captured);
    if (identity === 'agent.adaptive.snapshot.work.v1' || identity === 'agent.adaptive.snapshot.guards.v1')
      return work.interpret(ctx, request.payload, prepared, captured, identity === 'agent.adaptive.snapshot.guards.v1');
    assert(same(prepared, captured), 'echo capture mismatch');
    if (identity === 'agent.adaptive.bindings.v1') assert(same(prepared, bindings(ctx)));
    else {
      assert.equal(identity, 'agent.input.inbox.v1');
      const value = ctx.codec.decode('Inbox', prepared);
      assert(occurrence.inbox === null ? value.tag === 'empty' : value.tag === 'message' && value.value.id === occurrence.inbox);
    }
    return {reply: prepared, objects: [], output_tokens: null};
  }
  async #audit() {
    for (const occurrence of this.#journal.history()) {
      const request = await this.#request(this.#journal.object(occurrence.outcome));
      const binding = this.#binding(request);
      if (occurrence.reply) this.#ctx.codec.decode(binding[1], this.#journal.object(occurrence.reply));
      if (!occurrence.captured) continue;
      const projection = this.#project(request, this.#journal.object(occurrence.prepared), this.#journal.object(occurrence.captured), occurrence);
      if (occurrence.reply) {
        assert.equal(hash(projection.reply), occurrence.reply, 'saved projection mismatch');
        assert.deepEqual(projection.objects.map(hash), occurrence.objects, 'saved projection closure mismatch');
        for (const id of occurrence.objects) this.#journal.object(id);
        if (occurrence.inference) assert.equal(projection.output_tokens === null ? null : String(projection.output_tokens), occurrence.output_tokens);
      }
    }
  }
  async drive() {
    if (terminal(this.#journal.task()?.kind)) return this.status();
    assert(this.#executor && !this.#busy, 'executor unavailable'); this.#busy = true;
    try {
      for (let steps = 0; steps < 4096; steps++) {
        const task = this.#journal.task();
        if (terminal(task.kind)) return this.status();
        let occurrence = this.#journal.occurrence();
        if (occurrence && (['unknown', 'dispatching'].includes(occurrence.status) || occurrence.status === 'not_sent' && task.cancel === null)) return this.status();
        if (task.cancel !== null && (!occurrence || !['captured', 'replied'].includes(occurrence.status))) {
          const successor = await this.#executor.drive({kind: 'cancel', reason: task.cancel}); this.#journal.publish(successor); continue;
        }
        if (!occurrence) {
          const successor = await this.#executor.drive({kind: task.kind === 'yielded' ? 'resume_yield' : 'none'}); this.#journal.publish(successor); continue;
        }
        const request = await this.#request(this.#journal.object(task.outcome)); this.#binding(request);
        if (occurrence.status === 'waiting') return this.status();
        if (occurrence.status === 'ready') {
          if (request.semanticIdentity === 'agent.adaptive.question.v1') {
            this.#journal.wait(occurrence.id, request.payload); return this.status();
          }
          const prepared = this.#prepare(request);
          occurrence = this.#journal.prepare(occurrence.id, prepared.bytes, {inbox: prepared.inbox ?? null});
        }
        if (occurrence.status === 'prepared') {
          const inference = request.semanticIdentity === 'agent.model.invoke.v6';
          if (inference && !this.#ctx.offline && (!this.#ctx.provider.enabled || !this.#ctx.provider.token)) return {...this.status(), blocked: 'inference_authorization_required'};
          occurrence = this.#journal.dispatch(occurrence.id, inference);
          await this.#onBoundary({phase: 'dispatch', occurrence: occurrence.id, operation: request.semanticIdentity});
          const prepared = this.#journal.object(occurrence.prepared);
          let acquired;
          if (!inference) acquired = {kind: 'captured', bytes: prepared};
          else if (this.#ctx.offline) {
            const plan = this.#ctx.codec.decode('AdaptivePrepared', prepared).request.plan;
            const response = this.#ctx.fixture[Number(plan.watermark)]; assert(response, 'offline corpus exhausted');
            acquired = {kind: 'captured', bytes: this.#ctx.codec.encode('CapturedResponse', {status: 200, identity_encoding: true, request_id: null, body: canonical(response)})};
          } else {
            acquired = await model.acquire(this.#ctx, prepared, {...this.#ctx.provider, signal: this.#controller.signal});
          }
          if (acquired.kind === 'unknown') { this.#journal.unknown(occurrence.id, acquired.error); return this.status(); }
          if (acquired.kind === 'definitely_not_sent') { this.#journal.notSent(occurrence.id, acquired.error); return this.status(); }
          occurrence = this.#journal.capture(occurrence.id, acquired.bytes);
          await this.#onBoundary({phase: 'capture', occurrence: occurrence.id, operation: request.semanticIdentity});
        }
        if (occurrence.status === 'captured') {
          const projection = this.#project(request, this.#journal.object(occurrence.prepared), this.#journal.object(occurrence.captured), occurrence);
          this.#ctx.codec.decode(this.#binding(request)[1], projection.reply);
          occurrence = this.#journal.project(occurrence.id, projection);
        }
        assert.equal(occurrence.status, 'replied');
        const successor = await this.#executor.drive({kind: 'reply', value: this.#journal.object(occurrence.reply)});
        this.#journal.publish(successor);
        await this.#onBoundary({phase: 'successor', occurrence: occurrence.id, operation: request.semanticIdentity});
      }
      return {...this.status(), yielded: 'host_step_limit'};
    } finally { this.#busy = false; }
  }
  message(operationId, value) { return this.#journal.message(operationId, this.#ctx.codec.encode('Message', value)); }
  respond(operationId, questionId, requestDigest, value) {
    return this.#journal.respond(operationId, questionId, requestDigest, this.#ctx.codec.encode('Answer', value));
  }
  cancel(operationId, reason) { const result = this.#journal.cancel(operationId, reason); this.#controller.abort(); return result; }
  interrupt(reason) {
    try { return this.#journal.interrupt(reason); }
    finally { this.#controller.abort(); }
  }
  status() {
    const task = this.#journal.task(); if (!task) return {kind: 'empty'};
    const occurrence = this.#journal.occurrence();
    const result = {task_id: task.task_id, kind: task.kind, revision: task.revision, occurrence: occurrence?.status ?? null,
      model_attempts: task.attempts, observed_output_tokens: task.output_tokens, calls_without_output_usage: task.missing_output_usage,
      queued_messages: task.inbox.length, consumed_messages: task.consumed_messages.length, not_consumed_messages: task.not_consumed_messages?.length ?? 0, cancellation_requested: task.cancel !== null,
      storage: this.#journal.metrics(), provider_mode: this.#ctx.mode};
    if (occurrence?.status === 'waiting') result.question = {id: occurrence.id, request_digest: occurrence.request,
      value: this.#ctx.codec.toClient('Question', this.#ctx.codec.decode('Question', this.#journal.object(occurrence.question)))};
    if (occurrence?.reason) result.blocked = occurrence.reason;
    if (task.kind === 'completed') result.output = this.#ctx.codec.toClient('Output', this.#ctx.codec.decode('Output', this.#world.decodeOutcome(this.#journal.object(task.outcome)).value));
    return result;
  }
  metrics() { return {...this.#journal.metrics(), world: this.#executor?.usage() ?? null, process_peak_rss_bytes: process.resourceUsage().maxRSS * 1024}; }
  observations() {
    let previous = null;
    return this.#journal.history().filter(row => row.inference && row.captured).map(row => {
      const prepared = this.#journal.object(row.prepared);
      const measured = observe(this.#ctx.codec, prepared, this.#journal.object(row.captured), {previous,
        requestMilliseconds: row.acquired_ms >= row.started_ms ? row.acquired_ms - row.started_ms : null});
      previous = prepared; return measured;
    });
  }
  async close() { assert(!this.#busy); try { this.#executor?.retire(); } finally { await this.#journal.close(); } }
}
