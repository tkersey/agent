// Generic actual World executor. No credentials, peer keys or application flow.
import { Kernel, decodeOutcome, encodeResult } from '/world/index.mjs';
let kernel, prepared, session, outcome, retired = false, busy = false;
self.onmessage = async ({ data }) => {
  if (busy || retired) { self.postMessage({ error: 'ExecutorUnavailable' }); return; }
  busy = true;
  try {
    if (data.kind === 'restore') {
      if (kernel || data.origin !== self.location.origin) throw new Error('OriginDenied');
      kernel = await Kernel.create({ bytes: new Uint8Array(await (await fetch('/kernel.wasm')).arrayBuffer()), expectedSha256: data.runtime_profile });
      kernel.setLimits({ input: 8 << 20, working: 64 << 20, output: 8 << 20 });
      prepared = kernel.prepare(new Uint8Array(data.image));
      const prior = decodeOutcome(new Uint8Array(data.outcome)); session = kernel.restore(prepared, prior.state); outcome = new Uint8Array(data.outcome);
    } else if (data.kind === 'drive') {
      const prior = decodeOutcome(outcome);
      const value = data.control === 'reply' ? await encodeResult(prior.request, new Uint8Array(data.reply)) : data.control === 'cancel' ? data.reason : new Uint8Array();
      outcome = kernel.drive(session, { control: data.control === 'cancel' ? 'cancel_text' : data.control, value, quantum: 10000n, checkpoint: true });
    } else if (data.kind === 'retire') {
      const prior = decodeOutcome(outcome);
      if (['completed', 'failed', 'cancelled'].includes(prior.kind)) kernel.close(session); else kernel.checkpoint(session, { transfer: true });
      kernel.releasePrepared(prepared); retired = true; self.postMessage({ retired: true }); return;
    } else throw new Error('InvalidCommand');
    self.postMessage({ outcome: Array.from(outcome) });
  } catch (error) { self.postMessage({ error: error.code ?? error.message }); }
  finally { busy = false; }
};
