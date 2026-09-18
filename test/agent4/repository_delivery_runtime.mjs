import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyRuntime, readDependencyLock } from "../../tools/agent4/dependencies.mjs";
import { decodeSchema, decodeValue, encodeValue } from "../../runtime/values.mjs";
import { createRepositoryDelivery } from "../../runtime/repository_delivery.mjs";

const [emitter, runtimePath] = process.argv.slice(2).map(value => resolve(value));
const identity = verifyRuntime(runtimePath);
const ceiling = readDependencyLock().world.runtime.physicalProfile.maximumMemoryBytes;
const world = await import(pathToFileURL(identity.entrypoint));
const kernelBytes = await readFile(identity.kernelPath);
const image = execFileSync(emitter);
const schema = name => decodeSchema(execFileSync(emitter, [`${name}-schema`]));
const inputSchema = schema("input"), resultSchema = schema("result"), failureSchema = schema("failure");
const hash = value => createHash("sha256").update(value).digest("hex");
const initial = "original source\n", corrected = "independently chosen correction\n";
const none = { tag: 0, value: null }, some = value => ({ tag: 1, value });
const request = ["src/range.mjs", hash(initial), corrected, "repair the observed failure"];
const proposal = [request, 7n];
let restores = 0;

async function run(mode) {
  const root = await mkdtemp(join(tmpdir(), "agent-repository-kernel-"));
  try {
    await mkdir(join(root, "src"));
    const path = join(root, "src/range.mjs");
    await writeFile(path, initial);
    const delivery = await createRepositoryDelivery({ root });
    const memory = [none, none, some([1, 1, request[0], request[1], initial]), none,
      none, none, none, mode !== "no-baseline", false, false];
    let input = { image, initialArgs: encodeValue(inputSchema, [memory, request, 7n]) };
    let commits = 0, reads = 0, questions = 0;
    for (let step = 0; step < 6; step++) {
      // Each reply starts from the actual prior PST3 with no resident state.
      const kernel = await world.Kernel.create({ bytes: kernelBytes, expectedSha256: identity.kernelSha256 });
      kernel.setLimits({ input: ceiling, working: ceiling, output: ceiling });
      const outcome = world.decodeOutcome(kernel.invoke(world.encodeInput(input)));
      if (outcome.kind !== "requested") {
        const value = decodeValue(outcome.kind === "completed" ? resultSchema : failureSchema, outcome.value);
        const content = await readFile(path, "utf8");
        return { kind: outcome.kind, value, content, commits, reads, questions };
      }
      const pending = await world.decodeRequest(outcome.request);
      const payload = decodeValue(decodeSchema(pending.payloadSchema), pending.payload);
      let reply;
      switch (pending.semanticIdentity) {
        case "repository.repair.current.v1":
          reads++;
          assert.deepEqual(payload, proposal);
          if (mode === "changed-before-read") await writeFile(path, "external change\n");
          reply = await delivery.read(payload);
          break;
        case "agent.approval.issue.v1.repository.repair.replace":
          assert.deepEqual(payload, proposal);
          reply = 23n;
          break;
        case "agent.interaction.exchange.v1.repository.repair.replace": {
          questions++;
          assert.equal(payload[0], "repository-owner");
          const challenge = payload[3];
          assert.deepEqual(challenge, [23n, proposal]);
          if (mode === "changed-during-approval") await writeFile(path, "external change\n");
          if (mode === "stale") challenge[0] = 22n;
          const decision = mode === "denied" ? { tag: 1, value: "owner declined" } : { tag: 0, value: null };
          reply = { tag: 0, value: [challenge, mode === "wrong-principal" ? 8n : 7n, decision] };
          break;
        }
        case "repository.repair.replace.v1":
          commits++;
          assert.deepEqual(payload, proposal);
          reply = await delivery.replace(payload);
          break;
        default: throw new Error(`unexpected request ${pending.semanticIdentity}`);
      }
      input = { image, state: outcome.state, control: "reply",
        value: await world.encodeResult(outcome.request, encodeValue(decodeSchema(pending.resumeSchema), reply)) };
      restores++;
    }
    throw new Error("replacement did not terminate");
  } finally { await rm(root, { recursive: true, force: true }); }
}

const applied = await run("approved");
assert.deepEqual(applied, { kind: "completed", value: { tag: 0,
  value: [request[0], hash(initial), hash(corrected), false] }, content: corrected, commits: 1, reads: 1, questions: 1 });
for (const mode of ["changed-before-read", "changed-during-approval"]) {
  const actual = await run(mode);
  assert.equal(actual.kind, "completed");
  assert.deepEqual(actual.value, { tag: 2, value: [request[0], hash(initial), hash("external change\n")] });
  assert.equal(actual.content, "external change\n");
  assert.equal(actual.commits, mode === "changed-before-read" ? 0 : 1);
  assert.equal(actual.questions, mode === "changed-before-read" ? 0 : 1);
}
for (const mode of ["no-baseline", "denied", "wrong-principal", "stale"]) {
  const actual = await run(mode);
  assert.equal(actual.kind, mode === "stale" ? "failed" : "completed");
  assert.equal(mode === "stale" ? actual.value : actual.value.tag, mode === "stale" ? 3 : 1);
  assert.equal(actual.content, initial);
  assert.equal(actual.commits, 0);
  assert.equal(actual.reads, mode === "no-baseline" ? 0 : 1);
}
console.log(`repository delivery: 7 cases passed; ${restores} fresh-kernel restores; actual fixture I/O`);

