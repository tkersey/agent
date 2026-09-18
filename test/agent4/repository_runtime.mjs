// Source-independent application proof: synthetic provider candidates, real
// scoped file operations, real isolated tests, and actual PST3 successors.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyRuntime, readDependencyLock } from "../../tools/agent4/dependencies.mjs";
import { decodeSchema, decodeValue, encodeValue } from "../../runtime/values.mjs";
import { createRepositoryEnvironment } from "../../runtime/repository.mjs";
import { decodeModelInvocation, normalizeOpenAIResponses } from "../../runtime/model.mjs";

const [runtimePath, imageRoot] = process.argv.slice(2).map(value => resolve(value));
const identity = verifyRuntime(runtimePath), lock = readDependencyLock();
const world = await import(pathToFileURL(identity.entrypoint));
const kernelBytes = await readFile(identity.kernelPath), image = await readFile(join(imageRoot, "repair.bpi3"));
const task = decodeSchema(await readFile(join(imageRoot, "task-schema.bin")));
const result = decodeSchema(await readFile(join(imageRoot, "result-schema.bin")));
const failure = decodeSchema(await readFile(join(imageRoot, "failure-schema.bin")));
const paths = ["README.md", "package.json", "src/range.mjs", "test/range.test.mjs"];
const fixture = resolve(import.meta.dirname, "../../fixtures/repository-repair-v1");
const hash = value => createHash("sha256").update(value).digest("hex");
const corrected = "export function normalizeRange(a,b){return {start:Math.min(a,b),end:Math.max(a,b)}}\n\n";
let transfers = 0, realTests = 0;

