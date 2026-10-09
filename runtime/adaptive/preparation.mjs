// Pure environmental projection of an authored control proposal. This module
// cannot choose a control, execute a work tool, or advance the application.
import assert from 'node:assert/strict';
import {canonical} from './json.mjs';
import {object, same, digest, identities} from './admission.mjs';
import {prepare as prepareModel} from './responses.mjs';
import {capturedCall, open as openWork, evidence, verifyEvidence, reference} from './work.mjs';

const equivalent = (left, right) => same(canonical(left), canonical(right));
const profile = (policy, id) => {
  const value = policy.profiles.find(entry => entry.id === id);
  assert(value, 'unknown inference profile'); return value;
};
const next = value => { const n = BigInt(value) + 1n; assert(n <= (1n << 64n) - 1n, 'revision capacity'); return n; };

export function instructions(core, policy, catalog) {
  const metadata = {profiles: policy.profiles.map(({id, model, efforts}) => ({id, model, efforts})),
    skills: catalog.skills.map(({id, version, description}) => ({id, version, description}))};
  const value = `${core}\nApproved catalog:\n${canonical(metadata).toString()}`;
  assert(Buffer.byteLength(value) <= 8192, 'catalog metadata capacity'); return value;
}

function controlSource(ctx, state, subject) {
  assert(state.replay !== null, 'missing control source');
  const {context, action} = capturedCall(ctx, state.replay, subject.call_id);
  assert(equivalent(state.control.selection, context.selection) && BigInt(state.control.epoch) === BigInt(context.plan.epoch) &&
    BigInt(state.control.eviction_generation) === BigInt(context.plan.eviction_generation) && equivalent(state.control.skills, context.plan.skills));
  assert(['inference_set', 'skill_set'].includes(action.tag) && action.value.reason === subject.reason, 'control source mismatch');
  if (subject.proposal.disposition !== 'rejected') assert.equal(BigInt(action.value.expected_revision), BigInt(state.control.selection.control_revision));
  if (subject.proposal.disposition === 'proposed' && action.tag === 'inference_set') assert(
    subject.proposal.state.selection.profile_id === action.value.profile_id && subject.proposal.state.selection.effective_effort === action.value.effort);
  return context;
}

function receiptText(ctx, receipt, control) {
  const value = ctx.codec.toClient('ControlReceipt', receipt);
  for (const key of ['previous_revision', 'next_revision', 'context_epoch', 'eviction_generation']) value[key] = BigInt(receipt[key]);
  value.takes_effect = 'next inference; no provider request has been executed by this control';
  value.skills = ctx.codec.toClient('ControlState', control).skills;
  return canonical(value, 32768).toString();
}

