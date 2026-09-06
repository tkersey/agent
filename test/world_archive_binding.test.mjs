import assert from "node:assert/strict";
import {
  appendFile,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  open,
  rm,
  writeFile,
} from "node:fs/promises";
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
  await assertWorldRootMatchesArchive({ worldRoot, archiveBytes, worldVersion: "4.1.2" });
  const root = await mkdtemp(join(tmpdir(), "agent-world-binding-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const changed = join(root, "world");
  await cp(worldRoot, changed, { recursive: true });
  await appendFile(join(changed, "README.md"), "changed\n");
  await assert.rejects(
    assertWorldRootMatchesArchive({ worldRoot: changed, archiveBytes, worldVersion: "4.1.2" }),
    /executed bytes differ from archive/,
  );

  const extraDirectory = join(root, "extra-directory");
  await cp(worldRoot, extraDirectory, { recursive: true });
  await mkdir(join(extraDirectory, "unsigned-empty-directory"));
  await assert.rejects(
    assertWorldRootMatchesArchive({
      worldRoot: extraDirectory,
      archiveBytes,
      worldVersion: "4.1.2",
    }),
    /inventory differs from the authenticated archive/,
  );

  const changedDirectoryMode = join(root, "changed-directory-mode");
  await cp(worldRoot, changedDirectoryMode, { recursive: true });
  await chmod(join(changedDirectoryMode, "src"), 0o700);
  await assert.rejects(
    assertWorldRootMatchesArchive({
      worldRoot: changedDirectoryMode,
      archiveBytes,
      worldVersion: "4.1.2",
    }),
    /executed mode differs from archive: src/,
  );
});

test("World root traversal rejects excess entries within its fixed bound", async (context) => {
  const archiveBytes = await readBoundedRegularFile(
    worldArchive,
    16 * 1024 * 1024,
    "World archive",
  );
  const root = await mkdtemp(join(tmpdir(), "agent-world-entry-bound-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const changed = join(root, "world");
  await cp(worldRoot, changed, { recursive: true });
  await mkdir(join(changed, "extra"));
  await Promise.all(Array.from({ length: 260 }, (_, index) =>
    writeFile(join(changed, "extra", String(index)), "")));
  await assert.rejects(
    assertWorldRootMatchesArchive({ worldRoot: changed, archiveBytes, worldVersion: "4.1.2" }),
    /entry limit exceeded/,
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
