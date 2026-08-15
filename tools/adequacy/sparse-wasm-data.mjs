#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("usage: sparse-wasm-data.mjs <input.wasm> <output.wasm>");
}

const input = Buffer.from(await readFile(inputPath));
if (!input.subarray(0, 8).equals(Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]))) {
  throw new Error("unsupported WebAssembly header");
}

const sections = [];
let cursor = 8;
let dataSectionSeen = false;
let dataCountSeen = false;
while (cursor < input.length) {
  const sectionStart = cursor;
  const id = input[cursor++];
  const size = readUnsigned(input, cursor);
  cursor = size.next;
  const payloadStart = cursor;
  const payloadEnd = payloadStart + size.value;
  if (payloadEnd > input.length) throw new Error("truncated WebAssembly section");
  if (id === 11) {
    if (dataSectionSeen) throw new Error("duplicate WebAssembly data section");
    dataSectionSeen = true;
    sections.push({ id, payload: packDataSection(input.subarray(payloadStart, payloadEnd)) });
  } else {
    if (id === 12) dataCountSeen = true;
    const customName = id === 0 ? readCustomSectionName(input, payloadStart, payloadEnd) : null;
    if (customName !== "name" && !customName?.startsWith(".debug")) {
      sections.push({ raw: input.subarray(sectionStart, payloadEnd) });
    }
  }
  cursor = payloadEnd;
}
if (!dataSectionSeen) throw new Error("WebAssembly data section is required");
if (dataCountSeen) throw new Error("passive or indexed WebAssembly data is not supported");

const output = [input.subarray(0, 8)];
for (const section of sections) {
  if (section.raw) {
    output.push(section.raw);
    continue;
  }
  output.push(Buffer.from([section.id]), encodeUnsigned(section.payload.length), section.payload);
}
await writeFile(outputPath, Buffer.concat(output));

function readCustomSectionName(bytes, start, end) {
  const length = readUnsigned(bytes, start);
  const nameEnd = length.next + length.value;
  if (nameEnd > end) throw new Error("truncated WebAssembly custom section name");
  return bytes.subarray(length.next, nameEnd).toString("utf8");
}

function packDataSection(payload) {
  let offset = 0;
  const count = readUnsigned(payload, offset);
  offset = count.next;
  const sourceSegments = [];
  for (let index = 0; index < count.value; index += 1) {
    const flags = readUnsigned(payload, offset);
    offset = flags.next;
    if (flags.value !== 0) throw new Error("only active memory-zero data segments are supported");
    if (payload[offset++] !== 0x41) throw new Error("data offset must be i32.const");
    const address = readSigned32(payload, offset);
    offset = address.next;
    if (payload[offset++] !== 0x0b) throw new Error("data offset expression must terminate");
    const length = readUnsigned(payload, offset);
    offset = length.next;
    const end = offset + length.value;
    if (end > payload.length) throw new Error("truncated WebAssembly data segment");
    sourceSegments.push({ address: address.value, bytes: payload.subarray(offset, end) });
    offset = end;
  }
  if (offset !== payload.length) throw new Error("trailing WebAssembly data bytes");

  const ordered = [...sourceSegments].sort((left, right) => left.address - right.address);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    if (previous.address + previous.bytes.length > ordered[index].address) {
      throw new Error("overlapping WebAssembly data segments are not supported");
    }
  }

  const packed = [];
  for (const segment of sourceSegments) {
    for (const range of retainedRanges(segment.bytes)) {
      packed.push({
        address: segment.address + range.start,
        bytes: segment.bytes.subarray(range.start, range.end),
      });
    }
  }

  const encoded = [encodeUnsigned(packed.length)];
  for (const segment of packed) {
    encoded.push(
      Buffer.from([0x00, 0x41]),
      encodeSigned32(segment.address),
      Buffer.from([0x0b]),
      encodeUnsigned(segment.bytes.length),
      segment.bytes,
    );
  }
  return Buffer.concat(encoded);
}

function retainedRanges(bytes) {
  const minimumGap = 32;
  const ranges = [];
  let start = 0;
  let cursor = 0;
  while (cursor < bytes.length) {
    if (bytes[cursor] !== 0) {
      cursor += 1;
      continue;
    }
    const zeroStart = cursor;
    while (cursor < bytes.length && bytes[cursor] === 0) cursor += 1;
    if (cursor - zeroStart < minimumGap) continue;
    if (zeroStart > start) ranges.push({ start, end: zeroStart });
    start = cursor;
  }
  if (start < bytes.length) ranges.push({ start, end: bytes.length });
  return ranges;
}

function readUnsigned(bytes, start) {
  let value = 0;
  let shift = 0;
  let cursor = start;
  while (true) {
    if (cursor >= bytes.length || shift > 35) throw new Error("invalid unsigned LEB128");
    const byte = bytes[cursor++];
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, next: cursor };
    shift += 7;
  }
}

function readSigned32(bytes, start) {
  let value = 0;
  let shift = 0;
  let cursor = start;
  let byte;
  do {
    if (cursor >= bytes.length || shift > 35) throw new Error("invalid signed LEB128");
    byte = bytes[cursor++];
    value |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);
  if (shift < 32 && (byte & 0x40)) value |= ~0 << shift;
  return { value: value | 0, next: cursor };
}

function encodeUnsigned(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("invalid unsigned value");
  const bytes = [];
  do {
    let byte = value & 0x7f;
    value = Math.floor(value / 128);
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return Buffer.from(bytes);
}

function encodeSigned32(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff) {
    throw new Error("data address must be a non-negative signed i32");
  }
  const bytes = [];
  let remaining = value;
  while (true) {
    let byte = remaining & 0x7f;
    remaining >>= 7;
    const sign = byte & 0x40;
    const done = (remaining === 0 && sign === 0) || (remaining === -1 && sign !== 0);
    if (!done) byte |= 0x80;
    bytes.push(byte);
    if (done) return Buffer.from(bytes);
  }
}