async function run(mode) {
  const area = await mkdtemp(join(tmpdir(), "agent-real-repository-"));
  try {
    const root = join(area, "repository"), marker = join(area, "outside.txt");
    await cp(fixture, root, { recursive: true });
    await writeFile(marker, "outside sentinel");
    const initial = await readFile(join(root, "src/range.mjs"));
    const replacements = {
      broken: "export function normalizeRange(){return {}}\n",
      "early-exit": "process.exit(0); export function normalizeRange(){return {}}\n",
      "external-write": `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'escaped');\n${corrected}`,
    };
    const replacement = replacements[mode] ?? corrected;
    const environment = await createRepositoryEnvironment({ root, paths, writablePaths: ["src/range.mjs"] });
    const actions = [
      ["list_repository", {}],
      ["read_file", { role: "package", path: "package.json" }],
      ["read_file", { role: "source", path: "src/range.mjs" }],
      ["read_file", { role: "test", path: "test/range.test.mjs" }],
      ["search_text", { query: "normalizeRange", path_prefix: "src/" }],
      ["run_tests", { suite: "default" }],
      ["replace_file", { path: "src/range.mjs", expected_sha256: hash(initial), replacement,
        rationale: "Repair the observed failing range cases." }],
      ["run_tests", { suite: "default" }],
      ["finish", { summary: "Repaired and observed the complete test suite.", path0: "src/range.mjs",
        path1: "", path2: "", path3: "", path_count: 1, tests_passed: true, final_source_sha256: hash(replacement) }],
    ];
    let decisions = 0, writes = 0, tests = 0, approvals = 0;
    let input = { image, initialArgs: encodeValue(task, [["Repair reversed ranges.", "range fixture"], "fixture-model", 7n, 12]) };
    for (let round = 0; round < 32; round++) {
      const kernel = await world.Kernel.create({ bytes: kernelBytes, expectedSha256: identity.kernelSha256 });
      const ceiling = lock.world.runtime.physicalProfile.maximumMemoryBytes;
      kernel.setLimits({ input: ceiling, working: ceiling, output: ceiling });
      const outcome = world.decodeOutcome(kernel.invoke(world.encodeInput(input)));
      if (outcome.kind !== "requested") {
        const decoded = decodeValue(outcome.kind === "completed" ? result : failure, outcome.value);
        const source = await readFile(join(root, "src/range.mjs"));
        assert.equal(await readFile(marker, "utf8"), "outside sentinel");
        if (outcome.kind === "completed") {
          // Independent terminal oracle binds claims to the actual filesystem.
          assert.deepEqual(decoded.slice(1), [["src/range.mjs"], true, hash(source)]);
          assert.equal(source.toString("utf8"), corrected);
        }
        return { kind: outcome.kind, decoded, decisions, writes, tests, approvals };
      }
      const pending = await world.decodeRequest(outcome.request);
      const payload = decodeValue(decodeSchema(pending.payloadSchema), pending.payload);
      let reply, encoded;
      const leaf = {
        "repository.repair.list.v1": "list", "repository.repair.read.v1": "read",
        "repository.repair.search.v1": "search", "repository.repair.test.v1": "test",
        "repository.repair.current.v1": "current", "repository.repair.replace.v1": "replace",
      }[pending.semanticIdentity];
      if (leaf) {
        if (leaf === "replace") writes++;
        if (leaf === "test") {
          tests++; realTests++;
          assert.deepEqual(payload, [[0], {tag: 1, value: ["src/range.mjs",
            tests === 1 || mode === "denied" ? hash(initial) : hash(replacement)]}]);
          if (mode === "source-drift") await writeFile(join(root, "src/range.mjs"), "changed while suspended");
          if (mode === "suite-drift") await writeFile(join(root, "test/range.test.mjs"), "process.exit(0)");
        }
        try { reply = await environment[leaf](payload); }
        catch (error) {
          if (!["source-drift", "suite-drift"].includes(mode) || leaf !== "test") throw error;
          assert.match(error.message, mode === "source-drift" ? /test source changed/ : /test suite changed/);
          // No external observation was produced: the actual parked request is
          // still pending, not converted into baseline-failure evidence.
          const parked = world.decodeOutcome(kernel.invoke(world.encodeInput({image, state: outcome.state})));
          assert.equal(parked.kind, "requested");
          assert.deepEqual(parked.request, outcome.request);
          assert.deepEqual(parked.state, outcome.state);
          return {kind: "unavailable", decisions, writes, tests, approvals};
        }
        if (leaf === "test") assert.equal(reply[1], tests > 1 && !["broken", "early-exit", "external-write", "denied"].includes(mode));
      } else if (pending.semanticIdentity === "agent.model.invoke.v3") {
        const invocation = decodeModelInvocation(pending.payload);
        assert.equal(invocation.tools.length, 7);
        const context = invocation.messages[2].content;
        if (decisions === 6) assert.match(context, /failing_test_observed: true/);
        if (decisions === 8) assert.match(context, mode === "approved" ? /passing_test_observed: true/ : /passing_test_observed: false/);
        const [name, args] = actions[decisions++];
        encoded = normalizeOpenAIResponses(new TextEncoder().encode(JSON.stringify({ status: "completed", error: null,
          output: [{ type: "function_call", status: "completed", call_id: `repair-${decisions}`, name, arguments: JSON.stringify(args) }],
        })), invocation.normalizationLimits, invocation.tools);
      } else if (pending.semanticIdentity === "agent.approval.issue.v1.repository.repair.replace") {
        reply = 41n;
      } else if (pending.semanticIdentity === "agent.interaction.exchange.v1.repository.repair.replace") {
        approvals++;
        reply = { tag: 0, value: [payload[3], 7n, mode === "denied"
          ? { tag: 1, value: "owner declined" } : { tag: 0, value: null }] };
      } else throw new Error(`unexpected effect ${pending.semanticIdentity}`);
      encoded ??= encodeValue(decodeSchema(pending.resumeSchema), reply);
      input = { image, state: outcome.state, control: "reply", value: await world.encodeResult(outcome.request, encoded) };
      transfers++;
    }
    throw new Error("repository repair did not terminate");
  } finally { await rm(area, { recursive: true, force: true }); }
}

for (const mode of ["approved", "broken", "early-exit", "external-write", "denied"]) {
  const actual = await run(mode);
  assert.equal(actual.kind, mode === "approved" ? "completed" : "failed", mode);
  if (mode !== "approved") assert.equal(actual.decoded, 5, mode);
  assert.equal(actual.decisions, 9, mode);
  assert.equal(actual.tests, 2, mode);
  assert.equal(actual.writes, mode === "denied" ? 0 : 1, mode);
  assert.equal(actual.approvals, 1, mode);
}
console.log(`repository repair: 5 cases passed; ${realTests} real isolated test processes; ${transfers} fresh-kernel transfers`);
for (const mode of ["source-drift", "suite-drift"]) {
  const actual = await run(mode);
  assert.equal(actual.kind, "unavailable");
  assert.equal(actual.decisions, 6);
  assert.equal(actual.writes, 0);
  assert.equal(actual.approvals, 0);
}
console.log("repository repair: changed source/suite preserve the pending request without test evidence");
