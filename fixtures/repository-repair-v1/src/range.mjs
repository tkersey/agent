export function normalizeRange(start, end) {
  if (start > end) {
    return { start, end };
  }
  return { start: end, end: start };
}
