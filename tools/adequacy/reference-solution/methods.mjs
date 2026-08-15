const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const COMMON = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const COMMON_INDEX = new Map(COMMON.map((method, index) => [method, index]));

export function normalizeMethod(value) {
  if (typeof value !== "string" || !TOKEN.test(value)) {
    throw new TypeError("method must be a non-empty HTTP token");
  }
  return value.toUpperCase();
}

export function canonicalAllow(methods) {
  const unique = new Set();
  for (const method of methods) unique.add(normalizeMethod(method));
  if (unique.has("GET")) unique.add("HEAD");

  return [...unique].sort((left, right) => {
    const leftIndex = COMMON_INDEX.get(left);
    const rightIndex = COMMON_INDEX.get(right);
    if (leftIndex !== undefined || rightIndex !== undefined) {
      if (leftIndex === undefined) return 1;
      if (rightIndex === undefined) return -1;
      return leftIndex - rightIndex;
    }
    return left < right ? -1 : left > right ? 1 : 0;
  });
}