// The application chooses each action and folds its own working set. Scripted
// provider replies supply candidates; they neither dispatch tools nor set flags.
const { decodeModelInvocation, normalizeOpenAIResponses } = await import('../../runtime/model.mjs');
const { createDocumentEnvironment } = await import('../../runtime/document.mjs');
const application = execFileSync(emitter, ['application']);
const taskSchema = schema('task'), finalSchema = schema('final');
const finish = { summary: 'Observed the repaired result.', path0: request[0], path1: '', path2: '', path3: '',
  path_count: 1, tests_passed: true, final_source_sha256: hash(corrected) };
const actions = [
  ['list_repository', {}], ['read_file', { role: 'source', path: request[0] }],
  ['run_tests', { suite: 'default' }], ['replace_file', { path: request[0], expected_sha256: hash(initial),
    replacement: corrected, rationale: 'Repair after failing baseline.' }],
  ['run_tests', { suite: 'default' }], ['finish', finish],
];
async function repair(mode) {
  const root = await mkdtemp(join(tmpdir(), 'agent-repository-loop-'));
  try {
    await mkdir(join(root, 'src'));
    const path = join(root, request[0]);
    await writeFile(path, mode === 'max-documents' ? 'é'.repeat(16384) : initial);
    const many = ['multiple', 'fifth-file', 'repeat-write', 'duplicate-final', 'omitted-final'].includes(mode);
    let steps = actions;
    if (many) {
      const names = Array.from({length: mode === 'fifth-file' ? 5 : 4}, (_, i) => 'src/file' + i + '.mjs');
      steps = [['run_tests', {suite: 'default'}]];
      for (const name of names) {
        await writeFile(join(root, name), initial);
        steps.push(['read_file', {role: 'source', path: name}], ['replace_file', {
          path: name, expected_sha256: hash(initial), replacement: corrected, rationale: 'observed repair',
        }]);
      }
      if (mode === 'repeat-write') steps.push(['read_file', {role: 'source', path: names[0]}], ['replace_file', {
        path: names[0], expected_sha256: hash(corrected), replacement: corrected + 'again', rationale: 'follow-up repair',
      }]);
      const claimed = [...names.slice(0,4)].reverse();
      if (mode === 'duplicate-final') claimed[1] = claimed[0];
      steps.push(['run_tests', {suite: 'default'}], ['finish', {...finish,
        path0: claimed[0], path1: claimed[1], path2: claimed[2], path3: claimed[3],
        path_count: mode === 'omitted-final' ? 3 : 4,
        final_source_sha256: hash(mode === 'repeat-write' ? corrected + 'again' : corrected),
      }]);
    }
    const files = await createDocumentEnvironment({ root, maximumContentBytes: 32768 });
    const delivery = await createRepositoryDelivery({ root });
    let input = { image: application, initialArgs: encodeValue(taskSchema,
      [['Repair the failing range function.', 'fixture repository'], 'fixture-model', 7n, many ? 20 : mode === 'repeat' ? 32 : mode === 'budget' ? 2 : 8]) };
    let decisions = 0, tests = 0, writes = 0;
    const retained = [];
    for (let step = 0; step < 80; step++) {
      const kernel = await world.Kernel.create({ bytes: kernelBytes, expectedSha256: identity.kernelSha256 });
      kernel.setLimits({ input: ceiling, working: ceiling, output: ceiling });
      const outcome = world.decodeOutcome(kernel.invoke(world.encodeInput(input)));
      if (outcome.kind !== 'requested') return { kind: outcome.kind,
        value: decodeValue(outcome.kind === 'completed' ? finalSchema : failureSchema, outcome.value),
        content: await readFile(path, 'utf8'), decisions, tests, writes, retained };
      const pending = await world.decodeRequest(outcome.request);
      const payload = decodeValue(decodeSchema(pending.payloadSchema), pending.payload);
      let reply, encoded;
      switch (pending.semanticIdentity) {
        case 'agent.model.invoke.v3': {
          const invocation = decodeModelInvocation(pending.payload);
          assert.equal(invocation.tools.length, 7);
          assert.equal(invocation.selection.minimumCalls, 1);
          const context = invocation.messages[2].content;
          assert.match(invocation.messages[1].content, /Repair the failing range function/);
          if (!many && decisions === 0) assert.match(context, /source_document: not observed/);
          if (!many && !['repeat', 'max-documents'].includes(mode) && decisions === 2) assert(context.includes(hash(initial)) && context.includes(initial));
          if (!many && !['repeat', 'max-documents'].includes(mode) && decisions === 3) assert.match(context, /failing_test_observed: true/);
          if (!many && !['repeat', 'max-documents'].includes(mode) && decisions === 4 && mode !== 'denied') {
            assert.match(context, /source_document: not observed/);
            assert.match(context, /mutation_applied: true/);
            assert.match(context, /passing_test_observed: false/);
          }
          if (decisions >= 2) retained.push(outcome.state.length);
          if (mode === 'max-documents' && decisions === 3) {
            assert(Buffer.byteLength(context) > 98_304);
            assert(Buffer.byteLength(context) <= 131_072);
          }
          const full = decisions < 3 ? ['read_file', {role: ['package','source','test'][decisions], path: request[0]}] : ['abort', {value: 'authored_abort'}];
          const [name, originalArgs] = mode === 'max-documents' ? full : mode === 'repeat' ? ['list_repository', {}] : mode === 'early-finish' ? ['finish', finish] : steps[decisions];
          const args = mode === 'wrong-final-path' && name === 'finish' ? {...originalArgs, path0: 'test/range.test.mjs'} : mode === 'wrong-final-digest' && name === 'finish' ? {...originalArgs, final_source_sha256: '0'.repeat(64)} : mode === 'invalid-role' && name === 'read_file' ? {...originalArgs, role: 1} : mode === 'too-many-paths' && name === 'finish' ? { ...originalArgs, path_count: 5 } : originalArgs;
          decisions++;
          const output = mode === 'refusal'
            ? [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'cannot proceed' }] }]
            : [{ type: 'function_call', status: 'completed', call_id: `repair-${decisions}`, name, arguments: JSON.stringify(args) }];
          encoded = normalizeOpenAIResponses(new TextEncoder().encode(JSON.stringify({ status: 'completed', error: null, output })), invocation.normalizationLimits, invocation.tools);
          break;
        }
        case 'repository.repair.list.v1': reply = [[[request[0], 0]], false]; break;
        case 'repository.repair.read.v1': {
          const current = await files.read({ path: payload[1] });
          assert.equal(current.kind, 'success');
          reply = [payload[0], payload[0], payload[1], current.observation.digest, current.observation.content];
          break;
        }
        case 'repository.repair.test.v1': {
          tests++;
          const passed = tests > 1 && mode !== 'failed-retest';
          reply = [passed ? 0 : 1, passed, passed ? 'passed' : 'failed', '', false, false];
          break;
        }
        case 'repository.repair.current.v1': reply = await delivery.read(payload); break;
        case 'agent.approval.issue.v1.repository.repair.replace': reply = 37n; break;
        case 'agent.interaction.exchange.v1.repository.repair.replace':
          reply = { tag: 0, value: [payload[3], 7n, mode === 'denied'
            ? { tag: 1, value: 'owner declined' } : { tag: 0, value: null }] };
          break;
        case 'repository.repair.replace.v1': writes++; reply = await delivery.replace(payload); break;
        default: throw new Error(`unexpected application effect ${pending.semanticIdentity}`);
      }
      encoded ??= encodeValue(decodeSchema(pending.resumeSchema), reply);
      input = { image: application, state: outcome.state, control: 'reply',
        value: await world.encodeResult(outcome.request, encoded) };
    }
    throw new Error('repair loop did not terminate');
  } finally { await rm(root, { recursive: true, force: true }); }
}
const { retained: repairedRetention, ...repaired } = await repair('approved');
assert.deepEqual(repaired, { kind: 'completed', value: [finish.summary, [request[0]], true, hash(corrected)],
  content: corrected, decisions: 6, tests: 2, writes: 1 });
