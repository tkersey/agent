import assert from "node:assert/strict";
import { appendFile, cp, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  assertWorldRootMatchesArchive,
  readBoundedRegularFile,
} from "../system_closure_v1/world_archive_binding.mjs";

const [worldRoot, worldArchive] = process.argv.slice(2).map((value) => resolve(value));

test("the executed World root must equal the authenticated archive", async (context) => {
  const archiveBytes = await readBoundedRegularFile(
    worldArchive,
    16 * 1024 * 1024,
    "World archive",
  );
  await assertWorldRootMatchesArchive({ worldRoot, archiveBytes, worldVersion: "4.1.0" });
  const root = await mkdtemp(join(tmpdir(), "agent-world-binding-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const changed = join(root, "world");
  await cp(worldRoot, changed, { recursive: true });
  await appendFile(join(changed, "README.md"), "changed\n");
  await assert.rejects(
    assertWorldRootMatchesArchive({ worldRoot: changed, archiveBytes, worldVersion: "4.1.0" }),
    /executed World bytes differ from archive/,
  );
});

test("bounded reads reject oversized files before allocation", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "agent-bounded-input-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "oversized.bin");
  const handle = await open(path, "w");
  await handle.truncate(4097);
  await handle.close();
  await assert.rejects(
    readBoundedRegularFile(path, 4096, "fixture input"),
    /exceeds its size limit/,
  );
});
