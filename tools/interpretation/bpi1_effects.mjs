const TEXT = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const HEADER_LENGTH = 316;
const SECTION_COUNT = 10;
const DESCRIPTOR_START = 76;
const DESCRIPTOR_LENGTH = 24;

export function readBpi1EffectCatalog(encoded) {
  const bytes = Buffer.from(encoded);
  if (bytes.length < HEADER_LENGTH || bytes.subarray(0, 8).toString("ascii") !== "ABL_BPI1" ||
      bytes.readUInt16LE(8) !== 1 || bytes.readUInt16LE(10) !== 1 ||
      bytes.readUInt32LE(12) !== 0 || bytes.readUInt32LE(16) !== HEADER_LENGTH ||
      bytes.readUInt32LE(20) !== SECTION_COUNT || bytes.readBigUInt64LE(24) !== BigInt(bytes.length)) {
    throw new Error("bpi1_envelope_invalid");
  }
  let expectedOffset = HEADER_LENGTH;
  let effectSection = null;
  for (let index = 0; index < SECTION_COUNT; index += 1) {
    const descriptor = DESCRIPTOR_START + index * DESCRIPTOR_LENGTH;
    const kind = bytes.readUInt16LE(descriptor);
    const version = bytes.readUInt16LE(descriptor + 2);
    const flags = bytes.readUInt32LE(descriptor + 4);
    const offset = safeNumber(bytes.readBigUInt64LE(descriptor + 8));
    const length = safeNumber(bytes.readBigUInt64LE(descriptor + 16));
    if (kind !== index + 1 || version !== 1 || flags !== 0 || offset !== expectedOffset ||
        length > bytes.length - offset) throw new Error("bpi1_section_directory_invalid");
    expectedOffset += length;
    if (kind === 5) effectSection = bytes.subarray(offset, offset + length);
  }
  if (expectedOffset !== bytes.length || effectSection === null) throw new Error("bpi1_section_directory_invalid");

  const reader = new Reader(effectSection);
  const count = reader.u32();
  const effects = [];
  const identities = new Set();
  const semanticDigests = new Set();
  const ordinalDigests = new Set();
  for (let index = 0; index < count; index += 1) {
    const ordinal = reader.u32();
    if (ordinal !== index) throw new Error("bpi1_effect_ordinal_invalid");
    const identityBytes = reader.bytes(reader.u32());
    let identity;
    try { identity = TEXT.decode(identityBytes); } catch { throw new Error("bpi1_effect_identity_utf8"); }
    if (identity.length === 0 || identities.has(identity) || identity === "caller_fuel" || identity === "suspension") {
      throw new Error("bpi1_effect_identity_invalid");
    }
    identities.add(identity);
    const payloadSchemaIndex = reader.u32();
    const resumeSchemaIndex = reader.u32();
    const mode = reader.u8();
    if (mode !== 0 || reader.u8() !== 0 || reader.u16() !== 0) throw new Error("bpi1_effect_mode_invalid");
    const semanticEffectDigest = reader.bytes(32);
    const ordinalEffectDigest = reader.bytes(32);
    const semanticHex = semanticEffectDigest.toString("hex");
    const ordinalHex = ordinalEffectDigest.toString("hex");
    if (semanticDigests.has(semanticHex) || ordinalDigests.has(ordinalHex)) throw new Error("bpi1_effect_digest_duplicate");
    semanticDigests.add(semanticHex);
    ordinalDigests.add(ordinalHex);
    effects.push(Object.freeze({
      ordinal,
      identity,
      payloadSchemaIndex,
      resumeSchemaIndex,
      mode,
      semanticEffectDigest,
      ordinalEffectDigest
    }));
  }
  reader.finish();
  return Object.freeze(effects);
}

class Reader {
  constructor(bytes) { this.bytesValue = bytes; this.offset = 0; }
  require(length) {
    if (!Number.isInteger(length) || length < 0 || length > this.bytesValue.length - this.offset) {
      throw new Error("bpi1_effect_section_bounds");
    }
  }
  u8() { this.require(1); return this.bytesValue[this.offset++]; }
  u16() { this.require(2); const value = this.bytesValue.readUInt16LE(this.offset); this.offset += 2; return value; }
  u32() { this.require(4); const value = this.bytesValue.readUInt32LE(this.offset); this.offset += 4; return value; }
  bytes(length) { this.require(length); const value = Buffer.from(this.bytesValue.subarray(this.offset, this.offset + length)); this.offset += length; return value; }
  finish() { if (this.offset !== this.bytesValue.length) throw new Error("bpi1_effect_section_trailing_bytes"); }
}

function safeNumber(value) {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error("bpi1_section_length_invalid");
  return result;
}
