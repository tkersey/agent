// Immutable batch reference supplied as task evidence. Fields are byte arrays.
// This function rescans the entire input; it is not an incremental replacement.
export function observePrefix(bytes, endOfInput = true) {
  if (!Array.isArray(bytes) || bytes.some(b => !Number.isInteger(b) || b < 0 || b > 255))
    throw new TypeError('expected an array of bytes');
  const records = [];
  let fields = [], field = [], escape = null, unfinished = false;
  const failed = (code, offset) => ({ records, status: 'failed', error: { code, offset } });
  for (let offset = 0; offset < bytes.length; offset++) {
    const byte = bytes[offset];
    unfinished = true;
    if (escape !== null) {
      if (byte === 92 || byte === 44) field.push(byte);
      else if (byte === 110) field.push(10);
      else return failed('InvalidEscape', offset);
      escape = null;
    } else if (byte === 92) escape = offset;
    else if (byte === 44) { fields.push(field); field = []; }
    else if (byte === 10) {
      fields.push(field); records.push(fields);
      fields = []; field = []; unfinished = false;
    } else field.push(byte);
  }
  if (!endOfInput) return { records, status: 'open' };
  if (escape !== null) return failed('DanglingEscape', escape);
  if (unfinished) return failed('UnterminatedRecord', bytes.length);
  return { records, status: 'complete' };
}
export const parseBatch = bytes => observePrefix(bytes, true);
