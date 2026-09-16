import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { loadWorldRuntime } from "../../runtime/world.mjs";

test("documented commands execute from the actual source-independent archive", async (t) => {
  const area = await mkdtemp(join(tmpdir(), "agent4-documented-commands-"));
  t.after(() => rm(area, { recursive: true, force: true }));
  const archive = resolve(process.env.AGENT4_ARCHIVE ?? "zig-out/agent4-release/agent-v4.0.0-dev.0-resumable-interactions-v1.tar.gz");
  const runtimePath = resolve(process.env.AGENT4_WORLD_RUNTIME ?? ".agent4/out/world-runtime");
  execFileSync("tar", ["-xzf", archive, "-C", area]);
  const [folder] = await readdir(area);
  const cwd = join(area, folder);
  const docs = await readFile(join(cwd, "docs/agent4-runtime.md"), "utf8");
  const block = docs.match(/```sh\n([\s\S]*?)```/)[1];
  const commands = block.replaceAll(/\\\n/g, "").trim().split(/\n\s*\n/);
  assert.equal(commands.length, 4);
  for (const command of commands) {
    const words = command.match(/"[^"]*"|[^\s]+/g).map(word => word.replace(/^"|"$/g, ""));
    assert.equal(words.shift(), "node");
    const args = words.map(word => word === "/absolute/path/to/world-runtime" ? runtimePath : word);
    execFileSync(process.execPath, args, { cwd, stdio: "pipe" });
  }
  // The dialogue has no environmental side effects; resume and cancellation
  // exercise the two documented alternative branches using the same saved bytes.
  const world = await loadWorldRuntime({ runtimePath });
  assert.equal(world.decodeOutcome(await readFile(join(cwd, "started.pko2"))).kind, "Requested");
  const resumed = world.decodeOutcome(await readFile(join(cwd, "resumed.pko2")));
  assert.equal(resumed.kind, "Completed");
  assert.equal(Buffer.from(resumed.value).readBigUInt64LE(), 40n);
  assert.equal(world.decodeOutcome(await readFile(join(cwd, "cancelled.pko2"))).kind, "Cancelled");
  const inventory = JSON.parse(await readFile(join(cwd, "examples/inventory.json"), "utf8"));
  const consequence = inventory.examples.find(example => example.name === "document-consequence");
  assert(consequence, "the opt-in application belongs to the source-independent package");
  const script = resolve(import.meta.dirname, "consequence_runtime.mjs");
  const result = execFileSync(process.execPath, [script, runtimePath,
    join(cwd, "examples", consequence.image), "--application-only"], {
    cwd, encoding: "utf8", timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(JSON.parse(result).cases, 36,
    "the actual packaged image completes the prescribed file, transfer, and cancellation cases");
  const inquiry = inventory.examples.find(example => example.name === "inquiry-repair");
  assert(inquiry, "inquiry belongs to the source-independent archive");
  const inquiryRun = execFileSync(process.execPath,
    [join(cwd, "test/agent4/inquiry_application_runtime.mjs"), runtimePath, join(cwd, "examples/inquiry")],
    { cwd, encoding: "utf8", timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  const measured = JSON.parse(inquiryRun);
  assert.equal(measured.models, 10);
  assert.equal(measured.experiments, 4);
  assert.equal(measured.writes, 1);
  assert.deepEqual(measured.cleanup, [2, 3, 1]);
  assert.equal(measured.executor.physicalExecutions, 34);
  // The oracle and all of its runtime imports come from the extracted archive;
  // no authoring sources, compiler, or per-application kernel are installed.
  const files = inventory.files.map(file => file.path);
  assert(files.includes("inquiry/task-schema.bin"));
  assert(files.includes("inquiry/outcome-schema.bin"));
});
