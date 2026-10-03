// Test executor: actual World execution only, no application routing.
import { Kernel, decodeOutcome, encodeResult } from '/world/index.mjs';
let kernel, prepared, session, output;
self.onmessage = async ({ data }) => {
  try {
    if (data.kind === 'start' || data.kind === 'restore') {
      if (kernel) throw new Error('ExecutorAlreadyAttached');
      kernel = await Kernel.create({ bytes: new Uint8Array(await (await fetch('/kernel.wasm')).arrayBuffer()), expectedSha256: data.sha256 });
      kernel.setLimits({ input: data.limit, working: data.limit, output: data.limit });
      prepared = kernel.prepare(new Uint8Array(data.image));
      session = data.kind === 'start' ? kernel.start(prepared, new Uint8Array(data.args)) : kernel.restore(prepared, new Uint8Array(data.state));
      output = kernel.drive(session, { checkpoint: true });
    } else if (data.kind === 'reply') {
      const parked = decodeOutcome(output);
      output = kernel.drive(session, { control: 'reply', value: await encodeResult(parked.request, new Uint8Array(data.value)), checkpoint: true });
    } else if (data.kind === 'retire') {
      const state = kernel.checkpoint(session, { transfer: true });
      kernel.releasePrepared(prepared);
      self.postMessage({ state: Array.from(state), live: kernel.usage().workingLive.toString() }); return;
    } else throw new Error('UnknownExecutorCommand');
    const outcome = decodeOutcome(output);
    if (['completed', 'failed', 'cancelled'].includes(outcome.kind)) { kernel.close(session); kernel.releasePrepared(prepared); }
    self.postMessage({ output: Array.from(output), live: kernel.usage().workingLive.toString() });
  } catch (error) { self.postMessage({ error: error.code ?? error.message }); }
};
