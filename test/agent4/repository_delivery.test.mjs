import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRepositoryDelivery } from "../../runtime/repository_delivery.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "agent-repository-delivery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src/range.mjs"), "original\n");
  return { root, delivery: await createRepositoryDelivery({ root }),
    proposal: [["src/range.mjs", hash("original\n"), "corrected\n", "repair reason"], 7n] };
}

test("fresh read echoes the exact proposal; real conditional replacement returns actual digests", async t => {
  const { root, delivery, proposal } = await fixture(t);
  assert.deepEqual(await delivery.read(proposal), { tag: 0, value: proposal });
  assert.deepEqual(await delivery.replace(proposal), {
    tag: 0, value: ["src/range.mjs", hash("original\n"), hash("corrected\n"), false],
  });
  assert.equal(await readFile(join(root, "src/range.mjs"), "utf8"), "corrected\n");
  assert.deepEqual(await readdir(root), ["src"]);
});

test("changes after evidence conflict at delivery and preserve external content", async t => {
  const { root, delivery, proposal } = await fixture(t);
  assert.equal((await delivery.read(proposal)).tag, 0);
  await writeFile(join(root, "src/range.mjs"), "external change\n");
  const conflict = ["src/range.mjs", hash("original\n"), hash("external change\n")];
  assert.deepEqual(await delivery.read(proposal), { tag: 1, value: conflict });
  assert.deepEqual(await delivery.replace(proposal), { tag: 1, value: conflict });
  assert.equal(await readFile(join(root, "src/range.mjs"), "utf8"), "external change\n");
});

test("separate delivery instances serialize writes without overwriting the winner", async t => {
  const { root, delivery, proposal } = await fixture(t);
  const second = await createRepositoryDelivery({ root });
  const other = [[...proposal[0]], proposal[1]];
  other[0][2] = "second writer\n";
  const results = await Promise.all([delivery.replace(proposal), second.replace(other)]);
  assert.deepEqual(results.map(x => x.tag).sort(), [0, 1]);
  const actual = hash(await readFile(join(root, "src/range.mjs")));
  assert.equal(results.find(x => x.tag === 0).value[2], actual);
  assert.equal(results.find(x => x.tag === 1).value[2], actual);
});

test("missing and symlink sources return unavailable without reading outside the root", async t => {
  const { root, delivery, proposal } = await fixture(t);
  await rm(join(root, "src/range.mjs"));
  assert.deepEqual(await delivery.read(proposal), { tag: 2, value: "not_found" });
  assert.deepEqual(await delivery.replace(proposal), { tag: 2, value: "not_found" });
  await symlink("../../outside", join(root, "src/range.mjs"));
  assert.deepEqual(await delivery.read(proposal), { tag: 2, value: "unsafe_path" });
  assert.deepEqual(await delivery.replace(proposal), { tag: 2, value: "unsafe_path" });
});

test("caller mutation during I/O cannot substitute the echoed or delivered proposal", async t => {
  const { root, delivery, proposal } = await fixture(t);
  const expected = structuredClone(proposal);
  const read = delivery.read(proposal);
  proposal[0][2] = "substitution";
  proposal[1] = 8n;
  assert.deepEqual(await read, { tag: 0, value: expected });
  const replace = delivery.replace(expected);
  expected[0][2] = "late substitution";
  assert.equal((await replace).tag, 0);
  assert.equal(await readFile(join(root, "src/range.mjs"), "utf8"), "corrected\n");
});

test("malformed proposals reject before acquiring filesystem authority", async t => {
  const { root, delivery, proposal } = await fixture(t);
  const cases = [null, [], [proposal[0]], [proposal[0], 7], [proposal[0], -1n], [proposal[0], 1n << 64n]];
  for (const [index, value] of [[0, "../escape"], [1, "forged"], [2, "x".repeat(32769)], [2, "\ud800"], [3, "x".repeat(4097)]]) {
    const changed = structuredClone(proposal);
    changed[0][index] = value;
    cases.push(changed);
  }
  for (const value of cases) {
    await assert.rejects(delivery.read(value), TypeError);
    await assert.rejects(delivery.replace(value), TypeError);
  }
  assert.equal(await readFile(join(root, "src/range.mjs"), "utf8"), "original\n");
  assert.deepEqual(await readdir(root), ["src"]);
});

test("durability failure after rename remains uncertain and is not automatically retried", async t => {
  const { root, delivery, proposal } = await fixture(t);
  const handle = await open(join(root, "src/range.mjs"), "r");
  const prototype = Object.getPrototypeOf(handle), sync = prototype.sync;
  await handle.close();
  let syncs = 0;
  t.mock.method(prototype, "sync", async function () {
    syncs++;
    if ((await this.stat()).isDirectory()) throw Object.assign(new Error("sync failed"), { code: "EIO" });
    return sync.call(this);
  });
  assert.deepEqual(await delivery.replace(proposal), { tag: 3, value: "io_failure" });
  assert.equal(await readFile(join(root, "src/range.mjs"), "utf8"), "corrected\n");
  assert.equal(syncs, 2);
  assert.deepEqual(await readdir(root), ["src"]);
});
