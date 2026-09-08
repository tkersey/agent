import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { executeCli, parseArguments } from "../../runtime/runner.mjs";
import { loadWorldRuntime } from "../../runtime/world.mjs";

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
  for (const output of [f.runtime, join(f.runtime, "new.pko2"), join(alias, "missing", "new.pko2")]) {
    await assert.rejects(executeCli(f.argv(output), { stdout: sink }), /output path must not overwrite or enter --world-runtime/);
  }
  assert.deepEqual(await readdir(f.runtime), []);
});

test("runner rejects missing output parents without creating files", async (t) => {
  const f = await fixture(t);
  const before = (await readdir(f.root)).sort();
  await assert.rejects(executeCli(f.argv(join(f.root, "missing", "next.pko2")), { stdout: sink }), { code: "ENOENT" });
  assert.deepEqual((await readdir(f.root)).sort(), before);
});

test("runner rejects directories used as application inputs", async (t) => {
  const f = await fixture(t);
  const argv = f.argv(join(f.root, "next.pko2"));
  argv[argv.indexOf("--image") + 1] = f.runtime;
  await assert.rejects(executeCli(argv, { stdout: sink }), /--image must name a regular file/);
  assert.deepEqual(await readdir(f.runtime), []);
});

const runtimePath = process.env.AGENT4_WORLD_RUNTIME ?? fileURLToPath(new URL("../../.agent4/out/world-runtime", import.meta.url));
const dialogueDir = process.env.AGENT4_DIALOGUE_DIR ?? fileURLToPath(new URL("../../.agent4/out/dialogue", import.meta.url));
const lockPath = fileURLToPath(new URL("../../conformance/agent4/dependencies.lock.json", import.meta.url));

async function realFixture(t, name = "twice") {
  const root = await mkdtemp(join(tmpdir(), "agent4-runner-world-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const image = join(dialogueDir, `${name}.bpi2`);
  // These are integration tests: missing runtime or emitted probes is a failure,
  // not a cached receipt or a silently skipped execution.
  await readFile(image);
  const world = await loadWorldRuntime({ runtimePath, lockPath });
  const args = join(root, "initial.args");
  const reply = join(root, "reply.value");
  const saved = join(root, "saved.pko2");
  const next = join(root, "next.pko2");
  await writeFile(args, new Uint8Array());
  const answer = Buffer.alloc(8);
  answer.writeBigUInt64LE(3n);
  await writeFile(reply, answer);
  const printed = [];
  const stdout = { write(value) { printed.push(JSON.parse(value)); } };
  const argv = (command, rest) => [command, "--world-runtime", runtimePath, "--lock", lockPath, ...rest];
  const parked = await executeCli(argv("start", ["--image", image, "--initial-args", args, "--out", saved]), { stdout });
  return { root, image, reply, saved, next, world, stdout, printed, argv, parked };
}

test("runner starts, inspects, and resumes canonical outcomes through unchanged World", async (t) => {
  const f = await realFixture(t);
  assert.equal(f.parked.kind, "Requested");
  assert.deepEqual(await readFile(f.saved), Buffer.from(f.parked.bytes));
  assert.equal(f.printed[0].kind, "Requested");
  assert.equal(f.printed[0].authoritative, false);
  assert.equal(f.printed[0].request.semanticIdentity, "agent.probe.dialogue.delay.v1");
  assert.equal(f.printed[0].request.payload.encoding, "base64");
  const before = await readFile(f.saved);
  const entries = (await readdir(f.root)).sort();
  const inspected = await executeCli(f.argv("inspect", ["--outcome", f.saved]), { stdout: f.stdout });
  assert.equal(inspected.kind, "Requested");
  assert.deepEqual(await readFile(f.saved), before);
  assert.deepEqual((await readdir(f.root)).sort(), entries);
  await writeFile(f.next, "replace only after successful World execution");
  const completed = await executeCli(f.argv("resume", ["--image", f.image, "--outcome", f.saved, "--reply", f.reply, "--out", f.next]), { stdout: f.stdout });
  assert.equal(completed.kind, "Completed");
  assert.equal(Buffer.from(completed.value).readBigUInt64LE(), 40n);
  assert.deepEqual(await readFile(f.next), Buffer.from(completed.bytes));
  assert.equal(f.world.decodeOutcome(await readFile(f.next)).kind, "Completed");
  assert.deepEqual(await readFile(f.saved), before);
  assert.equal((await stat(f.next)).mode & 0o777, 0o600);
  assert.equal((await readdir(f.root)).some((name) => name.endsWith(".tmp")), false);
});

test("runner cancels saved State and rejects completed-state resumption", async (t) => {
  const f = await realFixture(t);
  const before = await readFile(f.saved);
  const cancelled = await executeCli(f.argv("cancel", ["--image", f.image, "--outcome", f.saved, "--reason", "explicit runner cancellation", "--out", f.next]), { stdout: f.stdout });
  assert.equal(cancelled.kind, "Cancelled");
  assert.equal(cancelled.reason, "explicit runner cancellation");
  assert.deepEqual(await readFile(f.saved), before);
  const rejectedOutput = join(f.root, "rejected.pko2");
  await writeFile(rejectedOutput, "retain prior checkpoint");
  await assert.rejects(executeCli(f.argv("resume", ["--image", f.image, "--outcome", f.next, "--reply", f.reply, "--out", rejectedOutput]), { stdout: sink }), /resume requires a Requested outcome/);
  await assert.rejects(executeCli(f.argv("cancel", ["--image", f.image, "--outcome", f.next, "--reason", "already cancelled", "--out", rejectedOutput]), { stdout: sink }), /cancel requires an outcome with saved State/);
  assert.equal(await readFile(rejectedOutput, "utf8"), "retain prior checkpoint");
});

test("runner preserves authoritative input and prior output on schema or image rejection", async (t) => {
  const f = await realFixture(t);
  const before = await readFile(f.saved);
  await writeFile(f.next, "retain prior checkpoint");
  await writeFile(f.reply, Buffer.from([3]));
  await assert.rejects(executeCli(f.argv("resume", ["--image", f.image, "--outcome", f.saved, "--reply", f.reply, "--out", f.next]), { stdout: sink }));
  const malformedImage = join(f.root, "malformed.bpi2");
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
  assert.equal(f.parked.kind, "Requested");
  const cleanup = f.world.inspectPending(f.parked);
  assert.equal(Buffer.from(cleanup.request.payload).readBigUInt64LE(), 42n);
  const cancelling = await executeCli(f.argv("cancel", ["--image", f.image, "--outcome", f.saved, "--reason", "stop during cleanup", "--out", f.next]), { stdout: f.stdout });
  assert.equal(cancelling.kind, "Requested");
  assert.notDeepEqual(cancelling.request, f.parked.request);
  assert.equal(Buffer.from(f.world.inspectPending(cancelling).request.payload).readBigUInt64LE(), 42n);
  await writeFile(f.reply, new Uint8Array());
  const final = join(f.root, "cancelled.pko2");
  const cancelled = await executeCli(f.argv("resume", ["--image", f.image, "--outcome", f.next, "--reply", f.reply, "--out", final]), { stdout: f.stdout });
  assert.equal(cancelled.kind, "Cancelled");
  assert.equal(cancelled.reason, "stop during cleanup");
  assert.deepEqual(await readFile(f.saved), Buffer.from(f.parked.bytes));
  assert.deepEqual(await readFile(f.next), Buffer.from(cancelling.bytes));
});
