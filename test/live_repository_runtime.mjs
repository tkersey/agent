import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const initialDigest = "8832f65e4bcf4a701dc76f310f3af34296bf8e95feb16ad70608041cb2e6dbb3";
const fixtureDigest = "8bf50f62e3a4294ef359a6b9096d66e5597ce37824b3483ddad541ee21438453";
const source = `export function normalizeRange(start, end) {
  if (start <= end) {
    return { start, end };
  }
  return { start: end, end: start };
}

`;
const sourceDigest = createHash("sha256").update(source).digest("hex");

if (basename(process.argv[1]) === "runtime.mjs") installOfflineProvider();
else await checkRuntime();

function installOfflineProvider() {
  const replacements = {
    valid: source,
    broken: "export function normalizeRange() { return {}; }\n",
    "early-exit": "export function normalizeRange() { return {}; } process.exit(0);\n",
    "external-write": `import {writeFileSync} from 'node:fs';
      writeFileSync(${JSON.stringify(process.env.AGENT_OFFLINE_ESCAPE_MARKER)}, 'escaped');\n${source}`,
  };
  const replacement = replacements[process.env.AGENT_OFFLINE_REPAIR_CASE];
  assert(replacement);
  const digest = createHash("sha256").update(replacement).digest("hex");
  const actions = [
    ["list_repository", {}], ["read_file", { role: 0 }],
    ["read_file", { role: 1 }], ["read_file", { role: 2 }], ["run_tests", {}],
    ["replace_file", {
      path: "src/range.mjs", expected_sha256: initialDigest, replacement,
      rationale: "An independently worded repair with different source bytes.",
    }],
    ["run_tests", {}],
    ["finish", {
      summary: "Observed the repair result.", changed_path: "src/range.mjs",
      final_source_sha256: digest,
    }],
  ];
  let decision = 0;
  // No network fallback: this tests live control flow, not a credentialed provider.
  globalThis.fetch = async (endpoint, options) => {
    assert.equal(endpoint.href, "https://api.openai.com/v1/responses");
    assert.equal(options.headers.authorization, "Bearer offline-test-not-a-credential");
    assert.equal(options.method, "POST");
    const [name, args] = actions[decision++];
    const request = JSON.parse(options.body);
    assert(request.tools.some((tool) => tool.name === name));
    return new Response(JSON.stringify({
      status: "completed", error: null,
      output: [{
        type: "function_call", id: `fc_${decision}`, call_id: `call_${decision}`,
        status: "completed", name, arguments: JSON.stringify(args),
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  process.on("exit", () => assert.equal(decision, actions.length));
}

async function checkRuntime() {
  const [root, worldRoot, worldArchive] = process.argv.slice(2);
  assert(root && worldRoot && worldArchive, "supply extracted Agent, World, and World archive");
  const workRoot = await mkdtemp(join(tmpdir(), "agent-offline-live-path-"));
  try {
    const marker = join(workRoot, "outside-workspace-marker");
    for (const name of ["valid", "broken", "early-exit", "external-write"]) {
      const work = join(workRoot, name);
      await mkdir(work);
      const result = spawnSync(process.execPath, [
        "--import", fileURLToPath(import.meta.url), join(root, "runtime.mjs"),
        "--worldRoot", worldRoot, "--worldArchive", worldArchive,
        "--workDir", work, "--mode", "live", "--maximumReductions", "30000",
        "--endpoint", "https://api.openai.com/v1/responses",
      ], {
        cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
        env: {
          PATH: process.env.PATH ?? "", OPENAI_API_KEY: "offline-test-not-a-credential",
          AGENT_SYSTEM_CHECKPOINT_KEY: "ab".repeat(32), AGENT_OFFLINE_REPAIR_CASE: name,
          AGENT_OFFLINE_ESCAPE_MARKER: marker,
        },
      });
      assert.equal(result.error, undefined);
      if (name !== "valid") {
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /authored failure/);
        assert(!result.stdout.includes('"result":"passed"'));
        await assert.rejects(readFile(marker), { code: "ENOENT" });
        continue;
      }
      assert.equal(result.status, 0, result.stderr);
      const receipt = JSON.parse(result.stdout.trim());
      assert.equal(receipt.result, "passed");
      assert.equal(receipt.modelRequests, 8);
      assert.equal(receipt.repositoryRequests, 7);
      assert.equal(receipt.realTestProcesses, 2);
      assert.equal(receipt.finalSourceSha256, sourceDigest);
      assert.notEqual(receipt.finalSourceSha256, fixtureDigest);
      assert.equal(await readFile(join(work, "workspace/src/range.mjs"), "utf8"), source);
      const tree = spawnSync("git", ["write-tree"], {
        cwd: join(work, "workspace"), encoding: "utf8", env: { PATH: process.env.PATH ?? "" },
      });
      assert.equal(tree.status, 0, tree.stderr);
      assert.equal(receipt.finalTree, tree.stdout.trim());
      assert.notEqual(receipt.finalTree, "0d9ac8802aac6597cb0a443245efb6f92a0249fe");
    }
    console.log(JSON.stringify({
      result: "passed", nonGoldenRepair: "passed", failedRepairCompletion: "rejected",
      earlyExitCompletion: "rejected", workspaceEscape: "rejected",
      simulatedProvider: true, credentialedLiveModelTestStatus: "not-run",
    }));
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
}
