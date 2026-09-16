// Narrow experiment adapter. It executes input traces and mandatory checks;
// investigation choice, evidence sharing and hypothesis policy live in BPI2.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createInquirySandbox } from "./inquiry_sandbox.mjs";

export const acceptanceContract = "agent.session-occurrence.acceptance.v1";
export const editablePath = "session.mjs";
export const sourceDigest = source => createHash("sha256").update(source).digest("hex");
const utf8 = (value, maximum) => typeof value === "string" && value.isWellFormed() &&
  Buffer.byteLength(value) <= maximum;
const integer = (value, maximum) => {
  if (typeof value === "bigint" && value >= 0n && value <= BigInt(maximum)) return Number(value);
  if (Number.isSafeInteger(value) && value >= 0 && value <= maximum) return value;
  throw new TypeError("invalid trace integer");
};
function record(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("expected record");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== fields.length || keys.some(k => !fields.includes(k)) ||
      fields.some(k => !Object.hasOwn(descriptors, k) || !("value" in descriptors[k])))
    throw new TypeError(`expected fields: ${fields.join(",")}`);
  return Object.fromEntries(fields.map(k => [k, descriptors[k].value]));
}

/** Model-selected sequencing and arguments; references name earlier outputs. */
export function admitTrace(input) {
  const { mode, steps } = record(input, ["mode", "steps"]);
  const selectedMode = integer(mode, 1);
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 24)
    throw new TypeError("trace requires 1..24 steps");
  const admitted = [];
  for (let index = 0; index < steps.length; index++) {
    const { tag, value } = record(steps[index], ["tag", "value"]);
    const kind = integer(tag, 5);
    let args;
    if (kind === 0) {
      if (!Array.isArray(value) || value.length !== 3 || !utf8(value[0], 64) ||
          !Array.isArray(value[1]) || value[1].length < 1 || value[1].length > 4 || !utf8(value[2], 32))
        throw new TypeError("invalid issue arguments");
      args = [value[0], value[1].map(x => integer(x, 255)), value[2]];
    } else if (kind === 1) {
      if (!Array.isArray(value) || value.length !== 2) throw new TypeError("invalid encode arguments");
      const ref = integer(value[0], 23), choice = integer(value[1], 255);
      if (ref >= index || admitted[ref]?.tag !== 0) throw new TypeError("invalid request reference");
      args = [ref, choice];
    } else if (kind === 2) {
      args = integer(value, 23);
      if (args >= index || admitted[args]?.tag !== 1) throw new TypeError("invalid encoded reply reference");
    } else {
      if (value !== null) throw new TypeError("unit operation requires null");
      args = null;
    }
    admitted.push({ tag: kind, value: args });
  }
  return { mode: selectedMode, steps: admitted };
}

function admitRows(rows, trace) {
  if (!Array.isArray(rows) || rows.length !== trace.steps.length) return false;
  return rows.every((row, index) => Array.isArray(row) && row.length === 8 &&
    row[0] === trace.steps[index].tag && [row[1], row[3], row[4], row[6]].every(x =>
      Number.isSafeInteger(x) && x >= 0 && x <= 4294967295) &&
    typeof row[2] === "boolean" && typeof row[5] === "boolean" && utf8(row[7], 128));
}

const op = (tag, value = null) => ({ tag, value });
const issue = (text, choices, label = "same-label") => op(0, [text, choices, label]);
const encode = (ref, choice) => op(1, [ref, choice]);
const submit = ref => op(2, ref);

// Requirements, not a preferred patch, determine these independently authored
// traces. The candidate cannot modify this evaluator or supply expected rows.
export function mandatoryTraces() {
  const cases = [
    ["current-and-duplicate", [issue("alpha", [3, 9]), encode(0, 9), submit(1), submit(1),
      issue("beta", [2, 7]), encode(4, 2), submit(5)]],
    ["identical-occurrences", [issue("same", [1, 4]), encode(0, 1), submit(1),
      issue("same", [1, 4]), submit(1), encode(3, 4), submit(5)]],
    ["abort-retains-progression", [issue("again", [5, 8]), encode(0, 5), op(3),
      issue("again", [5, 8]), submit(1), encode(3, 8), submit(5)]],
    ["different-question-same-label", [issue("left", [6, 7]), encode(0, 6),
      issue("right", [6, 7]), submit(1), encode(2, 7), submit(4)]],
    ["display-is-not-authority", [issue("same", [2, 3], "old"), encode(0, 2), submit(1),
      issue("same", [2, 3], "new"), submit(1), encode(3, 3), submit(5)]],
    ["unoffered-choice-no-mutation", [issue("pick", [10, 20]), encode(0, 255), submit(1),
      op(5), encode(0, 20), submit(4)]],
    ["close-is-final", [issue("close", [1]), encode(0, 1), op(4), submit(1),
      issue("closed", [1]), op(3), op(5)]],
  ];
  const repeated = [];
  for (let i = 0; i < 6; i++) {
    const start = repeated.length;
    repeated.push(issue("repeated values", [11, 13]), encode(start, i % 2 ? 13 : 11), submit(start + 1));
  }
  repeated.push(issue("repeated values", [11, 13]), submit(1), encode(18, 13), submit(20));
  cases.push(["longer-progression", repeated]);
  return cases.flatMap(([name, steps]) => [0, 1].map(mode => ({ name, trace: admitTrace({ mode, steps }) })));
}

