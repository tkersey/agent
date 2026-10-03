// Restricted RFC 8785 profile: Unicode strings, safe integer numbers, booleans,
// null, arrays and plain records. Counters are decimal strings, never floats.
const utf8 = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
export const CONTROL_LIMIT = 64 * 1024;
export function reject(code) { throw Object.assign(new Error(code), { code }); }
export function requireThat(condition, code) { if (!condition) reject(code); }
function string(value) {
  requireThat(value.isWellFormed(), 'InvalidUnicode');
  return JSON.stringify(value);
}
export function canonical(value, maximum = CONTROL_LIMIT) {
  let nodes = 0;
  function encode(item, depth) {
    requireThat(++nodes <= 8192 && depth <= 32, 'ControlCapacity');
    if (item === null || typeof item === 'boolean') return String(item);
    if (typeof item === 'string') return string(item);
    if (typeof item === 'number') {
      requireThat(Number.isSafeInteger(item) && !Object.is(item, -0), 'InvalidInteger');
      return String(item);
    }
    requireThat(item !== null && typeof item === 'object', 'InvalidRecord');
    if (Array.isArray(item)) {
      requireThat(item.length <= 8192 && Reflect.ownKeys(item).length === item.length + 1, 'InvalidArray');
      const values = [];
      for (let i = 0; i < item.length; i++) {
        const property = Object.getOwnPropertyDescriptor(item, String(i));
        requireThat(property?.enumerable && Object.hasOwn(property, 'value'), 'InvalidArray');
        values.push(encode(property.value, depth + 1));
      }
      return `[${values.join(',')}]`;
    }
    requireThat([Object.prototype, null].includes(Object.getPrototypeOf(item)), 'InvalidRecord');
    const keys = Reflect.ownKeys(item);
    requireThat(keys.every(key => typeof key === 'string'), 'InvalidRecord');
    return `{${keys.sort().map(key => {
      const property = Object.getOwnPropertyDescriptor(item, key);
      requireThat(property.enumerable && Object.hasOwn(property, 'value'), 'InvalidRecord');
      return `${string(key)}:${encode(property.value, depth + 1)}`;
    }).join(',')}}`;
  }
  const bytes = utf8.encode(encode(value, 0));
  requireThat(bytes.length <= maximum, 'ControlCapacity');
  return bytes;
}

/** Reject duplicate decoded keys before constructing a record. Bounds apply
 * before parse/recursion; no object prototypes or accessors come from the wire. */
export function parse(bytes, { maximum = CONTROL_LIMIT, canonicalOnly = true } = {}) {
  requireThat(bytes instanceof Uint8Array && bytes.length <= maximum, 'ControlCapacity');
  const input = decoder.decode(bytes);
  let at = 0, nodes = 0;
  const whitespace = () => { while (at < input.length && /[\x20\t\r\n]/.test(input[at])) at++; };
  function text() {
    requireThat(input[at] === '"', 'InvalidJson');
    const start = at++;
    while (at < input.length) {
      const char = input[at++];
      if (char === '\\') { at++; continue; }
      if (char === '"') {
        const result = JSON.parse(input.slice(start, at));
        requireThat(result.isWellFormed(), 'InvalidUnicode'); return result;
      }
    }
    reject('InvalidJson');
  }
  function value(depth) {
    requireThat(++nodes <= 8192 && depth <= 32, 'ControlCapacity'); whitespace();
    const token = input[at];
    if (token === '"') return text();
    if (token === '{') {
      at++; whitespace(); const result = Object.create(null);
      if (input[at] === '}') { at++; return result; }
      for (;;) {
        whitespace(); const key = text(); whitespace();
        requireThat(!Object.hasOwn(result, key), 'DuplicateKey');
        requireThat(input[at++] === ':', 'InvalidJson'); result[key] = value(depth + 1); whitespace();
        const delimiter = input[at++]; if (delimiter === '}') return result;
        requireThat(delimiter === ',', 'InvalidJson');
      }
    }
    if (token === '[') {
      at++; whitespace(); const result = [];
      if (input[at] === ']') { at++; return result; }
      for (;;) {
        result.push(value(depth + 1)); whitespace();
        const delimiter = input[at++]; if (delimiter === ']') return result;
        requireThat(delimiter === ',', 'InvalidJson');
      }
    }
    const literal = /^(?:null|true|false|-?(?:0|[1-9][0-9]*))/.exec(input.slice(at));
    requireThat(literal !== null, 'InvalidJson'); at += literal[0].length;
    const result = JSON.parse(literal[0]);
    if (typeof result === 'number') requireThat(Number.isSafeInteger(result) && !Object.is(result, -0), 'InvalidInteger');
    return result;
  }
  const result = value(0); whitespace(); requireThat(at === input.length, 'InvalidJson');
  if (canonicalOnly) {
    const encoded = canonical(result, maximum);
    requireThat(encoded.length === bytes.length && encoded.every((byte, i) => byte === bytes[i]), 'NonCanonical');
  }
  return result;
}
export function closed(record, fields) {
  requireThat(record !== null && typeof record === 'object' && !Array.isArray(record), 'InvalidRecord');
  const keys = Object.keys(record);
  requireThat(keys.length === fields.length && keys.every(key => fields.includes(key)), 'RecordFields');
}
export function identifier(value, maximum = 128) {
  requireThat(typeof value === 'string' && value.length > 0 && value.isWellFormed() && !value.includes('\0') && utf8.encode(value).length <= maximum, 'InvalidIdentifier');
  return value;
}
export function counter(value) {
  requireThat(typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= 0xffffffffffffffffn, 'InvalidCounter');
  return BigInt(value);
}
export function increment(value) {
  const next = counter(value) + 1n; requireThat(next <= 0xffffffffffffffffn, 'CounterOverflow'); return next.toString();
}
export function digest(value) { requireThat(typeof value === 'string' && /^[0-9a-f]{64}$/.test(value), 'InvalidDigest'); return value; }
export function integer(value, maximum) { requireThat(Number.isSafeInteger(value) && value >= 0 && value <= maximum, 'InvalidInteger'); return value; }
export function labels(value, maximum = 32) {
  requireThat(Array.isArray(value) && value.length <= maximum, 'InvalidLabels');
  let previous = null;
  for (const label of value) { identifier(label); requireThat(previous === null || previous < label, 'InvalidLabels'); previous = label; }
  return value;
}
