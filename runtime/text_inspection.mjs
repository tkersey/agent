// Portable leaf binding for the immutable-subject text tool. No continuation policy.
import { decodeSchema, decodeValue, encodeSchema, encodeValue } from "./values.mjs";

export const READ = "agent.text.read-chunk.v1", CLOSE = "agent.text.close.v1";
const types = [
  { bounded_text: 64 }, "u8", { array: { element: 1, length: 32 } }, "u64", "unit", "boolean",
  { product: [0, 2, 3] }, { product: [6, 3, 3] }, { bounded_bytes: 16 },
  { product: [2, 3, 8, 5] }, { sum: [9, 4, 4, 4] },
];
export const subjectSchema = { root: 6, types };
const readSchema = { root: 7, types }, replySchema = { root: 10, types }, unitSchema = { root: 4, types };
const wire = new Map([
  [READ, [encodeSchema(readSchema), encodeSchema(replySchema)]],
  [CLOSE, [encodeSchema(subjectSchema), encodeSchema(unitSchema)]],
]);
const same = (left, right) => left.length === right.length && left.every((value, i) => value === right[i]);
const error = (code, message) => Object.assign(new Error(message), { code });
const tagged = (tag, value = null) => ({ tag, value });

export async function subject(name, input) {
  const bytes = Uint8Array.from(input);
  if (bytes.length > 65536) throw error("TEXT_SUBJECT_TOO_LARGE", "Subject exceeds the compiled tool bound");
  return [name, [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))], BigInt(bytes.length)];
}

/** read returns the current complete UTF-8 bytes, or null when unavailable.
 * It belongs to the environment. Request offsets and all folding stay guest-owned. */
export function bindSubject(declared, read) {
  const expected = decodeValue(decodeSchema(encodeSchema(subjectSchema)), encodeValue(subjectSchema, declared));
  let releases = 0;
  const reads = [];
  return Object.freeze({
    counts: () => ({ releases, reads: [...reads] }),
    async handle(request) {
      const schemas = wire.get(request.semanticIdentity);
      if (!schemas) throw error("TEXT_OPERATION_MISSING", `Missing text operation: ${request.semanticIdentity}`);
      if (!same(request.payloadSchema, schemas[0]) || !same(request.resumeSchema, schemas[1]))
        throw error("TEXT_SCHEMA_MISMATCH", `Incompatible text contract: ${request.semanticIdentity}`);
      const payload = decodeValue(decodeSchema(request.payloadSchema), request.payload);
      const selected = request.semanticIdentity === READ ? payload[0] : payload;
      if (selected[0] !== expected[0]) throw error("TEXT_SUBJECT_MISSING", `Missing subject binding: ${selected[0]}`);
      const matches = selected[2] === expected[2] && same(selected[1], expected[1]);
      if (request.semanticIdentity === CLOSE) {
        if (!matches) throw error("TEXT_SUBJECT_MISMATCH", `Wrong subject version: ${selected[0]}`);
        releases++;
        return encodeValue(unitSchema, null);
      }
      if (!matches) return encodeValue(replySchema, tagged(2));
      if (typeof read !== "function") throw error("TEXT_OPERATION_MISSING", `Missing text operation: ${READ} for ${selected[0]}`);
      const offset = payload[1], maximum = payload[2];
      if (maximum < 1n || maximum > 16n || offset > expected[2])
        throw error("TEXT_READ_INVALID", "Read offset or chunk bound violates the text contract");
      const loaded = await read();
      if (loaded === null) return encodeValue(replySchema, tagged(1));
      const bytes = Uint8Array.from(loaded);
      try { new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { return encodeValue(replySchema, tagged(1)); }
      const version = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))];
      if (BigInt(bytes.length) !== expected[2] || !same(version, expected[1]))
        return encodeValue(replySchema, tagged(2));
      const end = Math.min(bytes.length, Number(offset + maximum));
      const chunk = bytes.slice(Number(offset), end);
      reads.push(offset);
      return encodeValue(replySchema, tagged(0, [version, offset, chunk, end === bytes.length]));
    },
  });
}

export function memoryBinding(declared, input) {
  const bytes = Uint8Array.from(input);
  return bindSubject(declared, async () => bytes);
}
