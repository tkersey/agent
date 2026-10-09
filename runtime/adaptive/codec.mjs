// Generated named layouts are checked against their authoritative wire schemas.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {decodeSchema, encodeSchema, decodeValue, encodeValue} from '../values.mjs';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const exact = (value, names) => {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...names].sort(), 'closed record');
};

function compile(shape) {
  const types = [];
  function visit(item) {
    const index = types.length;
    types.push(null);
    if (typeof item === 'string') types[index] = item;
    else {
      const keys = Object.keys(item);
      assert.equal(keys.length, 1);
      const kind = keys[0], body = item[kind];
      if (kind === 'text' || kind === 'bytes') types[index] = {[`bounded_${kind}`]: body};
      else if (kind === 'array' || kind === 'vector') types[index] = {[kind]: {element: visit(body[1]), [kind === 'array' ? 'length' : 'maximum']: body[0]}};
      else if (kind === 'optional') types[index] = {sum: [visit('unit'), visit(body)], variants: ['none', 'some']};
      else if (kind === 'record' || kind === 'union') types[index] = {[kind === 'record' ? 'product' : 'sum']: body.map(([, child]) => visit(child)), [kind === 'record' ? 'fields' : 'variants']: body.map(([name]) => name)};
      else if (kind === 'enum') {
        const sorted = [...body].sort((a, b) => a[1] - b[1]);
        types[index] = {enumeration: sorted.map(([, tag]) => tag), names: sorted.map(([name]) => name)};
      } else throw new Error(`unsupported generated shape ${kind}`);
    }
    return index;
  }
  return {root: visit(shape), types};
}
function convert(shape, value, toWire) {
  if (typeof shape === 'string') return value;
  const kind = Object.keys(shape)[0], body = shape[kind];
  if (kind === 'text' || kind === 'bytes') return value;
  if (kind === 'array' || kind === 'vector') {
    assert(Array.isArray(value));
    return value.map(child => convert(body[1], child, toWire));
  }
  if (kind === 'record') {
    exact(value, body.map(([name]) => name));
    return Object.fromEntries(body.map(([name, child]) => [name, convert(child, value[name], toWire)]));
  }
  if (kind === 'optional') {
    const tagged = body === 'unit' || (body && typeof body === 'object' && Object.hasOwn(body, 'optional'));
    if (toWire) {
      if (value === null) return {tag: 0, value: null};
      if (tagged) { exact(value, ['tag', 'value']); assert.equal(value.tag, 'some'); }
      return {tag: 1, value: convert(body, tagged ? value.value : value, true)};
    }
    if (value.tag === 0) return null;
    const child = convert(body, value.value, false);
    return tagged ? {tag: 'some', value: child} : child;
  }
  if (kind === 'enum') {
    const member = body.find(([name, tag]) => toWire ? name === value : tag === value);
    assert(member, `invalid enumeration ${value}`);
    return member[toWire ? 1 : 0];
  }
  if (kind === 'union') {
    exact(value, ['tag', 'value']);
    const ordinal = toWire ? body.findIndex(([name]) => name === value.tag) : value.tag;
    assert(Number.isInteger(ordinal) && ordinal >= 0 && ordinal < body.length);
    return {tag: toWire ? ordinal : body[ordinal][0], value: convert(body[ordinal][1], value.value, toWire)};
  }
  throw new Error('unsupported generated shape');
}

export function codecs(application) {
  assert(application?.support && typeof application.support === 'object', 'adaptive schema support missing');
  const entries = new Map();
  for (const [name, source] of Object.entries(application.support)) {
    exact(source, ['wire_sha256', 'wire_base64url', 'shape']);
    const wire = Buffer.from(source.wire_base64url, 'base64url');
    assert.equal(wire.toString('base64url'), source.wire_base64url);
    assert.equal(hash(wire), source.wire_sha256);
    decodeSchema(wire);
    const descriptor = compile(source.shape);
    assert.deepEqual(Buffer.from(encodeSchema(descriptor)), wire, `${name} named/wire parity`);
    entries.set(name, {descriptor, shape: source.shape, wire});
  }
  const entry = name => { const value = entries.get(name); assert(value, `unknown contract ${name}`); return value; };
  return Object.freeze({
    encode(name, value) { const {descriptor, shape} = entry(name); return Buffer.from(encodeValue(descriptor, convert(shape, value, true))); },
    decode(name, bytes) { const {descriptor, shape} = entry(name); return convert(shape, decodeValue(descriptor, bytes), false); },
    schema(name) { return Buffer.from(entry(name).wire); },
  });
}
