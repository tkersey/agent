import { canonical } from '/canonical.mjs';
import { decodeOutcome, decodeRequest } from '/world/index.mjs';
import { decodeSchema, decodeValue } from '/agent-values.mjs';
const encodeVersion = value => btoa(String.fromCharCode(...canonical(value))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

// The UI follows the current typed World outcome. It contains no application
// task sequence, destination selection, reconstructed locals or retry plan.
export class BrowserExecutor {
  constructor(id, onOutcome = () => {}) {
    this.base = `/v1/browser/runs/${encodeURIComponent(id)}/`;
    this.assignment = null; this.worker = null; this.output = null; this.retired = 0; this.onOutcome = onOutcome;
  }
  async initialize() { this.session = await (await fetch('/v1/browser/session')).json(); return this; }
  async api(name, method = 'POST', bytes = null) {
    const headers = { 'x-agent-csrf': this.session.csrf };
    if (this.assignment) { headers['x-agent-assignment'] = this.assignment.nonce; headers['x-agent-version'] = encodeVersion(this.assignment.version); }
    const response = await fetch(this.base + name, { method, headers, body: bytes });
    if (!response.ok) throw new Error((await response.json()).error);
    return response;
  }
  workerCall(data) {
    return new Promise((resolve, reject) => {
      this.worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data);
      this.worker.onerror = event => reject(new Error(event.message)); this.worker.postMessage(data);
    });
  }
  async observe(output) {
    this.output = new Uint8Array(output);
    const outcome = decodeOutcome(this.output);
    let observation = { kind: outcome.kind };
    if (outcome.kind === 'requested') {
      const request = await decodeRequest(outcome.request);
      observation = { ...observation, operation: request.semanticIdentity, payload: decodeValue(decodeSchema(request.payloadSchema), request.payload) };
      if (request.semanticIdentity === 'agent.repository.next-task.v1') observation.taskReport = observation.payload[0];
    }
    if (outcome.kind === 'completed') {
      const response = await this.api('result-schema', 'GET').catch(() => null);
      if (response) observation.value = decodeValue(decodeSchema(new Uint8Array(await response.arrayBuffer())), outcome.value);
    }
    await this.onOutcome(observation);
  }
  async attach() {
    if (this.worker) throw new Error('OldWorkerStillAlive');
    this.assignment = await (await this.api('attach')).json();
    const image = new Uint8Array(await (await this.api('image', 'GET')).arrayBuffer());
    const outcome = new Uint8Array(await (await this.api('outcome', 'GET')).arrayBuffer());
    this.worker = new Worker('/worker.mjs', { type: 'module' });
    try { await this.observe((await this.workerCall({ kind: 'restore', image, outcome, runtime_profile: this.assignment.runtime_profile, origin: location.origin })).outcome); }
    catch (error) { this.worker.terminate(); this.worker = null; throw error; }
  }
  async advance() {
    const command = await (await this.api('command')).json();
    if (command.kind !== 'drive') return command;
    const reply = command.control === 'reply' ? new Uint8Array(await (await this.api('reply', 'GET')).arrayBuffer()) : [];
    const output = (await this.workerCall({ kind: 'drive', control: command.control, reply, reason: command.reason })).outcome;
    const result = await (await this.api('report', 'POST', new Uint8Array(output))).json();
    this.assignment.version = result.version; await this.observe(output); return result;
  }
  async retire() {
    if (!this.worker) return;
    try { await this.workerCall({ kind: 'retire' }); }
    finally { this.worker.terminate(); this.worker = null; this.retired++; }
  }
}