function evaluate(ctx, input) {
  const policy = ctx.policy, catalog = ctx.catalog;
  let control = input.state.control, receipt = null, text = null;
  const pending = input.state.results;
  let results = pending.map(item => {
    let content;
    if (item.output.tag === 'inline_text') content = item.output.value;
    else if (item.output.tag === 'work') {
      const record = openWork(ctx, item.output.value); assert.equal(record.call_id, item.call_id); content = record.model_text;
    } else {
      assert.equal(item.output.tag, 'control');
      const record = ctx.codec.decode('ReceiptArtifact', object(ctx, item.output.value, 128 * 1024));
      assert(same(record.receipt.task, ctx.task) && record.receipt.call_id === item.call_id); content = record.model_text;
    }
    return {call_id: item.call_id, output: content};
  });
  if (input.control !== null) {
    const subject = input.control, prior = controlSource(ctx, input.state, subject);
    assert(input.state.receipts.length < 16, 'receipt capacity');
    if (subject.proposal.disposition === 'proposed') {
      assert.equal(subject.proposal.rejection, 'none');
      assert.equal(BigInt(subject.proposal.state.selection.control_revision), next(control.selection.control_revision));
      control = subject.proposal.state;
    } else assert(equivalent(control, subject.proposal.state));
    receipt = {task: ctx.task, source: prior.source_capture, call_id: subject.call_id,
      previous_revision: input.state.control.selection.control_revision, next_revision: control.selection.control_revision,
      disposition: subject.proposal.disposition === 'proposed' ? 'admitted' : subject.proposal.disposition,
      rejection: subject.proposal.rejection, previous_profile: input.state.control.selection.profile_id, next_profile: control.selection.profile_id,
      previous_model: profile(policy, input.state.control.selection.profile_id).model, next_model: profile(policy, control.selection.profile_id).model,
      previous_effort: input.state.control.selection.effective_effort, next_effort: control.selection.effective_effort,
      context_epoch: control.epoch, eviction_generation: control.eviction_generation};
    text = receiptText(ctx, receipt, control);
    results = [{call_id: subject.call_id, output: text}];
  }
  const selected = profile(policy, control.selection.profile_id);
  const materialized = [...policy.core_tools], offered = [...policy.core_tools];
  for (const loaded of control.skills) {
    const skill = catalog.skills.find(entry => entry.id === loaded.skill_id);
    if (skill) skill.tools.forEach((enabled, index) => { materialized[index] ||= enabled; offered[index] ||= enabled && loaded.active; });
  }
  offered.forEach((enabled, index) => { offered[index] = enabled && input.offered[index] && policy.permitted_tools[index]; });
  const request = {policy: digest(ctx.profile), selection: control.selection, materialized, offered, results,
    plan: {epoch: control.epoch, reason: control.epoch_reason, watermark: input.state.replay?.watermark ?? 0,
      eviction_generation: control.eviction_generation, prior: input.state.replay, handoff: input.state.handoff, catalog: policy.catalog, skills: control.skills},
    invocation: {protocol: 'agent.model.protocol.openai-responses-v2', model: selected.model,
      parameters: {max_output_tokens: selected.max_output_tokens, temperature: null, reasoning: {effort: control.top_effort, summary: null}},
      messages: input.state.messages, tools: ctx.tools.filter((_tool, index) => materialized[index]),
      selection: {minimum_calls: 1, maximum_calls: 1, parallel_calls: false},
      response_policy: {store: false, stream: false, background: false, truncation: 'disabled'},
      normalization_limits: ctx.codec.constant('normalization_limits', 'NormalizationLimits'), maximum_provider_response_bytes: selected.response_bytes}};
  let seed = null;
  const prior = input.state.replay;
  if (prior !== null && BigInt(control.epoch) !== BigInt(prior.epoch) && (input.control !== null || input.state.handoff === null)) {
    const facts = {original_task: input.state.task, followups: input.state.followups,
      evidence: input.state.evidence.map(ref => { const item = evidence(ctx, ref); verifyEvidence(ctx, item); return item; }),
      work_outcomes: input.state.outcomes.map(item => item.tag === 'answer' ? {tag: 'ask', value: item.value} : openWork(ctx, item.value).outcome),
      prior_controls: input.state.receipts, current_control: receipt, pending_model_hypothesis: input.control?.reason ?? input.state.pending_model_intent,
      control, remaining_model_calls: Math.max(0, policy.model_attempts - input.state.model_calls), remaining_work_calls: Math.max(0, 12 - input.state.work_calls),
      pending_questions: [], completion_criteria: 'Answer the original task and consumed follow-ups using acquired evidence, distinguishing observations from hypotheses and unrun checks.'};
    const factText = canonical(ctx.codec.toClient('Handoff', facts), 8192).toString();
    seed = ctx.codec.encode('AdaptiveSeed', {schema: identities.seed, policy: request.policy, task: ctx.task, tenant: ctx.tenant,
      audience: policy.audience, selection: control.selection, epoch: control.epoch, watermark: prior.watermark,
      eviction_generation: control.eviction_generation, source: prior,
      messages: [{role: 'developer', content: instructions(ctx.instructions, policy, catalog)}, {role: 'user', content: input.state.task},
        {role: 'developer', content: factText}]});
    request.plan.handoff = reference(seed);
  }
  const overlay = {...ctx, object: ref => seed !== null && same(digest(seed), ref.digest) && BigInt(seed.length) === BigInt(ref.bytes) ? seed : ctx.object(ref)};
  prepareModel(overlay, ctx.codec.encode('AdaptiveRequest', request));
  const objects = seed === null ? [] : [seed];
  let receiptRef = null, nextResults = pending;
  if (receipt !== null) {
    const bytes = ctx.codec.encode('ReceiptArtifact', {receipt, model_text: text}), ref = reference(bytes); objects.push(bytes);
    receiptRef = {object: ref, previous_revision: receipt.previous_revision, next_revision: receipt.next_revision, disposition: receipt.disposition,
      rejection: receipt.rejection, next_profile: receipt.next_profile, next_effort: receipt.next_effort, context_epoch: receipt.context_epoch,
      eviction_generation: receipt.eviction_generation};
    nextResults = [{call_id: receipt.call_id, output: {tag: 'control', value: ref}}];
  }
  return {result: {tag: 'ready', value: {request, receipt: receiptRef, results: nextResults}}, objects};
}

export function prepare(ctx, bytes) {
  const input = ctx.codec.decode('Preparation', bytes);
  let product;
  try { product = evaluate(ctx, input); }
  catch (error) {
    let rejection;
    if (/capacity/i.test(error.message) || error.code === 'ValueCapacity') rejection = 'capacity';
    else if (/unknown inference profile/.test(error.message)) rejection = 'unknown_profile';
    else if (/unknown or duplicate skill/.test(error.message)) rejection = 'unknown_skill';
    else if (/unsupported effort/.test(error.message)) rejection = 'unsupported_effort';
    else throw error;
    product = {result: {tag: 'rejected', value: rejection}, objects: []};
  }
  return ctx.codec.encode('PreparationProduct', product);
}
export function interpret(ctx, request, prepared, captured) {
  assert(same(prepared, captured) && same(prepare(ctx, request), prepared), 'invalid context preparation capture');
  const product = ctx.codec.decode('PreparationProduct', prepared);
  return {reply: ctx.codec.encode('PreparationResult', product.result), objects: product.objects, output_tokens: null};
}
