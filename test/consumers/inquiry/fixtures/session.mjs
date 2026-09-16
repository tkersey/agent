// Original reduced reproduction authored for Agent's inquiry tests (MIT).
// Session state is local to one progressing execution, not rollback protection.
export function createSession(mode = 0) {
  if (mode !== 0 && mode !== 1) throw new TypeError("unsupported mode");
  return { mode, next: 1, issued: 0, accepted: 0, current: null,
    lastTask: null, closed: false };
}

export function issue(session, text, choices, label = "question") {
  if (session.closed) return null;
  if (typeof text !== "string" || !Array.isArray(choices) || choices.length === 0 ||
      choices.some(x => !Number.isSafeInteger(x) || x < 0)) throw new TypeError("invalid question");
  const task = JSON.stringify([text, choices]);
  if (task === session.lastTask) session.next = 1;
  session.lastTask = task;
  session.issued++;
  const occurrence = session.next++;
  const request = { occurrence, text, choices: [...choices],
    label: `${session.mode === 0 ? "run" : "advance"}:${label}`,
    providerCallId: "provider-repeated-id" };
  session.current = request;
  return { ...request, choices: [...request.choices] };
}

export function encodeReply(request, choice) {
  return JSON.stringify({ occurrence: request.occurrence, choice });
}

export function submitEncoded(session, encoded) {
  let reply;
  try { reply = JSON.parse(encoded); } catch { return false; }
  if (session.closed || session.current === null || reply === null ||
      typeof reply !== "object" || reply.occurrence !== session.current.occurrence ||
      !session.current.choices.includes(reply.choice)) return false;
  session.accepted++;
  session.current = null;
  return true;
}

export function inspect(session) {
  return { issued: session.issued, accepted: session.accepted,
    closed: session.closed, current: session.current?.occurrence ?? 0 };
}

export function abort(session) { session.current = null; }
export function close(session) { session.closed = true; session.current = null; }
