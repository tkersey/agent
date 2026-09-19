import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { executeCli, parseArguments } from "../../runtime/runner.mjs";
import { loadWorldRuntime } from "../../runtime/world.mjs";
import { encodeValue } from "../../runtime/values.mjs";

const start = ["start", "--world-runtime", "world", "--image", "image", "--initial-args", "args", "--out", "next"];
const sink = { write() { throw new Error("failed commands must not print a successful outcome"); } };

test("runner parses the four command-specific interfaces", () => {
  assert.deepEqual(parseArguments(start), { command: "start", worldRuntime: "world", image: "image", initialArgs: "args", out: "next" });
  assert.deepEqual(parseArguments(["inspect", "--world-runtime", "world", "--outcome", "saved", "--lock", "lock"]), {
    command: "inspect", worldRuntime: "world", outcome: "saved", lock: "lock",
  });
  assert.equal(parseArguments(["resume", "--world-runtime", "world", "--image", "image", "--outcome", "saved", "--reply", "reply", "--out", "next"]).reply, "reply");
  assert.equal(parseArguments(["cancel", "--world-runtime", "world", "--image", "image", "--outcome", "saved", "--reason", "user requested closure", "--out", "next"]).reason, "user requested closure");
});

test("runner rejects unknown, duplicate, missing, and cross-command arguments", () => {
  assert.throws(() => parseArguments([]), /expected one runner command/);
  assert.throws(() => parseArguments(["relay"]), /expected one runner command/);
  assert.throws(() => parseArguments([...start, "--output", "next"]), /unknown runner argument --output/);
  assert.throws(() => parseArguments([...start, "--out", "other"]), /duplicate runner argument --out/);
  assert.throws(() => parseArguments([...start, "--lock"]), /missing value for --lock/);
  assert.throws(() => parseArguments([...start, "--lock", "--out"]), /missing value for --lock/);
  assert.throws(() => parseArguments([...start, "--lock", ""]), /missing value for --lock/);
  assert.throws(() => parseArguments(start.slice(0, -2)), /missing required --out for start/);
  assert.throws(() => parseArguments([...start, "--reply", "reply"]), /--reply is not accepted by start/);
  assert.throws(() => parseArguments(["inspect", "--world-runtime", "world", "--outcome", "saved", "--out", "next"]), /--out is not accepted by inspect/);
  assert.throws(() => parseArguments([...start, "--lock", "bad\0path"]), /NUL is not allowed/);
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "agent4-runner-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = join(root, "runtime");
  await mkdir(runtime);
  const files = Object.fromEntries(["lock", "image", "args", "outcome", "reply"].map((name) => [name, join(root, name)]));
  await Promise.all(Object.entries(files).map(([name, path]) => writeFile(path, `unchanged ${name}`)));
  const argv = (output) => ["start", "--world-runtime", runtime, "--lock", files.lock, "--image", files.image, "--initial-args", files.args, "--out", output];
  return { root, runtime, files, argv };
}

test("runner rejects overwrite of every command input before runtime admission", async (t) => {
  const f = await fixture(t);
  for (const name of ["lock", "image", "args"]) {
    await assert.rejects(executeCli(f.argv(f.files[name]), { stdout: sink }), /output path must not overwrite/);
    assert.equal(await readFile(f.files[name], "utf8"), `unchanged ${name}`);
  }
  for (const name of ["outcome", "reply"]) {
    const argv = ["resume", "--world-runtime", f.runtime, "--lock", f.files.lock, "--image", f.files.image,
      "--outcome", f.files.outcome, "--reply", f.files.reply, "--out", f.files[name]];
    await assert.rejects(executeCli(argv, { stdout: sink }), /output path must not overwrite/);
    assert.equal(await readFile(f.files[name], "utf8"), `unchanged ${name}`);
  }
});

test("runner recognizes symbolic and hard link output aliases", async (t) => {
  const f = await fixture(t);
  const symbolic = join(f.root, "symbolic-output");
  const hard = join(f.root, "hard-output");
  await symlink(f.files.image, symbolic);
  await link(f.files.args, hard);
  for (const output of [symbolic, hard]) {
    await assert.rejects(executeCli(f.argv(output), { stdout: sink }), /output path must not overwrite/);
  }
  assert.equal(await readFile(f.files.image, "utf8"), "unchanged image");
  assert.equal(await readFile(f.files.args, "utf8"), "unchanged args");
});

test("runner protects runtime contents through missing paths and symlink parents", async (t) => {
  const f = await fixture(t);
  const alias = join(f.root, "runtime-alias");
  await symlink(f.runtime, alias);
  for (const output of [f.runtime, join(f.runtime, "new.pko3"), join(alias, "missing", "new.pko3")]) {
    await assert.rejects(executeCli(f.argv(output), { stdout: sink }), /output path must not overwrite or enter --world-runtime/);
  }
  assert.deepEqual(await readdir(f.runtime), []);
});

test("runner rejects missing output parents without creating files", async (t) => {
  const f = await fixture(t);
  const before = (await readdir(f.root)).sort();
  await assert.rejects(executeCli(f.argv(join(f.root, "missing", "next.pko3")), { stdout: sink }), { code: "ENOENT" });
  assert.deepEqual((await readdir(f.root)).sort(), before);
});

test("runner rejects directories used as application inputs", async (t) => {
  const f = await fixture(t);
  const argv = f.argv(join(f.root, "next.pko3"));
  argv[argv.indexOf("--image") + 1] = f.runtime;
  await assert.rejects(executeCli(argv, { stdout: sink }), /--image must name a regular file/);
  assert.deepEqual(await readdir(f.runtime), []);
});

const runtimePath = process.env.AGENT4_WORLD_RUNTIME ?? fileURLToPath(new URL("../../.agent4/out/world-runtime", import.meta.url));
const dialogueDir = process.env.AGENT4_DIALOGUE_DIR ?? fileURLToPath(new URL("../../.agent4/out/dialogue", import.meta.url));
const lockPath = fileURLToPath(new URL("../../conformance/agent4/dependencies.lock.json", import.meta.url));

async function realFixture(t, name = "twice", initialArgs = new Uint8Array()) {
  const root = await mkdtemp(join(tmpdir(), "agent4-runner-world-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const image = join(dialogueDir, `${name}.bpi3`);
  // These are integration tests: missing runtime or emitted probes is a failure,
  // not a cached receipt or a silently skipped execution.
  await readFile(image);
  const world = await loadWorldRuntime({ runtimePath, lockPath });
  const args = join(root, "initial.args");
  const reply = join(root, "reply.value");
  const saved = join(root, "saved.pko3");
  const next = join(root, "next.pko3");
  await writeFile(args, initialArgs);
  const answer = Buffer.alloc(8);
  answer.writeBigUInt64LE(3n);
  await writeFile(reply, answer);
  const printed = [];
  const stdout = { write(value) { printed.push(JSON.parse(value)); } };
  const argv = (command, rest) => [command, "--world-runtime", runtimePath, "--lock", lockPath, ...rest];
  const parked = await executeCli(argv("start", ["--image", image, "--initial-args", args, "--out", saved]), { stdout });
  return { root, image, reply, saved, next, world, stdout, printed, argv, parked };
}

test("runner continues an explicit yield but cannot continue through a pending external request", async (t) => {
  const f = await realFixture(t, "yield_once");
  assert.equal(f.parked.kind, "yielded");
  const before = await readFile(f.saved);
  const finished = await executeCli(f.argv("continue", ["--image", f.image, "--outcome", f.saved, "--out", f.next]), { stdout: f.stdout });
  assert.equal(finished.kind, "completed");
  assert.equal(Buffer.from(finished.value).readBigUInt64LE(), 42n);
  assert.deepEqual(await readFile(f.saved), before);
  const pending = await realFixture(t);
  await assert.rejects(executeCli(pending.argv("continue", ["--image", pending.image, "--outcome", pending.saved, "--out", pending.next]), { stdout: sink }), /continue requires a progressed or yielded checkpoint/);
  await assert.rejects(stat(pending.next), { code: "ENOENT" });
});

test("runner starts, inspects, and resumes canonical outcomes through unchanged World", async (t) => {
  const f = await realFixture(t);
  assert.equal(f.parked.kind, "requested");
  assert.deepEqual(await readFile(f.saved), Buffer.from(f.parked.bytes));
  assert.equal(f.printed[0].kind, "requested");
  assert.equal(f.printed[0].authoritative, false);
  assert.equal(f.printed[0].request.semanticIdentity, "agent.probe.dialogue.delay.v1");
  assert.equal(f.printed[0].request.payload.encoding, "base64");
  const before = await readFile(f.saved);
  const entries = (await readdir(f.root)).sort();
  const inspected = await executeCli(f.argv("inspect", ["--outcome", f.saved]), { stdout: f.stdout });
  assert.equal(inspected.kind, "requested");
  assert.deepEqual(await readFile(f.saved), before);
  assert.deepEqual((await readdir(f.root)).sort(), entries);
  await writeFile(f.next, "replace only after successful World execution");
  const completed = await executeCli(f.argv("resume", ["--image", f.image, "--outcome", f.saved, "--reply", f.reply, "--out", f.next]), { stdout: f.stdout });
  assert.equal(completed.kind, "completed");
  assert.equal(Buffer.from(completed.value).readBigUInt64LE(), 40n);
  assert.deepEqual(await readFile(f.next), Buffer.from(completed.bytes));
  assert.equal(f.world.decodeOutcome(await readFile(f.next)).kind, "completed");
  assert.deepEqual(await readFile(f.saved), before);
  assert.equal((await stat(f.next)).mode & 0o777, 0o600);
  assert.equal((await readdir(f.root)).some((name) => name.endsWith(".tmp")), false);
});

test("direct and symlinked CLI entry points execute instead of silently succeeding", async (t) => {
  const f = await realFixture(t);
  const runner = fileURLToPath(new URL("../../runtime/runner.mjs", import.meta.url));
  const alias = join(f.root, "agent-runner.mjs");
  await symlink(runner, alias);
  for (const [i, entry] of [runner, alias].entries()) {
    const output = join(f.root, `cli-${i}.pko3`);
    const printed = execFileSync(process.execPath, [entry, ...f.argv("start", [
      "--image", f.image, "--initial-args", join(f.root, "initial.args"), "--out", output,
    ])], { encoding: "utf8" });
    assert.equal(JSON.parse(printed).kind, "requested");
    assert.deepEqual(await readFile(output), Buffer.from(f.parked.bytes));
  }
  for (const [i, relative] of ["../../runtime/runner.mjs", "../../tools/agent4/package.mjs",
    "../../tools/agent4/economy.mjs", "../../tools/agent4/setup.mjs",
    "../../tools/agent4/dependencies.mjs", "./installations.mjs"].entries()) {
    const target = fileURLToPath(new URL(relative, import.meta.url));
    const link = join(f.root, `cli-alias-${i}.mjs`);
    await symlink(target, link);
    for (const entry of [target, link]) {
      assert.throws(() => execFileSync(process.execPath, [entry, "--unknown"], { stdio: "pipe" }),
        error => error.status === 1 && error.stderr.length > 0);
    }
  }
});

test("CLI fallback identifies real main paths when Node does not expose meta.main", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "agent4-main-fallback-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const helper = new URL("../../runtime/cli.mjs", import.meta.url).href;
  const entry = join(root, "entry.mjs"), alias = join(root, "alias.mjs");
  await writeFile(entry, `import { isMain } from ${JSON.stringify(helper)};
    console.log(JSON.stringify([
      isMain(import.meta), isMain({url: import.meta.url}),
      isMain({url: ${JSON.stringify(helper)}}),
      isMain({url: ${JSON.stringify(pathToFileURL(join(root, "absent.mjs")).href)}}),
      isMain({url: import.meta.url, main: false})
    ]));`);
  await symlink(entry, alias);
  for (const path of [entry, alias]) {
    assert.deepEqual(JSON.parse(execFileSync(process.execPath, [path], { encoding: "utf8" })),
      [true, true, false, false, false]);
  }
});

test("runner cancels saved State and rejects completed-state resumption", async (t) => {
  const f = await realFixture(t);
  const before = await readFile(f.saved);
  const cancelled = await executeCli(f.argv("cancel", ["--image", f.image, "--outcome", f.saved, "--reason", "explicit runner cancellation", "--out", f.next]), { stdout: f.stdout });
  assert.equal(cancelled.kind, "cancelled");
  assert.deepEqual(cancelled.reason, { kind: "text", value: "explicit runner cancellation" });
  assert.deepEqual(await readFile(f.saved), before);
  const rejectedOutput = join(f.root, "rejected.pko3");
  await writeFile(rejectedOutput, "retain prior checkpoint");
  await assert.rejects(executeCli(f.argv("resume", ["--image", f.image, "--outcome", f.next, "--reply", f.reply, "--out", rejectedOutput]), { stdout: sink }), /resume requires a requested outcome/);
  await assert.rejects(executeCli(f.argv("cancel", ["--image", f.image, "--outcome", f.next, "--reason", "already cancelled", "--out", rejectedOutput]), { stdout: sink }), /cancel requires an outcome with saved State/);
  assert.equal(await readFile(rejectedOutput, "utf8"), "retain prior checkpoint");
});

test("runner renders deep portable interactions on start, inspect, and resume", async (t) => {
  const depth = 5000;
  const schema = { root: 0, types: [{ sum: [1, 2] }, "unit", { product: [3, 0] }, "u8"] };
  let list = { tag: 0, value: null };
  for (let i = 0; i < depth; i++) list = { tag: 1, value: [i % 256, list] };
  const f = await realFixture(t, "deep_exchange", encodeValue(schema, list));
  assert.equal(f.parked.kind, "requested");
  await executeCli(f.argv("inspect", ["--outcome", f.saved]), { stdout: f.stdout });
  await writeFile(f.reply, Uint8Array.of(0));
  const next = await executeCli(f.argv("resume", ["--image", f.image, "--outcome", f.saved,
    "--reply", f.reply, "--out", f.next]), { stdout: f.stdout });
  assert.equal(next.kind, "requested");
  assert.deepEqual(await readFile(f.saved), Buffer.from(f.parked.bytes));
  assert.deepEqual(await readFile(f.next), Buffer.from(next.bytes));
  assert.equal(f.printed.length, 3);
  for (const view of f.printed) {
    let outgoing = view.interaction.outgoing;
    for (let i = depth - 1; i >= 0; i--) {
      assert.equal(outgoing.tag, 1);
      assert.equal(outgoing.value[0], i % 256);
      outgoing = outgoing.value[1];
    }
    assert.deepEqual(outgoing, { tag: 0, value: null });
  }
});

test("optional display capacity preserves canonical start, inspect, and resume", async (t) => {
  // A million unit values occupy three canonical bytes. They are valid World
  // data even though the surrounding product exceeds host materialization limits.
  const count = 1_000_000, bytes = [];
  for (let remaining = count; remaining; remaining = Math.floor(remaining / 128))
    bytes.push((remaining % 128) | (remaining >= 128 ? 128 : 0));
  const f = await realFixture(t, "wide_exchange", Uint8Array.from(bytes));
  const before = await readFile(f.saved);
  await executeCli(f.argv("inspect", ["--outcome", f.saved]), { stdout: f.stdout });
  await writeFile(f.reply, Uint8Array.of(0));
  const next = await executeCli(f.argv("resume", ["--image", f.image, "--outcome", f.saved,
    "--reply", f.reply, "--out", f.next]), { stdout: f.stdout });
  assert.equal(next.kind, "requested");
  for (const view of f.printed) {
    assert.equal(view.classification, "typed_request");
    assert.equal(view.interaction, undefined);
    assert.equal(view.request.semanticIdentity, "agent.interaction.exchange.v1.probe.wide");
    assert.equal(view.request.payload.encoding, "base64");
  }
  assert.deepEqual(await readFile(f.saved), before);
  assert.deepEqual(await readFile(f.next), Buffer.from(next.bytes));
});

test("runner preserves authoritative input and prior output on schema or image rejection", async (t) => {
  const f = await realFixture(t);
  const before = await readFile(f.saved);
  await writeFile(f.next, "retain prior checkpoint");
  await writeFile(f.reply, Buffer.from([3]));
  await assert.rejects(executeCli(f.argv("resume", ["--image", f.image, "--outcome", f.saved, "--reply", f.reply, "--out", f.next]), { stdout: sink }));
  const malformedImage = join(f.root, "malformed.bpi3");
  const malformed = Buffer.from(await readFile(f.image));
  malformed[0] ^= 0xff;
  await writeFile(malformedImage, malformed);
  await assert.rejects(executeCli(f.argv("cancel", ["--image", malformedImage, "--outcome", f.saved, "--reason", "test", "--out", f.next]), { stdout: sink }));
  assert.deepEqual(await readFile(f.saved), before);
  assert.equal(await readFile(f.next, "utf8"), "retain prior checkpoint");
  assert.equal((await readdir(f.root)).some((name) => name.endsWith(".tmp")), false);
});

test("runner preserves suspended cleanup and uses its rebound request after cancellation", async (t) => {
  const f = await realFixture(t, "dispose_owned");
  assert.equal(f.parked.kind, "requested");
  const cleanup = await f.world.inspectPending(f.parked);
  assert.equal(Buffer.from(cleanup.request.payload).readBigUInt64LE(), 42n);
  const cancelling = await executeCli(f.argv("cancel", ["--image", f.image, "--outcome", f.saved, "--reason", "stop during cleanup", "--out", f.next]), { stdout: f.stdout });
  assert.equal(cancelling.kind, "requested");
  assert.notDeepEqual(cancelling.request, f.parked.request);
  assert.equal(Buffer.from((await f.world.inspectPending(cancelling)).request.payload).readBigUInt64LE(), 42n);
  await writeFile(f.reply, new Uint8Array());
  const final = join(f.root, "cancelled.pko3");
  const cancelled = await executeCli(f.argv("resume", ["--image", f.image, "--outcome", f.next, "--reply", f.reply, "--out", final]), { stdout: f.stdout });
  assert.equal(cancelled.kind, "cancelled");
  assert.deepEqual(cancelled.reason, { kind: "text", value: "stop during cleanup" });
  assert.deepEqual(await readFile(f.saved), Buffer.from(f.parked.bytes));
  assert.deepEqual(await readFile(f.next), Buffer.from(cancelling.bytes));
});
