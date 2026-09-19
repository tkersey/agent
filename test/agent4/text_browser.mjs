import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { verifyRuntime } from "../../tools/agent4/dependencies.mjs";
import { encodeValue, decodeValue, decodeSchema } from "../../runtime/values.mjs";
import { subject, subjectSchema } from "../../runtime/text_inspection.mjs";

const [emitter, linker, runtimePath, browserTools] = process.argv.slice(2).map(path => resolve(path));
const { chromium, firefox } = await import(pathToFileURL(join(browserTools, "node_modules/playwright-core/index.mjs")));
const identity = verifyRuntime(runtimePath), world = await import(pathToFileURL(identity.entrypoint));
const kernel = await readFile(identity.kernelPath);
const area = await mkdtemp(join(tmpdir(), "agent-text-browser-"));
await writeFile(join(area, "tool.bmo1"), execFileSync(emitter));
const image = new Uint8Array(execFileSync(linker, ["agent", join(area, "tool.bmo1")]));
const tasks = decodeSchema(execFileSync(linker, ["task-schema"])), reports = decodeSchema(execFileSync(linker, ["report-schema"]));
const reply = Array.from(execFileSync(linker, ["model-reply"]));
const content = new TextEncoder().encode("alpha\nbeta gamma\ndelta epsilon zeta\nomega\n");
const declared = await subject("fixture/story", content);
await writeFile(join(area, "story.txt"), content);
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, "http://localhost").pathname;
    if (path === "/") { response.end("<!doctype html><title>Compiled Agent text tool transfer</title>"); return; }
    if (path === "/kernel.wasm") { response.setHeader("Content-Type", "application/wasm"); response.end(kernel); return; }
    const file = path === "/worker.mjs" ? join(import.meta.dirname, "text_worker.mjs") :
      /^\/world\/[a-z-]+\.mjs$/.test(path) ? join(runtimePath, "src/embedding", path.split("/").at(-1)) :
      ["/agent/text_inspection.mjs", "/agent/values.mjs"].includes(path) ? resolve(import.meta.dirname, "../../runtime", path.split("/").at(-1)) : null;
    if (!file) { response.writeHead(404); response.end(); return; }
    response.setHeader("Content-Type", "text/javascript"); response.end(await readFile(file));
  } catch { response.writeHead(500); response.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const results = [];
try {
  for (const [engine, type] of [["chromium", chromium], ["firefox", firefox]]) {
    const browser = await type.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      const start = data => page.evaluate(data => new Promise((resolve, reject) => {
        const worker = new Worker("/worker.mjs", { type: "module" });
        worker.onmessage = event => { worker.terminate(); resolve(event.data); };
        worker.onerror = event => { worker.terminate(); reject(new Error(event.message)); };
        worker.postMessage(data);
      }), data);
      const task = engine === "chromium" ? 123n : 456n;
      const base = { image: Array.from(image), sha256: identity.kernelSha256, subject: declared, content: Array.from(content), modelReply: reply };
      const first = await start({ ...base, args: Array.from(encodeValue(tasks, [declared, task])), transfer: true });
      assert.equal(first.error, undefined); assert.equal(first.workingLive, "0");
      assert.equal(first.humanAnswers, 1);
      const input = join(area, `${engine}-input.json`), output = join(area, `${engine}-output.json`);
      await writeFile(input, JSON.stringify({ image: Array.from(image), state: first.state, subject: Array.from(encodeValue(subjectSchema, declared)), root: area }));
      // Process exit destroys the actual server-side resident instance.
      execFileSync(process.execPath, [join(import.meta.dirname, "text_file_peer.mjs"), runtimePath, input, output]);
      const next = JSON.parse(await readFile(output, "utf8"));
      assert.deepEqual(next.reads, ["0"]); assert.equal(next.releases, 0);
      const last = await start({ ...base, state: next.state });
      assert.equal(last.error, undefined); assert.equal(last.workingLive, "0");
      const outcome = world.decodeOutcome(new Uint8Array(last.output));
      assert.equal(outcome.kind, "completed");
      assert.deepEqual(decodeValue(reports, outcome.value), [task, { tag: 0, value: [BigInt(content.length), 4n] }]);
      assert.deepEqual(last.counts, { reads: [16n, 32n], releases: 1, sideResumed: 1, humanAnswers: 1 });
      results.push({ engine, version: browser.version(), workersDestroyed: 2, fileReads: next.reads, cleanup: last.counts.releases });
    } finally { await browser.close(); }
  }
  console.log(JSON.stringify({ check: "compiled Agent tool browser/file/browser transfer", kernelSha256: identity.kernelSha256, imageBytes: image.length, results }));
} finally { await new Promise(resolve => server.close(resolve)); await rm(area, { recursive: true, force: true }); }
