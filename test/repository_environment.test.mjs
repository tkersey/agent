import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  CORRECT_SOURCE,
  EXPECTED_FINAL_DIGEST,
  EXPECTED_INITIAL_DIGEST,
  createRepositoryEnvironment,
  sha256,
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
  validateFinalResult(result, "live", Buffer.from(CORRECT_SOURCE));
  assert.throws(() => validateFinalResult(result, "fixture", Buffer.from(CORRECT_SOURCE)));
});

test("live repairs return actual digests without imposing the fixture answer", async (context) => {
  const workspace = await fixtureWorkspace(context);
  const sourcePath = join(workspace, "src/range.mjs");
  const before = `${await readFile(sourcePath, "utf8")}\n`;
  await writeFile(sourcePath, before);
  const replacement = `${CORRECT_SOURCE}\n`;
  const repository = await createRepositoryEnvironment(
    workspace,
    { baselineFailed: true },
  );
  const response = await repository.resolveEffect({
    effectSemanticIdentity: "repo.replace.approved.v1",
    payload: Buffer.concat([
      encodeText("src/range.mjs"),
      encodeText(sha256(before)),
      encodeText(replacement),
      encodeText("Different rationale."),
    ]),
  });
  assert.equal(response[0], 1);
  assert.deepEqual(decodeTexts(response.subarray(1)), [
    "src/range.mjs", sha256(before), sha256(replacement), "replacement applied",
  ]);
  assert.equal(await readFile(sourcePath, "utf8"), replacement);
  const tests = await repository.resolveEffect({
    effectSemanticIdentity: "repo.test.v1", payload: Buffer.alloc(0),
  });
  assert.equal(tests[0], 1);
  const result = {
    summary: "Repaired with a trailing blank line.",
    changed_path: "src/range.mjs",
    final_source_sha256: sha256(replacement),
  };
  validateFinalResult(result, "live", Buffer.from(replacement));
  assert.throws(() => validateFinalResult(result, "fixture", Buffer.from(replacement)));
  assert.throws(() => validateFinalResult({
    ...result, final_source_sha256: EXPECTED_FINAL_DIGEST,
  }, "live", Buffer.from(replacement)));
});

test("repository observations preserve a failing post-replacement test", async (context) => {
  const workspace = await fixtureWorkspace(context);
  const repository = await createRepositoryEnvironment(workspace);
  const baseline = await repository.resolveEffect({
    effectSemanticIdentity: "repo.test.v1", payload: Buffer.alloc(0),
  });
  assert.equal(baseline[0], 0);
  const broken = "export function normalizeRange() { return {}; }\n";
  await repository.resolveEffect({
    effectSemanticIdentity: "repo.replace.approved.v1",
    payload: Buffer.concat([
      encodeText("src/range.mjs"), encodeText(EXPECTED_INITIAL_DIGEST),
      encodeText(broken), encodeText("Attempted repair."),
    ]),
  });
  const retest = await repository.resolveEffect({
    effectSemanticIdentity: "repo.test.v1", payload: Buffer.alloc(0),
  });
  assert.equal(retest[0], 0);
  assert.equal(repository.snapshot().postMutationPassed, false);
  assert.equal(repository.snapshot().realTestProcesses, 2);
});

test("replacement still checks the actual digest before changing the file", async (context) => {
  const workspace = await fixtureWorkspace(context);
  const sourcePath = join(workspace, "src/range.mjs");
  const before = await readFile(sourcePath);
  const repository = await createRepositoryEnvironment(workspace, { baselineFailed: true });
  await assert.rejects(repository.resolveEffect({
    effectSemanticIdentity: "repo.replace.approved.v1",
    payload: Buffer.concat([
      encodeText("src/range.mjs"), encodeText("0".repeat(64)),
      encodeText(CORRECT_SOURCE), encodeText("Stale proposal."),
    ]),
  }));
  assert.deepEqual(await readFile(sourcePath), before);
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

function decodeTexts(bytes) {
  const values = [];
  for (let offset = 0; offset < bytes.length;) {
    const length = bytes.readUInt32LE(offset);
    values.push(decodeText(bytes.subarray(offset, offset + 4 + length)));
    offset += 4 + length;
  }
  return values;
}
