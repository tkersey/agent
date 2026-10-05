// Production-adjacent bounded property model. World artifacts/signatures/storage
// are abstract here and have separate concrete tests. The real transition core
// is exercised against independent custody, monotonicity and occurrence oracles.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../../runtime/mobility/custody.mjs';
import { hash, canonical } from '../../runtime/mobility/protocol.mjs';
const digest = value => hash(Buffer.from(String(value)));
const fingerprint = value => hash(canonical(value));
const hosts = ['A', 'B', 'C'], LEAF = 'model.leaf', CLEANUP = 'model.cleanup';
const limits = { maximum_moves: 4, maximum_image_bytes: 8388608, maximum_outcome_bytes: 8388608 };
const registration = { run_id: `issuer:${digest('run')}`, issuer_id: 'issuer', initial_host_id: 'A', initial_epoch: '0', principal_ref: 'user', tenant_ref: 'tenant',
  image_digest: digest('image'), program_id: digest('program'), trusted_runtime_profile: digest('runtime'), initial_classification: ['shared'], deployment_limits: limits, deployment_policy_revision: 'p1' };
const registrationDigest = fingerprint(registration);
const outcome = operation => operation === null ? { kind: 'cancelled', outcome_digest: digest('cancelled') } : {
  kind: 'requested', operation, outcome_digest: digest(`outcome:${operation}`), request_digest: digest(`request:${operation}`), state_digest: digest(`state:${operation}`),
};
function offer(run, destination, id) {
  return { run_id: run.run_id, transfer_id: id, source_host_id: run.host_id, destination_host_id: destination, source_epoch: run.custody_epoch,
    destination_epoch: (BigInt(run.custody_epoch) + 1n).toString(), execution_revision: run.execution_revision, run_registration_digest: run.registration_digest,
    predecessor_receipt_digest: run.predecessor_receipt_digest, image_digest: run.image_digest, program_id: run.program_id, trusted_runtime_profile: run.trusted_runtime_profile,
    outcome_digest: run.outcome_digest, state_digest: run.state_digest, request_digest: run.request_digest, relocation_occurrence_id: run.current_occurrence_id,
    classification: run.classification, deployment_limits: run.deployment_limits, cleanup_requirements: run.cleanup_requirements, resource_pin_summary: run.resource_pins };
}
function decision(record, accepted) {
  const value = record.offer;
  return { ...Object.fromEntries(['run_id', 'transfer_id', 'source_host_id', 'destination_host_id', 'source_epoch', 'destination_epoch', 'outcome_digest', 'relocation_occurrence_id'].map(key => [key, value[key]])),
    offer_digest: record.digest, decision: accepted ? 'accepted' : 'refused' };
}