for (const mode of ['early-finish', 'denied', 'failed-retest', 'budget', 'refusal', 'too-many-paths', 'invalid-role', 'max-documents', 'wrong-final-path', 'wrong-final-digest']) {
  const actual = await repair(mode);
  assert.equal(actual.kind, 'failed', mode);
  assert.equal(actual.value, mode === 'budget' ? 0 : ['refusal', 'invalid-role'].includes(mode) ? 3 : 5, mode);
  assert.equal(actual.writes, ['failed-retest', 'too-many-paths', 'wrong-final-path', 'wrong-final-digest'].includes(mode) ? 1 : 0, mode);
}
const repeated = await repair('repeat');
assert.equal(repeated.kind, 'failed');
assert.equal(repeated.value, 0);
assert.equal(repeated.decisions, 32);
assert(Math.max(...repeated.retained) < 512 * 1024);
assert(Math.max(...repeated.retained) <= repeated.retained[0] + 4096);
for (const mode of ['multiple', 'fifth-file', 'repeat-write', 'duplicate-final', 'omitted-final']) {
  const actual = await repair(mode);
  const valid = ['multiple', 'repeat-write'].includes(mode);
  assert.equal(actual.kind, valid ? 'completed' : 'failed', mode);
  assert.equal(actual.writes, mode === 'repeat-write' ? 5 : 4, mode);
  if (valid) assert.deepEqual(actual.value[1], [3,2,1,0].map(i => 'src/file'+i+'.mjs'));
  else assert.equal(actual.value, mode === 'fifth-file' ? 4 : 5, mode);
}
console.log('repository application: 17 model/action cases passed; real reads/writes, synthetic test results; repeated peak=' + Math.max(...repeated.retained));
