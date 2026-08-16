import { expect, test } from "bun:test";
import { canonicalAllow, normalizeMethod } from "../src/methods.mjs";
import { checkRouterContract } from "./router.test.mjs";

test("router policy contract", async () => {
  expect(normalizeMethod("get")).toBe("GET");
  expect(normalizeMethod("m-search")).toBe("M-SEARCH");
  expect(normalizeMethod("!#$%&'*+-.^_`|~09az")).toBe("!#$%&'*+-.^_`|~09AZ");
  for (const value of ["", " GET", "GET ", "G ET", "méthod", 42, null]) {
    expect(() => normalizeMethod(value)).toThrow(TypeError);
  }

  const input = ["patch", "x-one", "get", "post", "GET", "delete", "x-alpha"];
  expect(canonicalAllow(input)).toEqual([
    "GET", "HEAD", "POST", "PATCH", "DELETE", "X-ALPHA", "X-ONE",
  ]);
  expect(input).toEqual(["patch", "x-one", "get", "post", "GET", "delete", "x-alpha"]);
  expect(canonicalAllow(["head"])).toEqual(["HEAD"]);

  await checkRouterContract();
});