test('seeded three-host traces preserve custody through epochs, duplicate decisions, revisions and cancellation races', () => {
  const coverage = {}; const count = name => { coverage[name] = (coverage[name] ?? 0) + 1; };
  for (let seed = 1; seed <= 128; seed++) {
    let randomState = seed, serial = 0, acceptedEpoch = 0;
    const random = maximum => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState % maximum; };
    const fresh = () => digest(`${seed}:${++serial}`);
    const states = { A: core.initial(registration, registrationDigest, 'A', outcome(core.RELOCATE), fresh()), B: null, C: null };
    const live = { A: false, B: false, C: false }, records = [], dispatched = new Set(), occurrences = new Set([states.A.run.current_occurrence_id]), retired = new Map();
    function install(host, next) { states[host] = { run: next.run, occurrence: next.occurrence }; }
    function receipt(record) {
      const source = record.offer.source_host_id, state = states[source];
      if (record.delivered) { count('duplicate'); return; } // Journal's terminal-ID rule.
      const next = core.decideSource(state.run, state.occurrence, record.offer, record.decision, fingerprint(record.decision), digest('refusal'));
      if (record.decision.decision === 'accepted') retired.set(`${source}:${record.offer.source_epoch}`, true);
      install(source, next); live[source] = false; record.delivered = true; count('receipt');
    }
    function accept(record) {
      const target = record.offer.destination_host_id, previous = states[target]?.run ?? null;
      if (previous && previous.status !== 'DEPARTED') {
        assert.throws(() => core.accept(previous, registration, record.offer, core.acceptedCore(record.offer, 'p1', record.offer.classification, limits), digest('receipt'), digest('arrival')), error => ['LocalCustodyConflict', 'RetiredRun'].includes(error.code));
        count('target_conflict'); return false;
      }
      const selected = decision(record, true), next = core.accept(previous, registration, record.offer, core.acceptedCore(record.offer, 'p1', record.offer.classification, limits), fingerprint(selected), digest('arrival'));
      assert.equal(Number(next.run.custody_epoch), ++acceptedEpoch);
      record.decision = selected; install(target, next); live[target] = false; count('accept'); if (acceptedEpoch === 4) count('epoch_four');
      assert.ok(hosts.filter(host => states[host]?.run.status === 'ACTIVE').length <= 1); return true;
    }
    // Include a concrete four-hop return with delayed old receipts. Random
    // schedules alone must not make required conflict/return coverage optional.
    if (seed % 8 === 0) {
      const freeze = (source, target) => {
        const state = states[source], value = offer(state.run, target, fresh()), bound = fingerprint(value);
        state.run = core.freeze(state.run, state.occurrence, core.version(state.run), value, bound); live[source] = false;
        const record = { offer: value, digest: bound, decision: null, delivered: false }; records.push(record); count('freeze'); return record;
      };
      const arrive = (host, operation = core.RELOCATE) => {
        const state = states[host]; state.run = core.attach(state.run); live[host] = true;
        const id = fresh(); occurrences.add(id);
        install(host, core.publish(state.run, state.occurrence, core.version(state.run), { kind: 'reply', reply_digest: state.occurrence.reply_digest }, outcome(operation), id));
      };
      const first = freeze('A', 'B'); assert.equal(accept(first), true); arrive('B');
      const second = freeze('B', 'C'); assert.equal(accept(second), true); arrive('C');
      const third = freeze('C', 'A'); assert.equal(accept(third), false); receipt(first); assert.equal(accept(third), true); arrive('A');
      const fourth = freeze('A', 'B'); assert.equal(accept(fourth), false); receipt(second); assert.equal(accept(fourth), true); arrive('B', LEAF);
    }
    for (let step = 0; step < 192; step++) {
      const actions = [];
      for (const host of hosts) {
        const state = states[host]; if (!state) continue;
        const { run, occurrence } = state, wanted = core.version(run);
        if (run.status === 'ACTIVE') {
          if (!live[host]) actions.push(() => { state.run = core.attach(run); live[host] = true; count('attach'); });
          else {
            actions.push(() => {
              state.run = core.attach(run);
              assert.throws(() => core.dispatch(state.run, occurrence, wanted, fresh(), []), { code: 'StaleExecutor' }); count('stale');
            });
            if (occurrence.status === 'READY' && occurrence.operation !== core.RELOCATE && (run.cancel_requested === null || occurrence.operation === CLEANUP)) actions.push(() => {
              assert.ok(!dispatched.has(occurrence.id)); dispatched.add(occurrence.id);
              install(host, core.dispatch(run, occurrence, wanted, fresh(), ['classified'], { cleanup: occurrence.operation === CLEANUP }));
              count(occurrence.operation === CLEANUP ? 'cleanup' : 'dispatch');
            });
            if (occurrence.status === 'SETTLED_REPLY' && !(run.cancel_requested && !run.cancel_applied && occurrence.operation === core.RELOCATE)) {
              for (const nextOperation of occurrence.operation === CLEANUP ? [null] : [LEAF, core.RELOCATE]) actions.push(() => {
                const id = fresh(); assert.ok(!occurrences.has(id)); occurrences.add(id);
                const next = core.publish(run, occurrence, wanted, { kind: 'reply', reply_digest: occurrence.reply_digest }, outcome(nextOperation), id);
                assert.equal(BigInt(next.run.execution_revision), BigInt(run.execution_revision) + 1n);
                assert.notEqual(next.run.current_occurrence_id, occurrence.id); install(host, next); count('publish');
              });
            }
            if (run.cancel_requested !== null && !run.cancel_applied && (['READY', 'AWAITING'].includes(occurrence.status) || (occurrence.status === 'SETTLED_REPLY' && occurrence.operation === core.RELOCATE))) actions.push(() => {
              install(host, core.publish(run, occurrence, wanted, { kind: 'cancel', reason: run.cancel_requested }, outcome(CLEANUP), fresh())); count('cancel_apply');
            });
          }
          if (live[host] && occurrence.status === 'READY' && occurrence.operation === LEAF && run.cancel_requested === null) actions.push(() => {
            install(host, core.awaiting(run, occurrence, wanted, fresh(), digest('question'), ['classified'])); count('defer');
          });
          if (occurrence.status === 'AWAITING') {
            const binding = { occurrence_id: occurrence.id, request_digest: occurrence.request_digest, pending_digest: occurrence.pending_digest };
            actions.push(() => {
              const next = () => core.answered(run, occurrence, wanted, binding, digest('answer'), digest('reply'), ['classified']);
              if (run.cancel_requested) { assert.throws(next, { code: 'CancellationPending' }); count('answer_loses'); }
              else { install(host, next()); count('answer_wins'); }
            });
          }
          if (['DISPATCHING', 'UNKNOWN'].includes(occurrence.status)) {
            actions.push(() => {
              const before = fingerprint(state);
              assert.throws(() => core.dispatch(run, occurrence, wanted, fresh(), []), error => ['UnsettledOccurrence', 'ExecutorNotAttached'].includes(error.code));
              assert.equal(fingerprint(state), before); count('no_redispatch');
            });
            actions.push(() => { state.occurrence = core.unknown(run, occurrence, occurrence.attempt_id); count('unknown'); });
            actions.push(() => { install(host, core.acquired(run, occurrence, occurrence.attempt_id, digest('reply'), ['classified'])); count('acquire'); });
          }
          if (occurrence.status === 'READY' && occurrence.operation === core.RELOCATE && run.cancel_requested === null && Number(run.custody_epoch) < 4 && records.length < 12) {
            if (run.resource_pins.length === 0) for (const target of hosts.filter(value => value !== host)) actions.push(() => {
              const value = offer(run, target, fresh()), bound = fingerprint(value);
              state.run = core.freeze(run, occurrence, wanted, value, bound); live[host] = false;
              records.push({ offer: value, digest: bound, decision: null, delivered: false }); count('freeze');
            });
            actions.push(() => { state.run = core.pin(run, wanted, 'local-resource', run.resource_pins.length === 0); count('pin'); });
          }
          actions.push(() => { live[host] = false; states[host] = structuredClone(state); count('crash'); });
        }
        if (run.status === 'OFFERED') {
          actions.push(() => {
            const before = fingerprint(state);
            assert.throws(() => core.dispatch(run, occurrence, wanted, fresh(), []), { code: 'CustodyFrozen' });
            assert.equal(fingerprint(state), before); count('frozen');
          });
        }
        if (step > 24 && seed % 4 !== 0 && ['ACTIVE', 'OFFERED', 'DEPARTED'].includes(run.status) && run.cancel_requested === null) actions.push(() => {
          state.run = core.cancel(run, 'stop'); live[host] = false; count('cancel');
        });
      }
      for (const record of records) {
        const source = record.offer.source_host_id, target = record.offer.destination_host_id;
        if (record.decision === null) {
          actions.push(() => { record.decision = decision(record, false); count('refuse'); });
          actions.push(() => accept(record));
        } else {
          actions.push(() => receipt(record));
          if (record.delivered && record.decision.decision === 'accepted' && states[source]?.run.status === 'DEPARTED' && states[source].run.transfer_id === record.offer.transfer_id && states[source].run.cancel_requested && ['ACTIVE', 'OFFERED', 'DEPARTED'].includes(states[target]?.run.status) && !states[target].run.cancel_requested) actions.push(() => {
            states[target].run = core.cancel(states[target].run, 'stop'); live[target] = false; count('forward');
          });
        }
      }
      if (!actions.length) break;
      const before = structuredClone(states);
      actions[random(actions.length)]();
      const actionable = hosts.filter(host => states[host]?.run.status === 'ACTIVE');
      assert.ok(actionable.length <= 1, `two custodians seed=${seed} step=${step}`);
      for (const host of hosts) if (states[host]) {
        const run = states[host].run;
        assert.ok(!(run.status === 'ACTIVE' && retired.has(`${host}:${run.custody_epoch}`)));
        if (before[host]) {
          assert.ok(BigInt(run.custody_epoch) >= BigInt(before[host].run.custody_epoch));
          assert.ok(BigInt(run.execution_revision) >= BigInt(before[host].run.execution_revision));
          assert.ok(before[host].run.classification.every(label => run.classification.includes(label)));
        }
      }
    }
  }
  for (const name of ['attach', 'stale', 'dispatch', 'cleanup', 'publish', 'cancel_apply', 'unknown', 'acquire', 'no_redispatch', 'freeze', 'pin', 'crash', 'frozen', 'cancel', 'refuse', 'accept', 'duplicate', 'receipt', 'target_conflict', 'epoch_four', 'forward', 'defer', 'answer_wins', 'answer_loses']) assert.ok(coverage[name] > 0, `unexercised model transition ${name}`);
  console.log(JSON.stringify({ model: 'custody-three-host-seeded/v1', seeds: 128, randomSteps: 192, maximumPrefixHops: 4, maximumEpoch: 4, coverage }));
});

