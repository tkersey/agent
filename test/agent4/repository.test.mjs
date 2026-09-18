import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createRepositoryEnvironment } from "../../runtime/repository.mjs";

const paths = ["README.md", "package.json", "src/range.mjs", "test/range.test.mjs"];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
async function fixture(t) {
  const area = await mkdtemp(join(tmpdir(), "agent-repository-leaves-"));
  t.after(() => rm(area, { recursive: true, force: true }));
  const root = join(area, "repository");
  await cp(resolve("fixtures/repository-repair-v1"), root, { recursive: true });
  return { root, environment: await createRepositoryEnvironment({ root, paths }) };
}

test("listing and role-bound reads reflect actual admitted files", async t => {
  const { root, environment } = await fixture(t);
  assert.deepEqual(await environment.list(null), [paths.map(path => [path, 0]), false]);
  for (const [role, path] of [[0, "package.json"], [1, "src/range.mjs"], [2, "test/range.test.mjs"]]) {
    const bytes = await readFile(join(root, path));
    assert.deepEqual(await environment.read([role, path]), [role, role, path, hash(bytes), bytes.toString("utf8")]);
  }
  await writeFile(join(root, "src/range.mjs"), "\ufeffcafé\n");
  assert.deepEqual(await environment.read([1, "src/range.mjs"]),
    [1, 1, "src/range.mjs", hash("\ufeffcafé\n"), "\ufeffcafé\n"]);
});

test("literal search preserves prefix, line numbers and empty-query behavior", async t => {
  const { root, environment } = await fixture(t);
  await writeFile(join(root, "src/range.mjs"), "first\n\ufeffneedle 文書\nlast needle\n");
  assert.deepEqual(await environment.search(["needle", "src/"]), [[
    ["src/range.mjs", 2, "\ufeffneedle 文書"], ["src/range.mjs", 3, "last needle"],
  ], false]);
  assert.deepEqual(await environment.search(["needle", "not-admitted/"]), [[], false]);
  assert.deepEqual(await environment.search(["", ""]), [[], false]);
});

test("search exposes hit and UTF-8 excerpt truncation instead of overrunning contracts", async t => {
  const { root, environment } = await fixture(t);
  await writeFile(join(root, "src/range.mjs"), "needle".repeat(50) + "\n" + "needle\n".repeat(8));
  const [hits, truncated] = await environment.search(["needle", "src/"]);
  assert.equal(hits.length, 8); assert.equal(truncated, true);
  assert.equal(Buffer.byteLength(hits[0][2]), 256);
  await writeFile(join(root, "src/range.mjs"), "文".repeat(100));
  const [unicode, cut] = await environment.search(["文", "src/"]);
  assert.equal(cut, true); assert.equal(unicode[0][2], "文".repeat(85));
  assert.equal(unicode[0][2].isWellFormed(), true);
});

test("listing has bounded output and snapshots the supplied file capability", async t => {
  const { root } = await fixture(t);
  await mkdir(join(root, "many"));
  const selected = Array.from({ length: 33 }, (_, i) => `many/${String(i).padStart(2, "0")}.txt`);
  for (const path of selected) await writeFile(join(root, path), "x");
  const environment = await createRepositoryEnvironment({ root, paths: selected });
  selected.length = 0;
  const [entries, truncated] = await environment.list(null);
  assert.equal(entries.length, 32); assert.equal(truncated, true);
  assert.deepEqual(entries[31], ["many/31.txt", 0]);
});

test("unavailable or out-of-scope files do not become successful observations", async t => {
  const { root, environment } = await fixture(t);
  await assert.rejects(environment.read([1, "../outside"]), /capability/);
  await assert.rejects(environment.read([3, "src/range.mjs"]), /role/);
  await assert.rejects(environment.test([1]), /unsupported/);
  await rm(join(root, "src/range.mjs"));
  await assert.rejects(environment.read([1, "src/range.mjs"]), /not_found/);
  await symlink("../../outside", join(root, "src/range.mjs"));
  await assert.rejects(environment.search(["x", "src/"]), /unsafe_path/);
  await assert.rejects(environment.test([0]), /unsafe_path/);
  assert.throws(() => environment.replace([["foreign.mjs", "0".repeat(64), "x", ""], 7n]), /capability/);
});

test("qualified fixture tests preserve actual failing and passing suite outcomes", async t => {
  const { root, environment } = await fixture(t);
  const before = await environment.test([0]);
  assert.equal(before[0], 1); assert.equal(before[1], false);
  assert(before[2].length + before[3].length > 0);
  await writeFile(join(root, "src/range.mjs"),
    "export function normalizeRange(a,b){return {start:Math.min(a,b),end:Math.max(a,b)}}\n");
  const after = await environment.test([0]);
  assert.equal(after[0], 0); assert.equal(after[1], true);
  for (const result of [before, after]) {
    assert(Buffer.byteLength(result[2]) <= 4096 && Buffer.byteLength(result[3]) <= 4096);
    assert.equal(typeof result[4], "boolean"); assert.equal(typeof result[5], "boolean");
  }
});

test("test output truncation preserves Unicode and reports the truncation flags", async t => {
  const { environment } = await fixture(t);
  const original = childProcess.spawnSync;
  try {
    childProcess.spawnSync = (_, args, options) => {
      assert.equal(options.timeout, 10_000);
      assert.equal(options.killSignal, "SIGKILL");
      assert.equal(options.maxBuffer, 1024 * 1024);
      const report = args.find(arg => arg.startsWith("--reporter-outfile=")).split("=")[1];
      writeFileSync(report, '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="bun test" tests="4"></testsuites>');
      return { status: 1, signal: null, stdout: "文".repeat(2000), stderr: "é".repeat(3000) };
    };
    syncBuiltinESMExports();
    assert.deepEqual(await environment.test([0]), [1, false, "文".repeat(1365), "é".repeat(2048), true, true]);
  } finally {
    childProcess.spawnSync = original;
    syncBuiltinESMExports();
  }
});

test("missing executor remains unavailable rather than a failing baseline", async t => {
  const { environment } = await fixture(t);
  const saved = process.env.PATH;
  try {
    process.env.PATH = "";
    await assert.rejects(environment.test([0]), /executable unavailable/);
  } finally {
    if (saved === undefined) delete process.env.PATH;
    else process.env.PATH = saved;
  }
});
