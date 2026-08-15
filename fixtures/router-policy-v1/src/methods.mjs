export function normalizeMethod(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("method must be a non-empty string");
  }
  return value;
}

export function canonicalAllow(methods) {
  return [...methods];
}