/** Expected session transitions use symbolic request references, never a
 * candidate's possibly-colliding occurrence as the authority for acceptance. */
export function evaluateObservations(trace, rows) {
  if (!admitRows(rows, trace)) return ["incomplete_observations"];
  const failures = new Set(), requests = [], replies = [];
  let current = null, issued = 0, accepted = 0, closed = false;
  const occurrences = new Set();
  for (let i = 0; i < trace.steps.length; i++) {
    const step = trace.steps[i], row = rows[i];
    let accepts = false, label = "";
    if (step.tag === 0) {
      if (closed) {
        if (row[1] !== 0) failures.add("issue_after_close");
      } else {
        issued++;
        if (row[1] === 0 || occurrences.has(row[1])) failures.add("occurrence_progression");
        occurrences.add(row[1]);
        requests[i] = { occurrence: row[1], choices: step.value[1] };
        current = i;
        label = `${trace.mode === 0 ? "run" : "advance"}:${step.value[2]}`;
      }
    } else if (step.tag === 1) {
      replies[i] = { request: step.value[0], choice: step.value[1] };
    } else if (step.tag === 2) {
      const reply = replies[step.value];
      accepts = !closed && current !== null && reply?.request === current &&
        requests[current].choices.includes(reply.choice);
      if (accepts) { accepted++; current = null; }
      else if (i > 0 && JSON.stringify(row.slice(3, 7)) !== JSON.stringify(rows[i - 1].slice(3, 7)))
        failures.add("rejected_reply_mutated_state");
    } else if (step.tag === 3) current = null;
    else if (step.tag === 4) { closed = true; current = null; }
    if (row[2] !== accepts) failures.add(accepts ? "current_reply_rejected" : "foreign_reply_accepted");
    if (row[3] !== issued || row[4] !== accepted || row[5] !== closed ||
        row[6] !== (current === null ? 0 : requests[current].occurrence)) failures.add("session_state");
    if (row[7] !== label) failures.add("mode_or_presentation");
  }
  return [...failures];
}

export async function createInquiryExecutor(options = {}) {
  const sandbox = await createInquirySandbox(options);
  if (sandbox.kind !== "qualified") return sandbox;
  const evaluatorSha256 = sourceDigest(await readFile(new URL(import.meta.url)));
  const expectedRunner = sourceDigest(JSON.stringify({ sandbox: sandbox.runner,
    evaluatorSha256, acceptanceContract }));
  let logicalRequests = 0, physicalExecutions = 0;
  const admitInput = input => {
    const { path, source, runner } = record(input, ["path", "source", "runner"]);
    if (path !== editablePath || !utf8(source, 8192) || !source.length || runner !== expectedRunner)
      throw new TypeError("subject, scope, source or runner mismatch");
    return { path, source, runner };
  };
  const runner = expectedRunner;
  async function execute(input, trace, signal) {
    const result = await sandbox.execute(input.source, trace, { signal });
    physicalExecutions += result.physicalExecutions ?? 0;
    if (result.kind !== "completed") return { ...result, runner };
    if (!admitRows(result.rows, trace)) return { kind: "incomplete_output", runner };
    return { ...result, runner };
  }
  return Object.freeze({ kind: "qualified", runner,
    contract: { ...sandbox.contract, evaluatorSha256, acceptanceContract }, qualification: sandbox.qualification,
    async probe(input, suppliedTrace, { signal } = {}) {
      const subject = admitInput(input), trace = admitTrace(suppliedTrace);
      logicalRequests++;
      return { ...await execute(subject, trace, signal), sourceDigest: sourceDigest(subject.source) };
    },
    async validate(input, requiredContract = acceptanceContract, { signal } = {}) {
      const candidate = admitInput(input);
      if (requiredContract !== acceptanceContract) throw new TypeError("unsupported acceptance contract");
      logicalRequests++;
      const checks = [];
      for (const { name, trace } of mandatoryTraces()) {
        const result = await execute(candidate, trace, signal);
        if (result.kind !== "completed") return { kind: result.kind, passed: false,
          sourceDigest: sourceDigest(candidate.source), runner,
          acceptanceContract, checks };
        const failures = evaluateObservations(trace, result.rows);
        checks.push({ name, mode: trace.mode, passed: failures.length === 0, failures });
      }
      return { kind: "completed", passed: checks.every(x => x.passed),
        sourceDigest: sourceDigest(candidate.source), runner, acceptanceContract, checks };
    },
    metrics: () => ({ logicalRequests, physicalExecutions,
      qualificationExecutions: sandbox.qualificationExecutions }),
  });
}
