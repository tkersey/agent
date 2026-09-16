// Deterministic provider/evaluator fixtures only. Production execution does not
// import this module or compare candidate bytes with a reference repair.
import { readFile } from "node:fs/promises";

export const reset = await readFile(new URL("./session.mjs", import.meta.url), "utf8");
const resetLine = "  if (task === session.lastTask) session.next = 1;\n";
if (!reset.includes(resetLine)) throw new Error("fixture changed");
export const monotonic = reset.replace(resetLine, "");
export const rebinding = monotonic.replace(
  "  if (session.closed || session.current === null || reply === null ||",
  "  if (reply && session.current) reply.occurrence = session.current.occurrence;\n" +
  "  if (session.closed || session.current === null || reply === null ||");

// A separate construction: issued tickets are retained, and occurrence numbers
// derive from that history. There is no resettable `next` or task-key cache.
export const tickets = `export function createSession(mode = 0) {
  if (mode !== 0 && mode !== 1) throw new TypeError('unsupported mode');
  return { mode, tickets: [], accepted: 0, current: null, closed: false };
}
export function issue(session, text, choices, label = 'question') {
  if (session.closed) return null;
  if (typeof text !== 'string' || !Array.isArray(choices) || !choices.length ||
      choices.some(x => !Number.isSafeInteger(x) || x < 0)) throw new TypeError('invalid question');
  const occurrence = session.tickets.length + 1;
  session.tickets.push({ occurrence });
  const current = { occurrence, text, choices: [...choices],
    label: (session.mode === 0 ? 'run:' : 'advance:') + label,
    providerCallId: 'provider-repeated-id' };
  session.current = current;
  return { ...current, choices: [...current.choices] };
}
export function encodeReply(request, choice) {
  return JSON.stringify({ occurrence: request.occurrence, choice });
}
export function submitEncoded(session, encoded) {
  let answer; try { answer = JSON.parse(encoded); } catch { return false; }
  const current = session.current;
  if (session.closed || current === null || answer === null ||
      typeof answer !== 'object' || answer.occurrence !== current.occurrence ||
      !current.choices.includes(answer.choice)) return false;
  session.current = null; session.accepted += 1; return true;
}
export function inspect(session) {
  return { issued: session.tickets.length, accepted: session.accepted,
    closed: session.closed, current: session.current === null ? 0 : session.current.occurrence };
}
export function abort(session) { session.current = null; }
export function close(session) { session.current = null; session.closed = true; }
`;

function replaceSubmit(body) {
  const a = monotonic.indexOf("export function submitEncoded("), z = monotonic.indexOf("export function inspect(");
  return monotonic.slice(0, a) + `export function submitEncoded(session, encoded) { ${body} }\n` + monotonic.slice(z);
}
export const bad = {
  acceptAll: replaceSubmit("session.accepted++; session.current = null; return true;"),
  rejectAll: replaceSubmit("return false;"),
  resetAll: replaceSubmit("session.issued = 0; session.accepted = 0; session.current = null; return true;"),
  labelOnly: reset.replace('provider-repeated-id', 'changed-display'),
  closedZeroObject: monotonic.replace('if (session.closed) return null;', 'if (session.closed) return { occurrence: 0, label: "" };'),
  closedNonzeroObject: monotonic.replace('if (session.closed) return null;', 'if (session.closed) return { occurrence: 9, label: "" };'),
  forgedVerdict: "console.log('PASS'); export const passed = true;",
  earlyExit: "process.exit(0);",
  tamperedJSON: "JSON.stringify = () => '{\"passed\":true}';\n" + monotonic,
  infinite: "export function createSession() { while (true) {} }",
};
