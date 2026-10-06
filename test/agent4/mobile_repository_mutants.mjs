// Deliberate test-only mutations of production owners in an isolated source copy.
// A clean selected oracle must pass first; syntax/import errors and timeouts do
// not count as a killed semantic mutant. No mutated file is published or shipped.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '../..'), area = mkdtempSync(join(tmpdir(), 'repository-mutants-'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const cases = [
  { id: 'timeout-refusal', file: 'runtime/mobility/custodian.mjs', count: 2,
    before: "return { kind: 'unknown', reason: error.code ?? 'TransportUnavailable', status: this.status(offer.run_id) };",
    after: "return { kind: 'refused', reason: error.code ?? 'TransportUnavailable', status: this.status(offer.run_id) };",
    test: 'mobility_host.test.mjs', pattern: 'a transport timeout never becomes custody refusal' },
  { id: 'restart-from-initial-args', file: 'runtime/mobility/admission.mjs',
    before: 'session = kernel.restore(prepared, decoded.state);', after: 'session = kernel.start(prepared, new Uint8Array(8));',
    test: 'mobility_host.test.mjs', pattern: 'durable host executes actual', semanticError: 'NonCanonicalParkedOutcome' },
  { id: 'stale-human-occurrence', file: 'runtime/mobility/custody.mjs',
    before: "requireThat(binding.occurrence_id === occurrence.id && binding.request_digest === occurrence.request_digest && binding.pending_digest === occurrence.pending_digest, 'QuestionMismatch');", after: '/* accept retired occurrence */',
    test: 'mobility_model.test.mjs', pattern: 'deferred answer/cancellation order' },
  { id: 'replace-acquired-answer', file: 'runtime/mobility/custody.mjs',
    before: "requireThat(occurrence.answer_digest === answerDigest && occurrence.reply_digest === replyDigest, 'ReplyConflict');\n    return { run, occurrence };",
    after: 'return { run: { ...run, reply_digest: replyDigest }, occurrence: { ...occurrence, answer_digest: answerDigest, reply_digest: replyDigest } };',
    test: 'mobility_model.test.mjs', pattern: 'deferred answer/cancellation order' },
  { id: 'summary-only-proposal', file: 'runtime/repository_snapshot.mjs',
    before: "require(same(proposal, { ...expected, digest: digest(expected) }) &&\n      (await object.read('commit', commitOid)).equals(bytes), 'RepositoryPublicationMismatch');",
    after: "require(proposal.core.commit.message === expected.core.commit.message, 'RepositoryPublicationMismatch');",
    test: 'repository_snapshot.test.mjs', pattern: 'publication proposal binds exact' },
  { id: 'remove-ref-precondition', file: 'runtime/repository_snapshot.mjs',
    before: '${oid(proposal.commitOid, metadata.objectFormat)} ${oid(proposal.core.candidate.snapshot.base, metadata.objectFormat)}',
    after: '${oid(proposal.commitOid, metadata.objectFormat)}',
    test: 'repository_publication_gate.test.mjs', pattern: 'managed objects publish exactly once' },
  { id: 'repeat-lost-publication', file: 'runtime/mobility/custodian.mjs',
    before: 'const result = await selected.binding.reconcile({ payload: selected.payload, request, run, occurrence });',
    after: 'const result = await selected.binding.handle({ payload: selected.payload, request, run, occurrence });',
    test: 'repository_publication_approval.test.mjs', pattern: 'lost publication reply resumes', semanticError: 'FixtureLostReply' },
  { id: 'matching-tree-is-publication', file: 'runtime/repository_snapshot.mjs',
    before: 'if (cursor === proposal.commitOid) found = true;',
    after: 'if (entry.core.candidate.tree === proposal.core.candidate.tree) found = true;',
    test: 'repository_publication_gate.test.mjs', pattern: 'managed objects publish exactly once' },
  { id: 'drop-opaque-replay', file: 'runtime/model.mjs',
    before: 'const history = [...request.input, ...body.output]; replayCalls(history);',
    after: "const history = [...request.input, ...body.output].filter(item => item.type !== 'reasoning'); replayCalls(history);",
    test: 'model.test.mjs', pattern: 'stateless envelope preserves complete items' },
  { id: 'ignore-whole-state-labels', file: 'runtime/mobility/custody.mjs',
    before: 'return [...new Set([...a, ...b])].sort();', after: 'return [...a];',
    test: 'mobility_host.test.mjs', pattern: 'private data taints retained state' },
  { id: 'reset-spent-allowance', file: 'runtime/mobility/journal.mjs',
    before: 'const used = previous?.used ?? { attempts: 0, request_bytes: 0, output_tokens: 0 };',
    after: 'const used = { attempts: 0, request_bytes: 0, output_tokens: 0 };',
    test: 'mobility_journal.test.mjs', pattern: 'durable allowance cannot reset' },
  { id: 'incomplete-check-passes', file: 'runtime/repository_snapshot.mjs',
    before: "record.status === 'Passed' &&", after: "['Passed', 'Incomplete'].includes(record.status) &&",
    test: 'repository_snapshot.test.mjs', pattern: 'publication proposal binds exact' },
];
const counterexamples = {
  'timeout-refusal': ["expected: 'unknown'", "actual: 'refused'"],
  'restart-from-initial-args': ["expected: 'accepted'", "actual: 'unknown'"],
  'stale-human-occurrence': ['Missing expected exception', "code: 'QuestionMismatch'"],
  'replace-acquired-answer': ['Missing expected exception', "code: 'ReplyConflict'"],
  'summary-only-proposal': ['Missing expected rejection', "code: 'RepositoryPublicationMismatch'"],
  'remove-ref-precondition': ['Missing expected rejection', 'repository_publication_gate.test.mjs'],
  'repeat-lost-publication': ["code: 'FixtureLostReply'", 'lost publication reply resumes'],
  'matching-tree-is-publication': ["expected: 'Conflict'", "actual: 'Published'"],
  'drop-opaque-replay': ['encrypted_content', 'opaque-synthetic-continuation'],
  'ignore-whole-state-labels': ["expected: 'terminal'", "actual: 'offered'"],
  'reset-spent-allowance': ['Missing expected exception', "code: 'WorkAllowanceExhausted'"],
  'incomplete-check-passes': ['Missing expected rejection', "code: 'RepositoryPublicationValidation'"],
};
const env = { ...process.env, AGENT4_BUILD_PREFIX: resolve(process.env.AGENT4_BUILD_PREFIX ?? join(root, 'zig-out')) };
for (const name of ['NODE_TEST_CONTEXT', 'AGENT_MOBILE_NATIVE', 'AGENT_MOBILE_PACKAGE', 'AGENT_MOBILITY_BROWSER_TOOLS']) delete env[name];
assert(env.AGENT_MOBILITY_RUNTIME && env.AGENT_PUBLICATION_GATE, 'provide the authenticated runtime and qualified publication gate');
const results = [], passed = new Set();
function run(item) {
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern=' + item.pattern, join('test/agent4', item.test)], { cwd: area, env, encoding: 'utf8', timeout: 120000, maxBuffer: 8 << 20 });
  assert.equal(result.error, undefined, `${item.id}: runner failure does not count as mutation detection`);
  return { status: result.status, output: result.stdout + result.stderr };
}
try {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const file of files) { mkdirSync(dirname(join(area, file)), { recursive: true }); cpSync(join(root, file), join(area, file), { dereference: false }); }
  for (const item of cases) {
    const key = item.test + item.pattern;
    if (!passed.has(key)) {
      const baseline = run(item);
      assert.equal(baseline.status, 0, `${item.id}: clean oracle failed\n${baseline.output}`);
      assert.match(baseline.output, /# pass [1-9]/, `${item.id}: no baseline assertion executed`); passed.add(key);
    }
    const path = join(area, item.file), before = readFileSync(path, 'utf8');
    assert.equal(before.split(item.before).length - 1, item.count ?? 1, `${item.id}: source anchor changed`);
    const mutated = before.replaceAll(item.before, item.after);
    let result;
    try { writeFileSync(path, mutated); result = run(item); }
    finally { writeFileSync(path, before); }
    assert.notEqual(result.status, 0, `${item.id}: mutant survived\n${result.output}`);
    assert(!/SyntaxError|ERR_MODULE_NOT_FOUND|Cannot find module|ENOENT/.test(result.output), `${item.id}: invalid experiment\n${result.output}`);
    assert(result.output.includes('ERR_ASSERTION') || (item.semanticError && result.output.includes(item.semanticError)), `${item.id}: no declared deciding counterexample\n${result.output}`);
    assert(counterexamples[item.id].every(text => result.output.includes(text)), `${item.id}: failure differs from the required counterexample\n${result.output}`);
    const failureAt = result.output.indexOf('not ok');
    const row = { mutant: item.id, owner: item.file, oracle: item.test, pattern: item.pattern, sourceSha256: digest(before), mutantSha256: digest(mutated),
      failureSha256: digest(result.output), counterexample: result.output.slice(failureAt, failureAt + 1800), outcome: 'killed' };
    results.push(row); console.log(JSON.stringify(row));
  }
  console.log(JSON.stringify({ check: 'mobile-repository-mutants', baselineOracles: passed.size, killed: results.length, bounds: 'twelve explicit single-owner mutations; no exhaustive mutant-space claim', results }));
} finally { rmSync(area, { recursive: true, force: true }); }
