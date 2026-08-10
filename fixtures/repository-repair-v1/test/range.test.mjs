import { describe, expect, test } from "bun:test";

import { normalizeRange } from "../src/range.mjs";

describe("normalizeRange", () => {
  test("preserves ascending bounds", () => {
    expect(normalizeRange(1, 3)).toEqual({ start: 1, end: 3 });
  });

  test("swaps descending bounds", () => {
    expect(normalizeRange(3, 1)).toEqual({ start: 1, end: 3 });
  });

  test("preserves equal bounds", () => {
    expect(normalizeRange(2, 2)).toEqual({ start: 2, end: 2 });
  });

  test("supports negative bounds", () => {
    expect(normalizeRange(-1, -5)).toEqual({ start: -5, end: -1 });
  });
});
