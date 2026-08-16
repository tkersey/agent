import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SOLUTIONS = Object.freeze({
  "src/methods.mjs": "methods.txt",
  "src/errors.mjs": "errors.txt",
  "src/router.mjs": "router.txt",
  "src/index.mjs": "index.txt"
});

export async function verifyProposal({ agentRoot, capabilitiesRoot, proposal, bunExecutable }) {
  if (!Object.hasOwn(SOLUTIONS, proposal.path)) {
    return Object.freeze({ passed: false, evidenceDigest: sha256("proposal_path_not_admitted") });
  }
  const root = await mkdtemp(join(tmpdir(), "agent-adequacy-proposal-"));
  try {
    const candidate = join(root, "candidate");
    const pristine = join(root, "pristine");
    const home = join(root, "home");
    await cp(join(agentRoot, "fixtures/router-policy-v1"), candidate, { recursive: true, errorOnExist: true });
    await cp(join(agentRoot, "fixtures/router-policy-v1"), pristine, { recursive: true, errorOnExist: true });
    await mkdir(home);
    const solutionRoot = join(capabilitiesRoot, "packages/router-adequacy-decision-fixture/solution");
    for (const [path, source] of Object.entries(SOLUTIONS)) {
      const contents = path === proposal.path
        ? proposal.replacement
        : await readFile(join(solutionRoot, source), "utf8");
      await writeFile(join(candidate, path), contents, "utf8");
    }

    const test = await runTests(bunExecutable, candidate, home);
    if (!test.passed) {
      return Object.freeze({ passed: false, evidenceDigest: sha256(`tests\n${test.output}`) });
    }
    try {
      const { verify } = await import("./hidden-verifier.mjs");
      await verify(candidate, pristine);
      return Object.freeze({ passed: true, evidenceDigest: sha256(`passed\n${proposal.path}\n${sha256(proposal.replacement)}`) });
    } catch (error) {
      return Object.freeze({
        passed: false,
        evidenceDigest: sha256(`hidden\n${error instanceof Error ? error.message : String(error)}`)
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function runTests(executable, cwd, home) {
  const child = Bun.spawn([executable, "test"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { HOME: home, TMPDIR: home, NO_COLOR: "1" }
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited
  ]);
  const output = `${stdout}\n--- stderr ---\n${stderr}`.slice(0, 16 * 1024);
  return { passed: exitCode === 0, output };
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
