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
  let executor;
  const status = document.querySelector('#status'), request = document.querySelector('#request');
  const action = handler => async event => {
    const buttons = [...document.querySelectorAll('button')]; buttons.forEach(button => { button.disabled = true; });
    try { await handler(event); } catch (error) { status.textContent = error.message; }
    finally { buttons.forEach(button => { button.disabled = false; }); }
  };
  document.querySelector('#connect').onclick = action(async () => {
    if (executor) await executor.retire();
    executor = await new BrowserExecutor(document.querySelector('#run').value, value => {
      request.textContent = JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2);
    }).initialize();
    await executor.attach(); status.textContent = 'Connected';
  });
  document.querySelector('#continue').onclick = action(async () => {
    if (!executor) throw new Error('Enter a run and connect first.');
    if (!executor.worker) { await executor.attach(); status.textContent = 'Connected'; return; }
    const result = await executor.advance();
    if (result.kind === 'offered') {
      await executor.retire();
      const decision = await (await executor.api('retry')).json();
      status.textContent = decision.kind === 'accepted' ? 'Continuing at another host. Reconnect when it returns.' : decision.kind === 'refused' ? 'Move declined. Continue here.' : 'Waiting for a custody decision. The run remains paused.';
    } else if (result.status?.custody === 'TERMINAL') { await executor.retire(); status.textContent = 'Finished'; }
    else status.textContent = result.kind === 'blocked' ? 'Waiting for a response' : 'Ready';
  });
  document.querySelector('#cancel').onclick = action(async () => {
    if (!executor) throw new Error('Enter a run and connect first.');
    await executor.retire();
    const result = await (await executor.api('cancel', 'POST', canonical({ reason: 'User cancelled' }))).json();
    status.textContent = result.kind === 'cancel_pending' ? 'Cancellation is waiting for the current host.' : 'Cancellation requested';
  });
  addEventListener('pagehide', () => executor?.worker?.terminate());
}