if (typeof document !== 'undefined' && document.querySelector('#connect')) {
  let executor, pending;
  const status = document.querySelector('#status'), request = document.querySelector('#request');
  const action = handler => async event => {
    const buttons = [...document.querySelectorAll('button')]; buttons.forEach(button => { button.disabled = true; });
    try { await handler(event); } catch (error) { status.textContent = error.message; }
    finally { buttons.forEach(button => { button.disabled = false; }); }
  };
  const answerForm = document.querySelector('#answer');
  async function showQuestion() {
    if (!answerForm) return;
    pending = await (await executor.api('question', 'GET')).json();
    answerForm.hidden = !pending || pending.acquired;
    if (!pending || pending.acquired) return;
    const question = document.querySelector('#question'), value = pending.pending.question;
    question.replaceChildren();
    if (value?.kind === 'repository-publication-approval' || (['repository-review', 'repository-next-task'].includes(value?.kind) && value.proposal)) {
      const publishing = value.kind === 'repository-publication-approval';
      const proposal = JSON.parse(publishing ? value.challenge[1] : value.proposal), core = proposal.core;
      if (!Array.isArray(core.diff) || core.diff.length !== core.candidate.edits.length) throw new Error('The complete change is unavailable for review.');
      const paragraph = text => { const p = document.createElement('p'); p.textContent = text; question.append(p); };
      paragraph(`${publishing ? "Publish to" : "Review a proposal for"} managed branch ${core.destination.managedRef} in ${core.destination.repository}.`);
      paragraph(publishing ? 'Approval publishes this exact commit in the service-owned repository. Your checkout and upstream repository are not updated.' : 'This task does not publish. You can finish, ask a question, or amend the requested task.');
      paragraph(`Base: ${core.destination.expectedBase}\nPrepared commit: ${proposal.commitOid}\nProposal: ${proposal.digest}`);
      for (const check of core.validation) paragraph(`Check: ${check.profile} — ${check.status}. Profile ${check.profileDigest}; runner ${check.runner}.`);
      paragraph('Validation covers the listed check contracts. Other behavior has not been established by these checks.');
      for (const edit of core.diff) {
        const details = document.createElement('details'), summary = document.createElement('summary');
        details.open = true; summary.textContent = `${edit.operation}: ${edit.path}`; details.append(summary);
        for (const [label, content] of [['Before', edit.oldContent], ['After', edit.newContent]]) {
          const heading = document.createElement('h3'), source = document.createElement('pre');
          heading.textContent = label; source.textContent = content === null ? '(file absent)' : content;
          details.append(heading, source);
        }
        question.append(details);
      }
    } else question.textContent = ['repository-review', 'repository-next-task'].includes(value?.kind) ? value.summary : JSON.stringify(value, null, 2);
    if (value?.kind === 'repository-next-task') {
      const explanation = document.createElement('p');
      explanation.textContent = `Task ${value.generation} is finished. Choose stop, or select a mode and enter the next goal. Task ${value.next_generation} has up to ${value.allocation.steps} model steps, ${value.allocation.checks} checks and ${value.allocation.moves} moves, subject to the remaining session-wide limits. ${value.memory}`;
      question.append(explanation);
    }
    const choices = document.querySelector('#choice'); choices.replaceChildren();
    if (['repository-publication-approval', 'repository-review', 'repository-next-task'].includes(value?.kind)) {
      const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose a response';
      placeholder.disabled = true; placeholder.selected = true; choices.append(placeholder);
    }
    for (const value of pending.pending.alternatives) { const option = document.createElement('option'); option.value = value; option.textContent = value; choices.append(option); }
    document.querySelector('#answer-text').maxLength = pending.pending.maximum_text_bytes;
    status.textContent = 'Awaiting your response';
  }
  if (answerForm) answerForm.onsubmit = action(async event => {
    event.preventDefault(); if (!pending) throw new Error('Reconnect to the current question.');
    const { version, occurrence_id, request_digest, pending_digest } = pending;
    await executor.api('answer', 'POST', canonical({ version, occurrence_id, request_digest, pending_digest,
      answer: { choice: document.querySelector('#choice').value, text: document.querySelector('#answer-text').value } }));
    answerForm.hidden = true; document.querySelector('#answer-text').value = ''; status.textContent = 'Response saved. Continue when ready.';
  });
  document.querySelector('#connect').onclick = action(async () => {
    if (executor) await executor.retire();
    executor = await new BrowserExecutor(document.querySelector('#run').value, value => {
      request.textContent = JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2);
      const download = document.querySelector('#export-result');
      const report = value.kind === 'completed' ? value.value : value.taskReport;
      if (download && report !== undefined) {
        if (download.href.startsWith('blob:')) URL.revokeObjectURL(download.href);
        const exported = JSON.stringify({ kind: 'completed', value: report }, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2);
        download.href = URL.createObjectURL(new Blob([exported], { type: 'application/json' })); download.hidden = false;
      }
    }).initialize();
    await executor.attach(); status.textContent = 'Connected'; await showQuestion();
  });
  document.querySelector('#continue').onclick = action(async () => {
    if (!executor) throw new Error('Enter a run and connect first.');
    if (!executor.worker) {
      const current = await (await executor.api('status', 'GET')).json();
      if (current.custody === 'OFFERED') {
        const decision = await (await executor.api('retry')).json();
        status.textContent = decision.kind === 'unknown' ? 'Waiting for a custody decision. The run remains paused.' : decision.kind === 'refused' ? 'Move declined. Continue here.' : 'Continuing at another host. Reconnect when it returns.';
        return;
      }
      if (current.custody === 'DEPARTED') { status.textContent = 'Continuing at another host. Reconnect when it returns.'; return; }
      if (current.delivery?.presentation === 'pending') { status.textContent = 'Published; presentation pending'; request.textContent = JSON.stringify(current.delivery.receipt, null, 2); }
      if (current.custody === 'TERMINAL') { if (!current.delivery) status.textContent = 'Finished'; return; }
      await executor.attach(); status.textContent = 'Connected'; await showQuestion(); return;
    }
    const result = await executor.advance();
    if (result.kind === 'offered') {
      await executor.retire();
      const decision = await (await executor.api('retry')).json();
      status.textContent = decision.kind === 'accepted' ? 'Continuing at another host. Reconnect when it returns.' : decision.kind === 'refused' ? 'Move declined. Continue here.' : 'Waiting for a custody decision. The run remains paused.';
    } else if (result.status?.custody === 'TERMINAL') { await executor.retire(); status.textContent = 'Finished'; }
    else { status.textContent = result.kind === 'blocked' ? 'Waiting for a response' : 'Ready'; await showQuestion(); }
  });
  document.querySelector('#cancel').onclick = action(async () => {
    if (!executor) throw new Error('Enter a run and connect first.');
    await executor.retire(); if (answerForm) answerForm.hidden = true; pending = null;
    const result = await (await executor.api('cancel', 'POST', canonical({ reason: 'User cancelled' }))).json();
    status.textContent = ['cancel_pending', 'unknown'].includes(result.kind) ? 'Cancellation is waiting for the current host or a custody decision.' : 'Cancellation requested';
  });
  const startForm = document.querySelector('#start-task');
  if (startForm) {
    const selector = document.querySelector('#task-entry'), mode = document.querySelector('#task-mode');
    let catalogue = [];
    const selected = () => catalogue.find(entry => entry.id === selector.value);
    selector.onchange = () => {
      const entry = selected(); mode.replaceChildren();
      if (!entry) return;
      document.querySelector('#task-scope').textContent = JSON.stringify({ repository: entry.repository, base: entry.base, scope: entry.scope, profile: entry.profile, budget: entry.budget }, null, 2);
      for (const name of entry.modes) { const option = document.createElement('option'); option.value = name; option.textContent = name; mode.append(option); }
      mode.value = entry.defaultMode;
    };
    fetch('/v1/browser/tasks').then(async response => { if (!response.ok) throw new Error('Task catalogue unavailable'); return response.json(); }).then(entries => {
      catalogue = entries;
      for (const entry of entries) { const option = document.createElement('option'); option.value = entry.id; option.textContent = entry.title; selector.append(option); }
      startForm.hidden = entries.length === 0; selector.onchange();
    }).catch(error => { status.textContent = error.message; });
    startForm.onsubmit = action(async event => {
      event.preventDefault();
      const session = await (await fetch('/v1/browser/session')).json();
      const response = await fetch('/v1/browser/tasks', { method: 'POST', headers: { 'x-agent-csrf': session.csrf },
        body: canonical({ entry: selector.value, mode: mode.value, goal: document.querySelector('#task-goal').value }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      document.querySelector('#run').value = result.run_id;
      status.textContent = 'Task registered. Connect to start execution.';
    });
  }
  addEventListener('pagehide', () => executor?.worker?.terminate());
}
