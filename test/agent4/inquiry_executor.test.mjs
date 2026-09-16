import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { createInquiryExecutor, admitTrace, mandatoryTraces, acceptanceContract,
  sourceDigest } from "../../runtime/inquiry.mjs";
import { reset, monotonic, tickets, rebinding, bad } from "../consumers/inquiry/fixtures/cases.mjs";

const output = resolve(".agent4/out");
await mkdir(output, { recursive: true });
const scratchRoot = await mkdtemp(join(output, "inquiry executor space "));
try {
  const environment = await createInquiryExecutor({ scratchRoot: relative(process.cwd(), scratchRoot) });
  assert.equal(environment.kind, "qualified", JSON.stringify(environment));
  assert(Object.values(environment.qualification).every(x => x === true));
  const subject = source => ({ path: "session.mjs", source, runner: environment.runner });
  const results = [];
  for (const [name, source, expected] of [
    ["reset-occurrence", reset, false], ["adapter-rebinding", rebinding, false],
    ["monotonic-repair", monotonic, true], ["ticket-history-repair", tickets, true],
    ...Object.entries(bad).filter(([name]) => name !== "infinite").map(([name, source]) => [name, source, false]),
  ]) {
    const result = await environment.validate(subject(source));
    assert.equal(result.passed, expected, `${name}: ${JSON.stringify(result)}`);
    assert.equal(result.sourceDigest, sourceDigest(source));
    assert.equal(result.runner, environment.runner);
    assert.equal(result.acceptanceContract, acceptanceContract);
    if (expected) {
      assert.equal(result.kind, "completed");
      assert.equal(result.checks.length, 16);
      assert(result.checks.every(check => check.passed));
    }
    results.push({ name, kind: result.kind, passed: result.passed,
      checks: result.checks.length, failures: [...new Set(result.checks.flatMap(x => x.failures))] });
  }
  const trace = mandatoryTraces().find(x => x.name === "identical-occurrences" && x.trace.mode === 0).trace;
  const before = environment.metrics();
  for (const path of ["../session.mjs", "/tmp/session.mjs", "nested/session.mjs", "session.mjs/../other"]) {
    await assert.rejects(environment.probe({ ...subject(monotonic), path }, trace), TypeError);
  }
  await assert.rejects(environment.probe({ ...subject(monotonic), runner: "wrong" }, trace), TypeError);
  await assert.rejects(environment.validate(subject(monotonic), "unprescribed"), TypeError);
  assert.throws(() => admitTrace({ mode: 0, steps: [{ tag: 2, value: 0 }] }), TypeError);
  assert.throws(() => admitTrace({ mode: 0, steps: [{ tag: 6, value: null }] }), TypeError);
  assert.throws(() => admitTrace({ mode: 2, steps: trace.steps }), TypeError);
  assert.deepEqual(environment.metrics(), before, "invalid requests do not launch code");
  const original = await environment.probe(subject(reset), trace);
  const repaired = await environment.probe(subject(monotonic), trace);
  assert.equal(original.kind, "completed"); assert.equal(repaired.kind, "completed");
  assert.equal(original.rows[4][2], true, "real pre-fix subject accepts an old encoded reply");
  assert.equal(repaired.rows[4][2], false, "repaired subject rejects the unchanged encoded reply");
  assert.deepEqual(repaired.rows[4].slice(3, 7), repaired.rows[3].slice(3, 7));
  const timedOut = await environment.probe(subject(bad.infinite), trace);
  assert.equal(timedOut.kind, "timeout");
  const excessive = await environment.probe(subject("throw new Error('x'.repeat(200000));"), trace);
  // Node truncates exception rendering. The profile qualification separately
  // floods an actual pipe, proving the output cap rather than assuming its size.
  assert.equal(excessive.kind, "execution_failed");
  assert(excessive.outputBytes <= environment.contract.maximumOutputBytes);
  const abort = new AbortController();
  const pending = environment.probe(subject(bad.infinite), trace, { signal: abort.signal });
  setTimeout(() => abort.abort(), 100);
  assert.equal((await pending).kind, "cancelled");
  const alreadyAborted = new AbortController(); alreadyAborted.abort();
  const physicalBefore = environment.metrics().physicalExecutions;
  assert.equal((await environment.probe(subject(monotonic), trace,
    { signal: alreadyAborted.signal })).kind, "cancelled");
  assert.equal(environment.metrics().physicalExecutions, physicalBefore);
  assert.equal((await createInquiryExecutor({ scratchRoot: join(scratchRoot, "missing") })).kind, "unavailable");
  console.log(JSON.stringify({ runner: environment.runner, contract: environment.contract,
    qualification: environment.qualification, metrics: environment.metrics(), results }));
} finally { await rm(scratchRoot, { recursive: true, force: true }); }
