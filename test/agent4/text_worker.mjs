import { Kernel, decodeOutcome, decodeRequest, encodeResult } from "/world/index.mjs";
import { memoryBinding, READ, CLOSE } from "/agent/text_inspection.mjs";
import { decodeSchema, decodeValue, encodeValue } from "/agent/values.mjs";

self.onmessage = async ({ data }) => {
  try {
    const bytes = new Uint8Array(await (await fetch("/kernel.wasm")).arrayBuffer());
    const kernel = await Kernel.create({ bytes, expectedSha256: data.sha256 });
    kernel.setLimits({ input: 256 << 20, working: 256 << 20, output: 256 << 20 });
    const prepared = kernel.prepare(new Uint8Array(data.image));
    const session = data.state ? kernel.restore(prepared, new Uint8Array(data.state)) : kernel.start(prepared, new Uint8Array(data.args));
    kernel.releasePrepared(prepared);
    const binding = memoryBinding(data.subject, new Uint8Array(data.content));
    let sideResumed = 0, humanAnswers = 0;
    let output = kernel.drive(session, { checkpoint: true });
    for (let round = 0; round < 32; round++) {
      const outcome = decodeOutcome(output);
      if (outcome.kind !== "requested") {
        if (outcome.kind !== "completed" && outcome.kind !== "cancelled") throw new Error(`Unexpected boundary ${outcome.kind}`);
        kernel.close(session);
        self.postMessage({ output: Array.from(output), counts: { ...binding.counts(), sideResumed, humanAnswers }, workingLive: String(kernel.usage().workingLive) });
        return;
      }
      const request = await decodeRequest(outcome.request);
      if (request.semanticIdentity === "agent.model.invoke.v3") {
        output = kernel.drive(session, { control: "reply", value: await encodeResult(outcome.request, new Uint8Array(data.modelReply)), checkpoint: true });
        continue;
      }
      if (request.semanticIdentity === "agent.interaction.exchange.v1.text-continue") {
        const value = decodeValue(decodeSchema(request.payloadSchema), request.payload)[3];
        humanAnswers++;
        output = kernel.drive(session, { control: "reply", value: await encodeResult(outcome.request,
          encodeValue(decodeSchema(request.resumeSchema), { tag: 0, value })), checkpoint: true });
        continue;
      }
      if (data.transfer) {
        if (request.semanticIdentity !== READ) throw new Error("Expected chunk-read suspension");
        const state = kernel.checkpoint(session, { transfer: true });
        self.postMessage({ output: Array.from(output), state: Array.from(state), humanAnswers, workingLive: String(kernel.usage().workingLive) });
        return;
      }
      let value;
      if (request.semanticIdentity === "agent.text.side-resumed.v1") {
        if (decodeValue(decodeSchema(request.payloadSchema), request.payload) !== 77n) throw new Error("Wrong retained side-task result");
        sideResumed++; value = new Uint8Array();
      } else {
        if (request.semanticIdentity !== READ && request.semanticIdentity !== CLOSE) throw new Error(`Missing operation ${request.semanticIdentity}`);
        value = await binding.handle(request);
      }
      output = kernel.drive(session, { control: "reply", value: await encodeResult(outcome.request, value), checkpoint: true });
    }
    throw new Error("Text tool did not finish");
  } catch (error) { self.postMessage({ error: error.code ?? error.message }); }
};
