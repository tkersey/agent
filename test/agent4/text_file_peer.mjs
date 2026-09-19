// One server process owns one resident successor, exports it, then exits.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { verifyRuntime } from "../../tools/agent4/dependencies.mjs";
import { decodeValue } from "../../runtime/values.mjs";
import { subjectSchema, READ } from "../../runtime/text_inspection.mjs";
import { fileBinding } from "../../runtime/text_file.mjs";

const [runtime, inputPath, outputPath] = process.argv.slice(2);
const input = JSON.parse(await readFile(inputPath, "utf8"));
const identity = verifyRuntime(runtime);
const world = await import(pathToFileURL(identity.entrypoint));
const kernel = await world.Kernel.create({ bytes: await readFile(identity.kernelPath), expectedSha256: identity.kernelSha256 });
kernel.setLimits({ input: 256 << 20, working: 256 << 20, output: 256 << 20 });
const prepared = kernel.prepare(new Uint8Array(input.image));
const session = kernel.restore(prepared, new Uint8Array(input.state));
kernel.releasePrepared(prepared);
const pending = world.decodeOutcome(kernel.drive(session, { checkpoint: true }));
assert.equal(pending.kind, "requested");
const request = await world.decodeRequest(pending.request);
assert.equal(request.semanticIdentity, READ);
const binding = await fileBinding(decodeValue(subjectSchema, new Uint8Array(input.subject)), { root: input.root, path: "story.txt" });
const value = await binding.handle(request);
const output = kernel.drive(session, { control: "reply", value: await world.encodeResult(pending.request, value), checkpoint: true });
const next = world.decodeOutcome(output);
assert.equal(next.kind, "requested");
assert.equal((await world.decodeRequest(next.request)).semanticIdentity, READ);
const state = kernel.checkpoint(session, { transfer: true });
assert.equal(kernel.usage().workingLive, 0n);
await writeFile(outputPath, JSON.stringify({ state: Array.from(state), output: Array.from(output),
  reads: binding.counts().reads.map(String), releases: binding.counts().releases }), { flag: "wx" });
