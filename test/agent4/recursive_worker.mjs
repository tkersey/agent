// Generic fresh-Worker embedding. It has no participant or tool-specific code.
import { Kernel, decodeOutcome } from '/world/index.mjs';
self.onmessage = async ({ data }) => {
  try {
    const bytes = new Uint8Array(await (await fetch('/kernel.wasm')).arrayBuffer());
    const kernel = await Kernel.create({ bytes, expectedSha256: data.sha256 });
    kernel.setLimits({ input: 4 << 20, working: 16 << 20, output: 4 << 20 });
    const prepared = kernel.prepare(new Uint8Array(data.image));
    const session = kernel.restore(prepared, new Uint8Array(data.state));
    kernel.releasePrepared(prepared);
    const output = kernel.drive(session, { control: data.control,
      value: new Uint8Array(data.value), quantum: data.quantum, checkpoint: true });
    const outcome = decodeOutcome(output);
    if (['completed', 'failed', 'cancelled'].includes(outcome.kind)) kernel.close(session);
    else kernel.checkpoint(session, { transfer: true });
    self.postMessage({ output: Array.from(output), workingLive: String(kernel.usage().workingLive) });
  } catch (error) {
    self.postMessage({ error: error.code ?? error.message, diagnostic: error.details?.diagnostic });
  }
};
