import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
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

test("launch failure and absent or incomplete reports are not test observations", async (context) => {
  const workspace = await fixtureWorkspace(context);
  const spawn = childProcess.spawnSync;
  try {
    for (const [status, report, error = /did not report completed tests/] of [
      [71, ""], [1, ""], [0, ""],
      [1, '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="bun test" tests="4">'],
      [0, '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="bun test" tests="0"></testsuites>'],
      [1, "x".repeat(1024 * 1024 + 1), /exceeds its file bound/],
    ]) {
      let reportPath;
      childProcess.spawnSync = (_, args) => {
        reportPath = args.find((arg) => arg.startsWith("--reporter-outfile="))
          .slice("--reporter-outfile=".length);
        writeFileSync(reportPath, report);
        return { status, signal: null, stdout: "", stderr: "sandbox_apply: Operation not permitted" };
      };
      syncBuiltinESMExports();
      const repository = await createRepositoryEnvironment(workspace);
      await assert.rejects(repository.resolveEffect({
        effectSemanticIdentity: "repo.test.v1", payload: Buffer.alloc(0),
      }), error);
      assert.equal(existsSync(reportPath), false);
      assert.equal(repository.snapshot().baselineFailed, false);
      assert.equal(repository.snapshot().realTestProcesses, 0);
      assert.equal(repository.snapshot().postMutationPassed, false);
    }
  } finally {
    childProcess.spawnSync = spawn;
    syncBuiltinESMExports();
  }
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

test("replacement code cannot exit, forge output, mock assertions, or pass matcher objects", async (context) => {
  const workspace = await fixtureWorkspace(context);
  const replacements = [
    "export function normalizeRange(",
    "export function normalizeRange() { return {}; } process.exit(0);",
    "export function normalizeRange() { return {}; } console.log('4 pass\\n0 fail\\n4 expect() calls'); process.exit(0);",
    "import {mock} from 'bun:test'; mock.module('bun:test', () => ({})); export function normalizeRange(){return {};}",
    "export function normalizeRange(){return {asymmetricMatch(){return true}, $$typeof: Symbol.for('jest.asymmetricMatcher')};}",
    "export function normalizeRange(){return {get start(){return 1}, end:3};}",
    "export function normalizeRange(a,b){return {start:a,end:b,toJSON(){return {start:Math.min(a,b),end:Math.max(a,b)}}};}",
    "await import('node:process').catch(e => e.constructor.constructor('return process')().exit(0)); export function normalizeRange(){return {};}",
    "const p=import('node:process'); p.catch(()=>{}); p.constructor.constructor('return process')().exit(0); export function normalizeRange(){return {};}",
    "globalThis.constructor.constructor('return process')().exit(0); export function normalizeRange(){return {};}",
    "Array.prototype[Symbol.iterator]=function*(){yield Math.min(this[0],this[1]);yield Math.max(this[0],this[1]);}; export function normalizeRange(start,end){return {start,end};}",
    "export function normalizeRange(a,b){return new Proxy({}, {ownKeys(){return ['start','end']}, getOwnPropertyDescriptor(_,key){return {enumerable:true,configurable:true,value:key==='start'?Math.min(a,b):Math.max(a,b)}}});}",
  ];
  for (const replacement of replacements) {
    await writeFile(join(workspace, "src/range.mjs"), replacement);
    const repository = await createRepositoryEnvironment(workspace, { mutationApplied: true });
    const result = await repository.resolveEffect({
      effectSemanticIdentity: "repo.test.v1", payload: Buffer.alloc(0),
    });
    assert.equal(result[0], 0, replacement);
    assert.equal(repository.snapshot().postMutationPassed, false);
  }
});

test("test process authority is read-only and excludes the outer workspace", async (context) => {
  const workspace = await fixtureWorkspace(context);
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  context.after(() => new Promise((done) => server.close(done)));
  const port = server.address().port;
  await writeFile(join(workspace, "src/range.mjs"), CORRECT_SOURCE);
  const marker = join(workspace, "..", "outside.txt");
  const outside = await realpath(join(workspace, ".."));
  await writeFile(marker, "outside sentinel");
  const tests = join(workspace, "test/range.test.mjs");
  await writeFile(tests, `${await readFile(tests, "utf8")}\n
    import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
    import {spawnSync} from 'node:child_process';
    test('OS confinement applies independently of the replacement realm', async () => {
      expect(() => readFileSync(${JSON.stringify(marker)})).toThrow();
      let parentEntries;
      try { parentEntries = readdirSync(${JSON.stringify(outside)}); } catch {}
      // Bubblewrap constructs an empty parent, not the real host directory.
      if (parentEntries !== undefined) expect(parentEntries).toEqual(['workspace']);
      expect(() => writeFileSync(${JSON.stringify(marker)}, 'changed')).toThrow();
      expect(() => writeFileSync('src/range.mjs', 'changed')).toThrow();
      expect(spawnSync('/bin/sh', ['-c', 'echo escaped > "$1"', 'sh', ${JSON.stringify(marker)}]).status).not.toBe(0);
      await expect(Bun.connect({hostname:'127.0.0.1', port:${port}, socket:{data(){}}})).rejects.toThrow();
    });
  `);
  const repository = await createRepositoryEnvironment(workspace, { mutationApplied: true });
  const result = await repository.resolveEffect({
    effectSemanticIdentity: "repo.test.v1", payload: Buffer.alloc(0),
  });
  assert.equal(result[0], 1);
  assert.equal(await readFile(marker, "utf8"), "outside sentinel");
  assert.equal(await readFile(join(workspace, "src/range.mjs"), "utf8"), CORRECT_SOURCE);
});

async function fixtureWorkspace(context) {
  const root = await mkdtemp(join(tmpdir(), "agent-repository-environment-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  await cp(fixture, workspace, { recursive: true });
  return workspace;
}

test("valid accessor and proxy repairs retain their fixture observations", async (context) => {
  const workspace = await fixtureWorkspace(context);
  for (const source of [
    "export function normalizeRange(a,b){return {get start(){return Math.min(a,b)}, get end(){return Math.max(a,b)}};}",
    "export function normalizeRange(a,b){return new Proxy({start:Math.min(a,b),end:Math.max(a,b)}, {});}",
  ]) {
    await writeFile(join(workspace, "src/range.mjs"), source);
    const repository = await createRepositoryEnvironment(workspace, { mutationApplied: true });
    const response = await repository.resolveEffect({effectSemanticIdentity:"repo.test.v1",payload:Buffer.alloc(0)});
    assert.equal(response[0], 1, source);
  }
});

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
