// A local JS storage realization of the native prepared/captured/replied
// lifecycle. WorldAdmission alone certifies computation successors. This file
// does not read or write agent-native-state databases or choose domain actions.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:net';
import {mkdirSync, lstatSync, openSync, closeSync, constants} from 'node:fs';
import {resolve, join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {hash} from './codec.mjs';

const maximumObject = 16 * 1024 * 1024, namespaceBytes = 256 * 1024 * 1024, reservationBytes = 20 * 1024 * 1024;
const construction = Symbol('locked JS journal');
const json = value => JSON.stringify(value);
const identity = value => { assert(typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value), 'invalid operation ID'); return value; };
const privatePath = (path, directory) => {
  const stat = lstatSync(path);
  assert(!stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1) &&
    stat.uid === process.getuid() && (stat.mode & 0o077) === 0, 'private state required'); return stat;
};

export class Journal {
  #db; #lock; #admission; #fault;
  static async open({directory, binding, admission, create = false, fault = () => {}}) {
    assert.equal(process.platform, 'linux', 'JS persistence is Linux-qualified only');
    const root = resolve(directory);
    if (create) mkdirSync(root, {recursive: true, mode: 0o700});
    const dir = privatePath(root, true), lock = createServer(socket => socket.destroy());
    const address = `\0agent-adaptive-${hash(Buffer.from(`${process.getuid()}:${dir.dev}:${dir.ino}`))}`;
    await new Promise((resolve, reject) => { lock.once('error', reject); lock.listen(address, resolve); });
    try { return new Journal(construction, root, binding, admission, create, fault, lock); }
    catch (error) { await new Promise(resolve => lock.close(resolve)); throw error; }
  }
  constructor(token, root, binding, admission, create, fault, lock) {
    assert.equal(token, construction, 'use Journal.open');
    assert(lock?.listening && admission && typeof admission.read === 'function');
    this.#lock = lock; this.#admission = admission; this.#fault = fault;
    const path = join(root, 'adaptive-js.sqlite'); let fresh = false;
    try { privatePath(path, false); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      assert(create, 'missing JS state');
      closeSync(openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY, 0o600)); fresh = true;
    }
    this.#db = new DatabaseSync(path, {timeout: 5000, allowExtension: false, enableForeignKeyConstraints: true});
    try {
      this.#db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=EXTRA; PRAGMA fullfsync=ON; PRAGMA trusted_schema=OFF; PRAGMA max_page_count=65536;');
      assert.equal(this.#sql('get', 'PRAGMA journal_mode').journal_mode, 'delete');
      assert.equal(this.#sql('get', 'PRAGMA synchronous').synchronous, 3);
      assert.equal(this.#sql('get', 'PRAGMA page_size').page_size, 4096);
      if (fresh) this.#transaction('initialize', () => {
        this.#db.exec(`CREATE TABLE meta(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL) STRICT;
          CREATE TABLE objects(digest TEXT PRIMARY KEY,body BLOB NOT NULL) STRICT;
          CREATE TABLE task(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL) STRICT;
          CREATE TABLE occurrences(id INTEGER PRIMARY KEY,body TEXT NOT NULL) STRICT;
          CREATE TABLE operations(id TEXT PRIMARY KEY,request TEXT NOT NULL,result TEXT NOT NULL) STRICT;`);
        this.#sql('run', 'INSERT INTO meta VALUES(1,?)', json({format: 'agent-adaptive-js/1', binding}));
      });
      assert.deepEqual(JSON.parse(this.#sql('get', 'SELECT body FROM meta WHERE id=1').body), {format: 'agent-adaptive-js/1', binding}, 'incompatible JS state');
      assert.equal(this.#sql('get', 'PRAGMA quick_check').quick_check, 'ok');
      const occurrence = this.occurrence();
      if (occurrence?.status === 'dispatching') this.unknown(occurrence.id, 'process_lost_after_dispatch');
    } catch (error) { this.#db.close(); throw error; }
  }
  #sql(method, sql, ...parameters) {
    const statement = this.#db.prepare(sql);
    try { return statement[method](...parameters); } finally { statement.close(); }
  }
  #transaction(name, action) {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      this.#fault(`${name}.begin`); const result = action();
      this.#fault(`${name}.before_commit`); this.#db.exec('COMMIT'); this.#fault(`${name}.after_commit`); return result;
    } catch (error) { if (this.#db.isTransaction) this.#db.exec('ROLLBACK'); throw error; }
  }
  async close() { this.#db.close(); await new Promise(resolve => this.#lock.close(resolve)); }
  task() { const row = this.#sql('get', 'SELECT body FROM task WHERE id=1'); return row ? JSON.parse(row.body) : null; }
  occurrence(id = this.task()?.occurrence) {
    if (id === null || id === undefined) return null;
    const row = this.#sql('get', 'SELECT body FROM occurrences WHERE id=?', id); assert(row, 'missing occurrence'); return JSON.parse(row.body);
  }
  #task(task) { this.#sql('run', 'INSERT INTO task VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body', json(task)); }
  #occurrence(value) { this.#sql('run', 'INSERT INTO occurrences VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body', value.id, json(value)); }
  object(ref) {
    const key = typeof ref === 'string' ? ref : Buffer.from(ref.digest).toString('hex');
    assert(/^[a-f0-9]{64}$/.test(key));
    const row = this.#sql('get', 'SELECT body FROM objects WHERE digest=?', key); assert(row, 'missing artifact');
    const bytes = Buffer.from(row.body); assert.equal(hash(bytes), key, 'corrupt artifact');
    if (typeof ref !== 'string') assert.equal(BigInt(bytes.length), BigInt(ref.bytes));
    return bytes;
  }
  #put(bytes, reserved = false) {
    assert(bytes instanceof Uint8Array && bytes.length <= maximumObject, 'object capacity');
    const key = hash(bytes), prior = this.#sql('get', 'SELECT body FROM objects WHERE digest=?', key);
    if (prior) { assert(Buffer.from(prior.body).equals(Buffer.from(bytes)), 'artifact conflict'); return key; }
    const used = this.#sql('get', 'SELECT coalesce(sum(length(body)),0) AS bytes FROM objects').bytes;
    const current = this.occurrence();
    const reserve = !reserved && current && ['prepared', 'dispatching', 'captured', 'replied'].includes(current.status) ? reservationBytes : 0;
    assert(used + bytes.length + reserve <= namespaceBytes - 2 * 1024 * 1024, 'namespace capacity');
    this.#sql('run', 'INSERT INTO objects VALUES(?,?)', key, bytes); return key;
  }
  #newOccurrence(task, data) {
    if (data.metadata.kind !== 'requested') { task.occurrence = null; return; }
    assert(task.sequence < 4096, 'occurrence capacity');
    const id = ++task.sequence;
    task.occurrence = id;
    this.#occurrence({id, status: 'ready', operation: data.metadata.operation, request: data.metadata.request_digest, outcome: data.metadata.outcome_digest,
      prepared: null, captured: null, reply: null, objects: [], output_tokens: null, inbox: null});
  }
  start(token, {profile, resources, input, taskId = randomBytes(16).toString('hex'), attempts}) {
    const data = this.#admission.read(token);
    return this.#transaction('start', () => {
      assert(this.task() === null, 'state already contains a task');
      assert(/^[a-f0-9]{32}$/.test(taskId) && Number.isSafeInteger(attempts) && attempts > 0 && attempts <= 16);
      const task = {task_id: taskId, image: this.#put(data.image), program: data.metadata.program_id, profile: this.#put(profile),
        resources: resources.map(bytes => this.#put(bytes)), input: this.#put(input), outcome: this.#put(data.outcome), kind: data.metadata.kind,
        revision: 0, sequence: 0, occurrence: null, attempts: 0, maximum_attempts: attempts, output_tokens: '0',
        missing_output_usage: 0, inbox: [], consumed_messages: [], cancel: null};
      this.#newOccurrence(task, data); this.#task(task); return task;
    });
  }
  prepare(id, bytes, {inbox = null} = {}) {
    return this.#transaction('prepare', () => {
      const task = this.task(), current = this.occurrence(id);
      assert(task.occurrence === id && current.status === 'ready' && task.cancel === null);
      if (inbox !== null) assert(task.inbox[0]?.id === inbox, 'inbox ordering changed');
      const used = this.#sql('get', 'SELECT coalesce(sum(length(body)),0) AS bytes FROM objects').bytes;
      assert(used + bytes.length + reservationBytes <= namespaceBytes - 2 * 1024 * 1024, 'dispatch reservation capacity');
      current.prepared = this.#put(bytes); current.inbox = inbox; current.status = 'prepared'; this.#occurrence(current); return current;
    });
  }
  dispatch(id, inference) {
    return this.#transaction('dispatch', () => {
      const task = this.task(), current = this.occurrence(id);
      assert(task.occurrence === id && current.status === 'prepared' && task.cancel === null);
      if (inference) { assert(task.attempts < task.maximum_attempts, 'model allowance exhausted'); task.attempts++; }
      current.status = 'dispatching'; current.inference = inference; this.#occurrence(current); this.#task(task); return current;
    });
  }
  capture(id, bytes) {
    return this.#transaction('capture', () => {
      const task = this.task(), current = this.occurrence(id);
      assert(task.occurrence === id && current.status === 'dispatching');
      current.captured = this.#put(bytes, true); current.status = 'captured'; this.#occurrence(current); return current;
    });
  }
  project(id, projection) {
    return this.#transaction('project', () => {
      const task = this.task(), current = this.occurrence(id);
      assert(task.occurrence === id && current.status === 'captured');
      current.objects = projection.objects.map(bytes => this.#put(bytes, true)); current.reply = this.#put(projection.reply, true);
      if (current.inference) {
        if (projection.output_tokens === null) task.missing_output_usage++;
        else {
          const tokens = BigInt(projection.output_tokens); assert(tokens >= 0n && tokens <= (1n << 64n) - 1n);
          const total = BigInt(task.output_tokens) + tokens; assert(total <= (1n << 64n) - 1n, 'token accounting capacity');
          task.output_tokens = String(total); current.output_tokens = String(tokens);
        }
      }
      if (current.inbox !== null) {
        assert.equal(task.inbox[0]?.id, current.inbox); task.consumed_messages.push(task.inbox.shift().id);
      }
      current.status = 'replied'; this.#occurrence(current); this.#task(task); return current;
    });
  }
  unknown(id, reason) {
    return this.#transaction('unknown', () => {
      const task = this.task(), current = this.occurrence(id);
      assert(task.occurrence === id && current.status === 'dispatching');
      current.status = 'unknown'; current.reason = reason; this.#occurrence(current); return current;
    });
  }
  notSent(id, reason) {
    return this.#transaction('not-sent', () => {
      const task = this.task(), current = this.occurrence(id);
      assert(task.occurrence === id && current.status === 'dispatching');
      current.status = 'not_sent'; current.reason = reason; this.#occurrence(current); return current;
    });
  }
  wait(id, question) {
    return this.#transaction('question', () => {
      const task = this.task(), current = this.occurrence(id); assert(task.occurrence === id && current.status === 'ready');
      current.status = 'waiting'; current.question = this.#put(question); this.#occurrence(current); return current;
    });
  }
  #operation(id, value, action) {
    identity(id); const request = hash(Buffer.from(json(value))), prior = this.#sql('get', 'SELECT request,result FROM operations WHERE id=?', id);
    if (prior) { assert.equal(prior.request, request, 'operation ID conflict'); return JSON.parse(prior.result); }
    assert(this.#sql('get', 'SELECT count(*) AS n FROM operations').n < 256, 'operation capacity');
    const result = action(); this.#sql('run', 'INSERT INTO operations VALUES(?,?,?)', id, request, json(result)); return result;
  }
  respond(operationId, id, requestDigest, answer) {
    return this.#transaction('respond', () => this.#operation(operationId, {id, requestDigest, answer: hash(answer)}, () => {
      const task = this.task(), current = this.occurrence(id);
      assert(task.occurrence === id && current.status === 'waiting' && current.request === requestDigest && task.cancel === null, 'stale question');
      current.reply = this.#put(answer); current.status = 'replied'; this.#occurrence(current); return {question_id: id, answered: true};
    }));
  }
  message(operationId, bytes) {
    return this.#transaction('message', () => this.#operation(operationId, {message: hash(bytes)}, () => {
      const task = this.task(); assert(task && !['completed', 'failed', 'cancelled'].includes(task.kind) && task.cancel === null);
      assert(task.inbox.length + task.consumed_messages.length < 4, 'message capacity');
      task.inbox.push({id: operationId, value: this.#put(bytes)}); this.#task(task); return {message_id: operationId, queued: true};
    }));
  }
  cancel(operationId, reason) {
    return this.#transaction('cancel', () => this.#operation(operationId, {reason}, () => {
      assert(typeof reason === 'string' && reason.isWellFormed() && Buffer.byteLength(reason) <= 256);
      const task = this.task(); assert(task && !['completed', 'failed', 'cancelled'].includes(task.kind));
      task.cancel ??= reason; this.#task(task); return {requested: true};
    }));
  }
  publish(token) {
    const data = this.#admission.read(token);
    return this.#transaction('publish', () => {
      const task = this.task(), current = this.occurrence();
      assert(data.metadata.image_digest === task.image && data.metadata.program_id === task.program && data.predecessor?.outcome_digest === task.outcome);
      const control = data.predecessor.control;
      if (control.kind === 'reply') assert(current?.status === 'replied' && current.reply === control.reply_digest);
      else if (control.kind === 'cancel') assert(task.cancel === control.reason && (!current || !['dispatching', 'unknown'].includes(current.status)));
      else assert(current === null && ['none', 'resume_yield'].includes(control.kind));
      if (current) { current.status = 'consumed'; this.#occurrence(current); }
      task.outcome = this.#put(data.outcome, true); task.kind = data.metadata.kind; task.revision++;
      this.#newOccurrence(task, data); this.#task(task); return task;
    });
  }
  metrics() {
    const row = this.#sql('get', 'SELECT count(*) AS objects,coalesce(sum(length(body)),0) AS bytes FROM objects');
    return {...row, database_bytes: this.#sql('get', 'PRAGMA page_count').page_count * 4096};
  }
  history() { return this.#sql('all', 'SELECT body FROM occurrences ORDER BY id').map(row => JSON.parse(row.body)); }
}
