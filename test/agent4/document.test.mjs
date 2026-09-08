import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDocumentEnvironment } from "../../runtime/document.mjs";

async function fixture(t, content = "Original document.\n") {
  const root = await mkdtemp(join(tmpdir(), "agent4-document-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "document.txt"), content);
  return { root, environment: await createDocumentEnvironment({ root }) };
}

function observation(content) {
  return { content, digest: createHash("sha256").update(content).digest("hex") };
}

test("read observes actual UTF-8 bytes, including BOM and non-ASCII text", async (t) => {
  const content = "\ufeffA real document: café, 文書, 📝.\n";
  const { root, environment } = await fixture(t, content);
  assert.deepEqual(await environment.read({ path: "document.txt" }), {
    kind: "success", observation: observation(content),
  });
  await writeFile(join(root, "document.txt"), "An external observation changed.\n");
  assert.deepEqual(await environment.read({ path: "document.txt" }), {
    kind: "success", observation: observation("An external observation changed.\n"),
  });
});

test("conditional replacement accepts distinct real non-golden results", async (t) => {
  const { root, environment } = await fixture(t);
  for (const replacement of ["First authored revision.\n", "A different valid revision: 🎯\n", ""]) {
    const read = await environment.read({ path: "document.txt" });
    const result = await environment.replace({ path: "document.txt", base: read.observation, replacement });
    assert.deepEqual(result, { kind: "success", observation: observation(replacement) });
    assert.equal(await readFile(join(root, "document.txt"), "utf8"), replacement);
    assert.deepEqual(await environment.read({ path: "document.txt" }), result);
  }
  assert.deepEqual(await readdir(root), ["document.txt"]);
});

test("separate environment instances serialize competing writes and return an actual conflict", async (t) => {
  const { root, environment } = await fixture(t);
  const second = await createDocumentEnvironment({ root });
  const base = (await environment.read({ path: "document.txt" })).observation;
  const results = await Promise.all([
    environment.replace({ path: "document.txt", base, replacement: "Writer one.\n" }),
    second.replace({ path: "document.txt", base, replacement: "Writer two.\n" }),
  ]);
  assert.deepEqual(results.map((result) => result.kind).sort(), ["conflict", "success"]);
  const success = results.find((result) => result.kind === "success");
  const conflict = results.find((result) => result.kind === "conflict");
  assert.deepEqual(conflict.observation, success.observation);
  assert.equal(await readFile(join(root, "document.txt"), "utf8"), success.observation.content);
});

test("an actual base change conflicts without overwriting it", async (t) => {
  const { root, environment } = await fixture(t);
  const base = (await environment.read({ path: "document.txt" })).observation;
  await writeFile(join(root, "document.txt"), "Another writer's content.\n");
  assert.deepEqual(await environment.replace({ path: "document.txt", base, replacement: "Stale proposal.\n" }), {
    kind: "conflict", observation: observation("Another writer's content.\n"),
  });
  assert.equal(await readFile(join(root, "document.txt"), "utf8"), "Another writer's content.\n");
});

test("forged base digests and ambiguous invocation fields reject before acquiring a lock", async (t) => {
  const { root, environment } = await fixture(t);
  const base = observation("Original document.\n");
  const invalidReplacements = [
    { path: "document.txt", base: { ...base, digest: "0".repeat(64) }, replacement: "x" },
    { path: "document.txt", base: { ...base, content: "forged" }, replacement: "x" },
    { path: "document.txt", base: { ...base, version: 1 }, replacement: "x" },
    { path: "document.txt", base, replacement: "x", force: true },
    { path: "document.txt", base },
    { path: "document.txt", base, replacement: "\ud800" },
    { path: "document.txt", base: observation("\ud800"), replacement: "x" },
  ];
  for (const input of invalidReplacements) await assert.rejects(environment.replace(input), TypeError);
  for (const input of [null, [], "document.txt", {}, { path: "document.txt", force: true }])
    await assert.rejects(environment.read(input), TypeError);
  let accessed = false;
  await assert.rejects(environment.read({ get path() { accessed = true; return "document.txt"; } }), TypeError);
  assert.equal(accessed, false);
  await assert.rejects(createDocumentEnvironment({ root, recursive: true }), TypeError);
  await assert.rejects(createDocumentEnvironment({ root: "relative" }), TypeError);
  assert.deepEqual(await readdir(root), ["document.txt"]);
  assert.equal(await readFile(join(root, "document.txt"), "utf8"), base.content);
});

test("paths reject traversal, aliases, absolute names, reserved files, and malformed text", async (t) => {
  const { root, environment } = await fixture(t);
  const base = observation("Original document.\n");
  const paths = ["", ".", "..", "../document.txt", "x/../document.txt", "./document.txt",
    "a//b", "a/", "/etc/passwd", "C:/document.txt", "\\server\\share", "a\\b",
    "a\0b", "\ud800", ".agent-document-lock", ".agent-document-lock/x", ".agent-document-tmp-forged"];
  for (const path of paths) {
    await assert.rejects(environment.read({ path }), TypeError);
    await assert.rejects(environment.replace({ path, base, replacement: "x" }), TypeError);
  }
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "nested", "safe.txt"), "Nested.\n");
  assert.deepEqual(await environment.read({ path: "nested/safe.txt" }), {
    kind: "success", observation: observation("Nested.\n"),
  });
});

