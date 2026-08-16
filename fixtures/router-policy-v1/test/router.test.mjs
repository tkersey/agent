import { expect } from "bun:test";
import { notFound } from "../src/errors.mjs";
import * as publicApi from "../src/index.mjs";
import { compilePattern } from "../src/pattern.mjs";
import { Router } from "../src/router.mjs";

export async function checkRouterContract() {
  expect(notFound()).toEqual({ kind: "not_found" });
  const { methodNotAllowed } = await import("../src/errors.mjs");
  const first = methodNotAllowed(["post", "get"]);
  expect(first).toEqual({ kind: "method_not_allowed", allow: ["GET", "HEAD", "POST"] });
  first.allow.push("DELETE");
  expect(methodNotAllowed(["post", "get"])).toEqual({
    kind: "method_not_allowed",
    allow: ["GET", "HEAD", "POST"],
  });

  expect(() => compilePattern("users/:id")).toThrow(TypeError);
  expect(() => compilePattern("/:id/:id")).toThrow(TypeError);
  const pattern = compilePattern("/users/:id");
  expect(pattern.staticSegmentCount).toBe(1);
  expect(pattern.totalSegmentCount).toBe(2);
  expect(pattern.match("/users/a%20b")).toEqual({ id: "a b" });
  expect(pattern.match("/users/a/b")).toBeNull();

  const registration = new Router();
  expect(registration.add("get", "/users/:id", "user.show")).toBe(registration);
  expect(() => registration.add("GET", "/users/:id", "duplicate")).toThrow(TypeError);
  expect(() => registration.add("post", "/users", "")).toThrow(TypeError);

  const precedence = new Router()
    .add("GET", "/users/:id", "user.show")
    .add("GET", "/users/new", "user.new")
    .add("GET", "/pair/:right", "pair.first")
    .add("GET", "/pair/:value", "pair.second")
    .add("GET", "/deep/:id/item", "deep.item");
  expect(precedence.resolve("GET", "/users/new").handler).toBe("user.new");
  expect(precedence.resolve("GET", "/pair/7").handler).toBe("pair.first");
  expect(precedence.resolve("GET", "/deep/7/item").handler).toBe("deep.item");

  const exact = new Router()
    .add("GET", "/users/:id", "user.get")
    .add("HEAD", "/users/:id", "user.head");
  expect(exact.resolve("head", "/users/42")).toEqual({
    kind: "match",
    requested_method: "HEAD",
    selected_method: "HEAD",
    handler: "user.head",
    params: { id: "42" },
  });

  const fallback = new Router().add("GET", "/users/:id", "user.get");
  expect(fallback.resolve("HEAD", "/users/a%20b")).toEqual({
    kind: "match",
    requested_method: "HEAD",
    selected_method: "GET",
    handler: "user.get",
    params: { id: "a b" },
  });

  const methods = new Router()
    .add("GET", "/users/:id", "user.get")
    .add("POST", "/users/new", "user.create")
    .add("x-custom", "/users/:name", "user.custom");
  expect(methods.resolve("DELETE", "/users/new")).toEqual({
    kind: "method_not_allowed",
    allow: ["GET", "HEAD", "POST", "X-CUSTOM"],
  });

  const missing = new Router().add("GET", "/users/:id", "user.get");
  expect(missing.resolve("GET", "/other/42")).toEqual({ kind: "not_found" });

  expect(Object.keys(publicApi).sort()).toEqual([
    "Router", "canonicalAllow", "compilePattern", "methodNotAllowed", "normalizeMethod", "notFound",
  ]);
}
