// Copied into a read-only input directory and executed inside the OS sandbox.
// It returns observations only. All mandatory expectations and verdicts are in
// the parent tool, outside this process and outside the candidate's realm.
import { readFile } from "node:fs/promises";
import { createContext, Script, SourceTextModule } from "node:vm";

const source = await readFile(new URL("./session.mjs", import.meta.url), "utf8");
const { nonce, trace } = JSON.parse(await readFile(new URL("./trace.json", import.meta.url), "utf8"));
const context = createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
const invoke = new Script(`(() => {
  const parse = JSON.parse, stringify = JSON.stringify, apply = Reflect.apply;
  const setPrototypeOf = Object.setPrototypeOf, isArray = Array.isArray;
  const isInteger = Number.isSafeInteger;
  const array = () => setPrototypeOf([], null);
  const number = x => { if (!isInteger(x) || x < 0 || x > 4294967295) throw null; return x; };
  const boolean = x => { if (typeof x !== 'boolean') throw null; return x; };
  return (api, encoded) => {
    const trace = parse(encoded), rows = array(), requests = array(), replies = array();
    const session = apply(api.createSession, undefined, [trace.mode]);
    for (let i = 0; i < trace.steps.length; i++) {
      const op = trace.steps[i]; let occurrence = 0, accepted = false, label = '';
      if (op.tag === 0) {
        const choices = [];
        for (let j = 0; j < op.value[1].length; j++) choices[j] = op.value[1][j];
        const request = apply(api.issue, undefined, [session, op.value[0], choices, op.value[2]]);
        requests[i] = request;
        // Absence is an API observation, not the numeric identity zero.
        occurrence = request === null ? null : number(request.occurrence);
        if (request !== null) {
          if (typeof request.label !== 'string' || request.label.length > 128) throw null;
          label = request.label;
        }
      } else if (op.tag === 1) {
        const request = requests[op.value[0]];
        if (request === undefined || request === null) throw null;
        const reply = apply(api.encodeReply, undefined, [request, op.value[1]]);
        if (typeof reply !== 'string' || reply.length > 1024) throw null;
        replies[i] = reply;
      } else if (op.tag === 2) {
        const reply = replies[op.value];
        if (typeof reply !== 'string') throw null;
        // Preserve the original encoded reply. Never rebuild it for the current request.
        accepted = boolean(apply(api.submitEncoded, undefined, [session, reply]));
      } else if (op.tag === 3) {
        apply(api.abort, undefined, [session]);
      } else if (op.tag === 4) {
        apply(api.close, undefined, [session]);
      } else if (op.tag !== 5) throw null;
      const state = apply(api.inspect, undefined, [session]);
      const row = array();
      row[0] = number(op.tag); row[1] = occurrence; row[2] = accepted;
      row[3] = number(state.issued); row[4] = number(state.accepted);
      row[5] = boolean(state.closed); row[6] = number(state.current);
      row[7] = label;
      rows[i] = row;
    }
    if (!isArray(rows)) throw null;
    return stringify(rows);
  };
})()`).runInContext(context);
const module = new SourceTextModule(source, { context,
  identifier: "inquiry:session.mjs", importModuleDynamically() { throw null; } });
await module.link(() => { throw null; });
await module.evaluate({ timeout: 1000 });
const encoded = invoke(module.namespace, JSON.stringify(trace));
if (typeof encoded !== "string" || Buffer.byteLength(encoded) > 32768) throw new Error("invalid observations");
// Candidate objects never enter the parent process. Even here, only a primitive
// string is accepted from the candidate realm before bounded JSON decoding.
process.stdout.write(JSON.stringify({ nonce, kind: "observations", rows: JSON.parse(encoded) }));