test('deferred answer/cancellation order preserves the winner across detach, restart and duplicate attempts', () => {
  for (const ordering of [['answer', 'cancel'], ['cancel', 'answer']]) {
    let state = core.initial(registration, registrationDigest, 'A', outcome(LEAF), digest('question-occurrence'));
    state.run = core.attach(state.run);
    state = core.awaiting(state.run, state.occurrence, core.version(state.run), digest('attempt'), digest('question'), []);
    const binding = { occurrence_id: state.occurrence.id, request_digest: state.occurrence.request_digest, pending_digest: state.occurrence.pending_digest };
    assert.throws(() => core.answered(state.run, state.occurrence, core.version(state.run), { ...binding, occurrence_id: digest('retired-question') }, digest('yes'), digest('reply'), []), { code: 'QuestionMismatch' });
    let acquired = 0;
    for (const action of ordering) {
      state = structuredClone(state);
      if (action === 'cancel') state.run = core.cancel(state.run, 'stop');
      else {
        const invoke = () => core.answered(state.run, state.occurrence, core.version(state.run), binding, digest('yes'), digest('reply'), []);
        if (state.run.cancel_requested) assert.throws(invoke, { code: 'CancellationPending' });
        else {
          state = invoke(); acquired++; state = invoke();
          assert.throws(() => core.answered(state.run, state.occurrence, core.version(state.run), binding, digest('replacement-answer'), digest('replacement-reply'), []), { code: 'ReplyConflict' });
        }
      }
    }
    assert.equal(acquired, ordering[0] === 'answer' ? 1 : 0);
    state.run = core.attach(state.run);
    const control = acquired ? { kind: 'reply', reply_digest: digest('reply') } : { kind: 'cancel', reason: 'stop' };
    const next = core.publish(state.run, state.occurrence, core.version(state.run), control, outcome(CLEANUP), digest('next'));
    assert.throws(() => core.answered(next.run, next.occurrence, core.version(next.run), binding, digest('no'), digest('other'), []), { code: 'QuestionMismatch' });
  }
});
