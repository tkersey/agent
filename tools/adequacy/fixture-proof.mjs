import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";

const repository = resolve(import.meta.dir, "../..");
const fixture = resolve(repository, "fixtures/router-policy-v1");
const solution = resolve(repository, "tools/adequacy/reference-solution");
const writable = ["methods.mjs", "errors.mjs", "router.mjs", "index.mjs"];

async function verifyManifest() {
  const manifest = JSON.parse(
    await readFile(resolve(repository, "tools/adequacy/fixture-initial-manifest.json"), "utf8"),
  );
  assert.equal(manifest.schema, "router-policy-fixture-manifest/v1");
  assert.equal(manifest.files.length, 9);
  for (const file of manifest.files) {
    const bytes = await readFile(resolve(fixture, file.path));
    assert.equal(bytes.length, file.bytes, `${file.path} byte count`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256, `${file.path} digest`);
  }
}

async function runTests(workspace) {
  const child = Bun.spawn([process.execPath, "test"], {
    cwd: workspace,
    env: { PATH: process.env.PATH ?? "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, output: `${stdout}\n--- stderr ---\n${stderr}`.slice(0, 8192) };
}

async function makeWorkspace(root, name, solvedExcept = []) {
  const workspace = resolve(root, name);
  await cp(fixture, workspace, { recursive: true });
  for (const file of solvedExcept) {
    await copyFile(resolve(solution, file), resolve(workspace, "src", file));
  }
  return workspace;
}

const root = await mkdtemp(resolve(tmpdir(), "agent-adequacy-fixture-"));
try {
  await verifyManifest();
  const initial = await makeWorkspace(root, "initial");
  const initialResult = await runTests(initial);
  assert.notEqual(initialResult.exitCode, 0, "initial fixture must fail its visible tests");

  for (const missing of writable) {
    const workspace = await makeWorkspace(
      root,
      `missing-${basename(missing, ".mjs")}`,
      writable.filter((file) => file !== missing),
    );
    const result = await runTests(workspace);
    assert.notEqual(result.exitCode, 0, `${missing} must independently contribute a visible failure`);
  }

  const solved = await makeWorkspace(root, "solved", writable);
  const solvedResult = await runTests(solved);
  assert.equal(solvedResult.exitCode, 0, `reviewed solution must pass:\n${solvedResult.output}`);

  const verifier = Bun.spawn(
    [process.execPath, resolve(repository, "tools/adequacy/hidden-verifier.mjs"), solved, fixture],
    { cwd: repository, stdout: "pipe", stderr: "pipe" },
  );
  const [verifierOutput, verifierError, verifierExit] = await Promise.all([
    new Response(verifier.stdout).text(),
    new Response(verifier.stderr).text(),
    verifier.exited,
  ]);
  assert.equal(verifierExit, 0, `hidden verifier must pass:\n${verifierOutput}\n${verifierError}`);
  console.log("agent adequacy fixture: initial failure, four owner failures, visible pass, hidden pass");
} finally {
  await rm(root, { recursive: true, force: true });
}
