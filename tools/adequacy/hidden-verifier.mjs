import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const expectedPaths = [
  "README.md",
  "package.json",
  "src/errors.mjs",
  "src/index.mjs",
  "src/methods.mjs",
  "src/pattern.mjs",
  "src/router.mjs",
  "test/methods.test.mjs",
  "test/router.test.mjs",
];
const writablePaths = [
  "src/errors.mjs",
  "src/index.mjs",
  "src/methods.mjs",
  "src/router.mjs",
];

async function listFiles(root, prefix = "") {
  const result = [];
  for (const entry of await readdir(resolve(root, prefix), { withFileTypes: true })) {
    if (prefix === "" && entry.name === ".git") continue;
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`symlink is forbidden: ${relative}`);
    if (entry.isDirectory()) result.push(...(await listFiles(root, relative)));
    else if (entry.isFile()) result.push(relative);
    else throw new Error(`special path is forbidden: ${relative}`);
  }
  return result.sort();
}

async function digest(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function importSource(root, name) {
  const url = pathToFileURL(resolve(root, "src", name));
  url.searchParams.set("adequacy", createHash("sha256").update(root).digest("hex"));
  return import(url.href);
}

export async function verify(workspace, pristine) {
  const failures = [];
  const check = async (name, body) => {
    try {
      await body();
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const methods = await importSource(workspace, "methods.mjs");
  const errors = await importSource(workspace, "errors.mjs");
  const { Router } = await importSource(workspace, "router.mjs");
  const publicApi = await importSource(workspace, "index.mjs");

  await check("01 normalize GET", () => assert.equal(methods.normalizeMethod("get"), "GET"));
  await check("02 normalize custom token", () =>
    assert.equal(methods.normalizeMethod("m-search"), "M-SEARCH"),
  );
  await check("03 reject whitespace", () =>
    assert.throws(() => methods.normalizeMethod(" GET"), TypeError),
  );
  await check("04 reject empty", () =>
    assert.throws(() => methods.normalizeMethod(""), TypeError),
  );
  await check("05 Allow deduplicates", () =>
    assert.deepEqual(methods.canonicalAllow(["get", "GET"]), ["GET", "HEAD"]),
  );
  await check("06 GET implies HEAD", () =>
    assert.deepEqual(methods.canonicalAllow(["GET"]), ["GET", "HEAD"]),
  );
  await check("07 common Allow order", () =>
    assert.deepEqual(methods.canonicalAllow(["options", "delete", "patch", "put", "post", "head", "get"]), [
      "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS",
    ]),
  );
  await check("08 custom Allow byte order", () =>
    assert.deepEqual(methods.canonicalAllow(["trace", "m-search", "connect", "!first", "post"]), [
      "POST", "!FIRST", "CONNECT", "M-SEARCH", "TRACE",
    ]),
  );
  await check("09 static route precedence", () => {
    const router = new Router().add("GET", "/users/:id", "parameter").add("GET", "/users/new", "static");
    assert.equal(router.resolve("GET", "/users/new").handler, "static");
  });
  await check("10 longer route specificity", () => {
    const router = new Router().add("GET", "/items/:id", "short").add("GET", "/items/:id/detail", "long");
    assert.equal(router.resolve("GET", "/items/7/detail").handler, "long");
  });
  await check("11 earlier registration tie", () => {
    const router = new Router().add("GET", "/pair/:left", "first").add("GET", "/pair/:right", "second");
    assert.equal(router.resolve("GET", "/pair/7").handler, "first");
  });
  await check("12 exact HEAD precedence", () => {
    const router = new Router().add("GET", "/x", "get").add("HEAD", "/x", "head");
    assert.equal(router.resolve("HEAD", "/x").handler, "head");
  });
  await check("13 HEAD fallback", () => {
    const router = new Router().add("GET", "/x", "get");
    assert.equal(router.resolve("HEAD", "/x").handler, "get");
  });
  await check("14 requested and selected methods", () => {
    const router = new Router().add("GET", "/users/:id", "show");
    assert.deepEqual(router.resolve("head", "/users/42"), {
      kind: "match", requested_method: "HEAD", selected_method: "GET", handler: "show", params: { id: "42" },
    });
  });
  await check("15 405 unions matching patterns", () => {
    const router = new Router().add("POST", "/users/new", "post").add("GET", "/users/:id", "get");
    assert.deepEqual(router.resolve("DELETE", "/users/new"), {
      kind: "method_not_allowed", allow: ["GET", "HEAD", "POST"],
    });
  });
  await check("16 405 implicit HEAD", () =>
    assert.deepEqual(new Router().add("GET", "/x", "get").resolve("POST", "/x"), {
      kind: "method_not_allowed", allow: ["GET", "HEAD"],
    }),
  );
  await check("17 not found", () =>
    assert.deepEqual(new Router().add("GET", "/x", "get").resolve("GET", "/y"), errors.notFound()),
  );
  await check("18 duplicate normalized registration", () => {
    const router = new Router().add("get", "/x", "first");
    assert.throws(() => router.add("GET", "/x", "second"), TypeError);
  });
  await check("19 decoded parameters", () => {
    const result = new Router().add("GET", "/x/:value", "show").resolve("GET", "/x/a%20b");
    assert.deepEqual(result.params, { value: "a b" });
  });
  await check("20 public exports", () =>
    assert.deepEqual(Object.keys(publicApi).sort(), [
      "Router", "canonicalAllow", "compilePattern", "methodNotAllowed", "normalizeMethod", "notFound",
    ]),
  );

  const workspaceFiles = await listFiles(workspace);
  await check("21 pattern compiler unchanged", async () =>
    assert.equal(await digest(resolve(workspace, "src/pattern.mjs")), await digest(resolve(pristine, "src/pattern.mjs"))),
  );
  await check("22 tests unchanged", async () => {
    for (const path of ["test/methods.test.mjs", "test/router.test.mjs"]) {
      assert.equal(await digest(resolve(workspace, path)), await digest(resolve(pristine, path)));
    }
  });
  await check("23 metadata unchanged", async () => {
    for (const path of ["README.md", "package.json"]) {
      assert.equal(await digest(resolve(workspace, path)), await digest(resolve(pristine, path)));
    }
  });
  await check("24 exactly four source paths changed", async () => {
    const changed = [];
    for (const path of expectedPaths) {
      if ((await digest(resolve(workspace, path))) !== (await digest(resolve(pristine, path)))) changed.push(path);
    }
    assert.deepEqual(changed, writablePaths);
  });
  await check("25 no path shape changes", () => assert.deepEqual(workspaceFiles, expectedPaths));

  if (failures.length > 0) {
    throw new Error(`hidden verifier failed (${failures.length}):\n${failures.slice(0, 8).join("\n")}`);
  }
  return { checks: 25, passed: true };
}

if (import.meta.main) {
  const [workspace, pristine] = process.argv.slice(2);
  if (!workspace || !pristine) throw new Error("usage: hidden-verifier.mjs <workspace> <pristine>");
  const result = await verify(resolve(workspace), resolve(pristine));
  console.log(`hidden verifier: ${result.checks} checks passed`);
}