test("root, intermediate, final symlinks and hardlinked files are unsupported", async (t) => {
  const { root, environment } = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), "agent4-document-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, "private.txt"), "Outside.\n");
  await symlink(outside, join(root, "escape"));
  await symlink(join(outside, "private.txt"), join(root, "direct.txt"));
  await link(join(outside, "private.txt"), join(root, "hard.txt"));
  for (const path of ["escape/private.txt", "direct.txt", "hard.txt"]) {
    assert.deepEqual(await environment.read({ path }), { kind: "failure", code: "unsafe_path" });
    assert.deepEqual(await environment.replace({ path, base: observation("Outside.\n"), replacement: "Forbidden.\n" }),
      { kind: "failure", code: "unsafe_path" });
  }
  await assert.rejects(createDocumentEnvironment({ root: join(root, "escape") }), TypeError);
  assert.equal(await readFile(join(outside, "private.txt"), "utf8"), "Outside.\n");
});

test("replacing the admitted root directory invalidates the environment", async (t) => {
  const parent = await mkdtemp(join(tmpdir(), "agent4-document-root-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, "root");
  await mkdir(root);
  await writeFile(join(root, "document.txt"), "Original.\n");
  const environment = await createDocumentEnvironment({ root });
  await rename(root, join(parent, "old"));
  await mkdir(root);
  await writeFile(join(root, "document.txt"), "Replacement root.\n");
  assert.deepEqual(await environment.read({ path: "document.txt" }), { kind: "failure", code: "unsafe_path" });
});

test("invalid file UTF-8 and missing files remain typed environmental failures", async (t) => {
  const { root, environment } = await fixture(t, Buffer.from([0xc3, 0x28]));
  assert.deepEqual(await environment.read({ path: "document.txt" }), { kind: "failure", code: "invalid_utf8" });
  assert.deepEqual(await environment.replace({ path: "document.txt", base: observation(""), replacement: "x" }),
    { kind: "failure", code: "invalid_utf8" });
  assert.deepEqual(await environment.read({ path: "missing.txt" }), { kind: "failure", code: "not_found" });
  assert.deepEqual(await environment.replace({ path: "missing.txt", base: observation(""), replacement: "x" }),
    { kind: "failure", code: "not_found" });
  assert.deepEqual(await readFile(join(root, "document.txt")), Buffer.from([0xc3, 0x28]));
});

test("a held or stale root lock returns busy and is never stolen", async (t) => {
  const { root, environment } = await fixture(t);
  const lock = join(root, ".agent-document-lock");
  await mkdir(lock);
  assert.deepEqual(await environment.read({ path: "document.txt" }), { kind: "failure", code: "busy" });
  assert.deepEqual(await environment.replace({ path: "document.txt", base: observation("Original document.\n"), replacement: "x" }),
    { kind: "failure", code: "busy" });
  assert((await lstat(lock)).isDirectory());
  assert.equal(await readFile(join(root, "document.txt"), "utf8"), "Original document.\n");
});

test("file synchronization failure reports failure and preserves the base", async (t) => {
  const { root, environment } = await fixture(t);
  const handle = await open(join(root, "document.txt"), "r");
  const prototype = Object.getPrototypeOf(handle);
  await handle.close();
  t.mock.method(prototype, "sync", async function () { throw Object.assign(new Error("fixture disk error"), { code: "EIO" }); });
  assert.deepEqual(await environment.replace({ path: "document.txt", base: observation("Original document.\n"), replacement: "x" }),
    { kind: "failure", code: "io_failure" });
  assert.equal(await readFile(join(root, "document.txt"), "utf8"), "Original document.\n");
  assert.deepEqual(await readdir(root), ["document.txt"]);
});

test("post-rename synchronization failure reports uncertain without retrying", async (t) => {
  const { root, environment } = await fixture(t);
  const handle = await open(join(root, "document.txt"), "r");
  const prototype = Object.getPrototypeOf(handle);
  const originalSync = prototype.sync;
  await handle.close();
  let directorySyncs = 0;
  t.mock.method(prototype, "sync", async function () {
    if ((await this.stat()).isDirectory()) {
      directorySyncs++;
      throw Object.assign(new Error("fixture directory sync error"), { code: "EIO" });
    }
    return originalSync.call(this);
  });
  const replacement = "Applied, but completion is uncertain.\n";
  assert.deepEqual(await environment.replace({ path: "document.txt", base: observation("Original document.\n"), replacement }),
    { kind: "uncertain", code: "io_failure" });
  assert.equal(directorySyncs, 1);
  assert.equal(await readFile(join(root, "document.txt"), "utf8"), replacement);
  assert.deepEqual(await readdir(root), ["document.txt"]);
});
