import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  CORRECT_SOURCE,
  EXPECTED_FINAL_DIGEST,
  EXPECTED_INITIAL_DIGEST,
  createRepositoryEnvironment,
  validateFinalResult,
} from "../system_closure_v1/repository_environment.mjs";

const fixture = resolve("fixtures/repository-repair-v1");

test("repository search is total for empty Text and preserves a leading BOM", async (context) => {
  const workspace = await fixtureWorkspace(context);
  const repository = await createRepositoryEnvironment(workspace);
  const empty = await repository.resolveEffect({
    effectSemanticIdentity: "repo.search.v1",
    payload: encodeText(""),
  });
  assert.equal(decodeText(empty), "");

  const bom = await repository.resolveEffect({
    effectSemanticIdentity: "repo.search.v1",
    payload: encodeText("\ufeffnormalizeRange"),
  });
  assert.equal(decodeText(bom), "");
});

test("live replacement and completion accept free-form explanatory text", async (context) => {
  const workspace = await fixtureWorkspace(context);
  const repository = await createRepositoryEnvironment(
    workspace,
    { baselineFailed: true },
    "live",
  );
  await repository.resolveEffect({
    effectSemanticIdentity: "repo.replace.approved.v1",
    payload: Buffer.concat([
      encodeText("src/range.mjs"),
      encodeText(EXPECTED_INITIAL_DIGEST),
      encodeText(CORRECT_SOURCE),
      encodeText("Equivalent repair with independently worded rationale."),
    ]),
  });
  assert.equal(repository.snapshot().mutationApplied, true);
  assert.equal(await readFile(join(workspace, "src/range.mjs"), "utf8"), CORRECT_SOURCE);

  const result = {
    summary: "Equivalent completion summary.",
    changed_path: "src/range.mjs",
    final_source_sha256: EXPECTED_FINAL_DIGEST,
  };
  validateFinalResult(result, "live");
  assert.throws(() => validateFinalResult(result, "fixture"));
});

test("fixture replacement retains its exact deterministic rationale", async (context) => {
  const workspace = await fixtureWorkspace(context);
  const repository = await createRepositoryEnvironment(
    workspace,
    { baselineFailed: true },
    "fixture",
  );
  await assert.rejects(repository.resolveEffect({
    effectSemanticIdentity: "repo.replace.approved.v1",
    payload: Buffer.concat([
      encodeText("src/range.mjs"),
      encodeText(EXPECTED_INITIAL_DIGEST),
      encodeText(CORRECT_SOURCE),
      encodeText("Different rationale."),
    ]),
  }));
  assert.equal(repository.snapshot().mutationApplied, false);
});

async function fixtureWorkspace(context) {
  const root = await mkdtemp(join(tmpdir(), "agent-repository-environment-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  await cp(fixture, workspace, { recursive: true });
  return workspace;
}

function encodeText(value) {
  const valueBytes = Buffer.from(value);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(valueBytes.length);
  return Buffer.concat([length, valueBytes]);
}

function decodeText(bytes) {
  const length = bytes.readUInt32LE(0);
  assert.equal(bytes.length, 4 + length);
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    bytes.subarray(4),
  );
}
