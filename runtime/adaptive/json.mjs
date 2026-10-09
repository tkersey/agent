// Lossless provider JSON: raw number spellings are distinct from typed counters.
import assert from 'node:assert/strict';
import {parseJsonStrict, integerFromJsonLexeme} from '../model.mjs';
class NumberToken { constructor(source) { this.source = source; Object.freeze(this); } }
export function parse(bytes, maximum = 512 * 1024) {
  assert(bytes instanceof Uint8Array && bytes.length <= maximum, 'JSON capacity');
  const text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);
  let nodes = 0;
  const value = parseJsonStrict(text, (_key, child, context) => {
    assert(++nodes <= 65536, 'JSON node capacity');
    if (typeof child === 'string') assert(child.isWellFormed(), 'invalid Unicode');
    return typeof child === 'number' ? new NumberToken(context.source) : child;
  });
  // Encoding checks depth, members and finite value shape after duplicate-key
  // admission, without rounding numbers or treating output as authority.
  canonical(value, maximum);
  return value;
}
export function integer(value, maximum = (1n << 64n) - 1n) {
  assert(value instanceof NumberToken, 'expected JSON number');
  const decoded = integerFromJsonLexeme(value.source);
  assert(decoded !== null && decoded >= 0n && decoded <= maximum, 'integer range');
  return decoded;
}
export function canonical(value, maximum = 2 * 1024 * 1024) {
  let nodes = 0;
  function render(item, depth) {
    assert(++nodes <= 65536 && depth <= 32, 'JSON capacity');
    if (item instanceof NumberToken) return item.source;
    if (typeof item === 'bigint') return item.toString();
    if (item === null || typeof item === 'boolean') return String(item);
    if (typeof item === 'number') { assert(Number.isSafeInteger(item)); return String(item); }
    if (typeof item === 'string') { assert(item.isWellFormed()); return JSON.stringify(item); }
    if (Array.isArray(item)) { assert(item.length <= 8192); return `[${item.map(child => render(child, depth + 1)).join(',')}]`; }
    assert(item && typeof item === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(item)));
    const keys = Object.keys(item).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    assert(keys.length <= 8192);
    return `{${keys.map(key => `${JSON.stringify(key)}:${render(item[key], depth + 1)}`).join(',')}}`;
  }
  const bytes = Buffer.from(render(value, 0));
  assert(bytes.length <= maximum, 'JSON byte capacity');
  return bytes;
}
