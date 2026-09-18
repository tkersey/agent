import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { runRepositoryTests } from "../../runtime/repository_tests.mjs";

const fixture = resolve("fixtures/repository-repair-v1");
const CORRECT_SOURCE = "export function normalizeRange(start,end){return {start:Math.min(start,end),end:Math.max(start,end)}}\n";
async function fixtureWorkspace(context) {
  const root = await mkdtemp(join(tmpdir(), "agent-repository-executor-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  await cp(fixture, workspace, { recursive: true });
  return workspace;
}

test("launch failure and absent or incomplete reports are not test observations", async (context) => {
  const workspace = await fixtureWorkspace(context);
  const spawn = childProcess.spawnSync;
  try {
    for (const [status, report, error = /did not report completed tests/] of [
      [71, ""], [1, ""], [0, ""],
      [1, '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="bun test" tests="4">'],
      [0, '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="bun test" tests="0"></testsuites>'],
      [1, "x".repeat(1024 * 1024 + 1), /exceeds its file bound/],
    ]) {
      let reportPath;
      childProcess.spawnSync = (_, args) => {
        reportPath = args.find((arg) => arg.startsWith("--reporter-outfile="))
          .slice("--reporter-outfile=".length);
        writeFileSync(reportPath, report);
        return { status, signal: null, stdout: "", stderr: "sandbox_apply: Operation not permitted" };
      };
      syncBuiltinESMExports();
      await assert.rejects(runRepositoryTests(workspace), error);
      assert.equal(existsSync(reportPath), false);



    }
  } finally {
    childProcess.spawnSync = spawn;
    syncBuiltinESMExports();
  }
});

test("replacement code cannot exit, forge output, mock assertions, or pass matcher objects", async (context) => {
  const workspace = await fixtureWorkspace(context);
  const replacements = [
    "export function normalizeRange(",
    "export function normalizeRange() { return {}; } process.exit(0);",
    "export function normalizeRange() { return {}; } console.log('4 pass\\n0 fail\\n4 expect() calls'); process.exit(0);",
    "import {mock} from 'bun:test'; mock.module('bun:test', () => ({})); export function normalizeRange(){return {};}",
    "export function normalizeRange(){return {asymmetricMatch(){return true}, $$typeof: Symbol.for('jest.asymmetricMatcher')};}",
    "export function normalizeRange(){return {get start(){return 1}, end:3};}",
    "export function normalizeRange(a,b){return {start:a,end:b,toJSON(){return {start:Math.min(a,b),end:Math.max(a,b)}}};}",
    "await import('node:process').catch(e => e.constructor.constructor('return process')().exit(0)); export function normalizeRange(){return {};}",
    "const p=import('node:process'); p.catch(()=>{}); p.constructor.constructor('return process')().exit(0); export function normalizeRange(){return {};}",
    "globalThis.constructor.constructor('return process')().exit(0); export function normalizeRange(){return {};}",
    "Array.prototype[Symbol.iterator]=function*(){yield Math.min(this[0],this[1]);yield Math.max(this[0],this[1]);}; export function normalizeRange(start,end){return {start,end};}",
    "export function normalizeRange(a,b){return new Proxy({}, {ownKeys(){return ['start','end']}, getOwnPropertyDescriptor(_,key){return {enumerable:true,configurable:true,value:key==='start'?Math.min(a,b):Math.max(a,b)}}});}",
  ];
  for (const replacement of replacements) {
    await writeFile(join(workspace, "src/range.mjs"), replacement);
    const result = await runRepositoryTests(workspace);
    assert.equal(result[1], false, replacement);

  }
});

test("test process authority is read-only and excludes the outer workspace", async (context) => {
  const workspace = await fixtureWorkspace(context);
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  context.after(() => new Promise((done) => server.close(done)));
  const port = server.address().port;
  await writeFile(join(workspace, "src/range.mjs"), CORRECT_SOURCE);
  const marker = join(workspace, "..", "outside.txt");
  const outside = await realpath(join(workspace, ".."));
  await writeFile(marker, "outside sentinel");
  const tests = join(workspace, "test/range.test.mjs");
  await writeFile(tests, `${await readFile(tests, "utf8")}\n
    import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
    import {spawnSync} from 'node:child_process';
    test('OS confinement applies independently of the replacement realm', async () => {
      expect(() => readFileSync(${JSON.stringify(marker)})).toThrow();
      let parentEntries;
      try { parentEntries = readdirSync(${JSON.stringify(outside)}); } catch {}
      // Bubblewrap constructs an empty parent, not the real host directory.
      if (parentEntries !== undefined) expect(parentEntries).toEqual(['workspace']);
      expect(() => writeFileSync(${JSON.stringify(marker)}, 'changed')).toThrow();
      expect(() => writeFileSync('src/range.mjs', 'changed')).toThrow();
      expect(spawnSync('/bin/sh', ['-c', 'echo escaped > "$1"', 'sh', ${JSON.stringify(marker)}]).status).not.toBe(0);
      await expect(Bun.connect({hostname:'127.0.0.1', port:${port}, socket:{data(){}}})).rejects.toThrow();
    });
  `);
  const result = await runRepositoryTests(workspace);
  assert.equal(result[1], true);
  assert.equal(await readFile(marker, "utf8"), "outside sentinel");
  assert.equal(await readFile(join(workspace, "src/range.mjs"), "utf8"), CORRECT_SOURCE);
});

test("valid accessor and proxy repairs retain their fixture observations", async (context) => {
  const workspace = await fixtureWorkspace(context);
  for (const source of [
    "export function normalizeRange(a,b){return {get start(){return Math.min(a,b)}, get end(){return Math.max(a,b)}};}",
    "export function normalizeRange(a,b){return new Proxy({start:Math.min(a,b),end:Math.max(a,b)}, {});}",
  ]) {
    await writeFile(join(workspace, "src/range.mjs"), source);
    const response = await runRepositoryTests(workspace);
    assert.equal(response[1], true, source);
  }
});

test("isolated fixture equality preserves native Bun value semantics", async (context) => {
  const workspace = await fixtureWorkspace(context);
  const fields = "{start:Math.min(a,b),end:Math.max(a,b)}";
  const values = [
    fields,
    `Object.assign(Object.create(null),${fields})`,
    `Object.assign(new(class Result{})(),${fields})`,
    `Object.assign(new Date(0),${fields})`,
    `Object.assign(Object.setPrototypeOf(new Date(0),null),${fields})`,
    `Object.assign(Object.defineProperty(new Date(0),Symbol.toStringTag,{value:'Object'}),${fields})`,
    `Object.assign(/x/,${fields})`,
    `Object.assign(new Map(),${fields})`,
    `Object.assign(new Set(),${fields})`,
    `Object.assign([],${fields})`,
    `Object.assign(new Number(0),${fields})`,
    `Object.assign(new String(''),${fields})`,
    `Object.assign(new Boolean(false),${fields})`,
    `Object.assign(new Uint8Array(),${fields})`,
    `new Proxy(${fields},{})`,
    `new Proxy(Object.assign(new Date(0),${fields}),{})`,
    "{get start(){return Math.min(a,b)},get end(){return Math.max(a,b)}}",
    `Object.defineProperty(${fields},Symbol.toStringTag,{value:'Date'})`,
    "{start:a,end:b}",
    `({...${fields},unused:undefined})`,
    `({...${fields},toJSON(){return {};}})`,
  ];
  for (const value of values) {
    await writeFile(join(workspace, "src/range.mjs"),
      `export function normalizeRange(a,b){return ${value};}\n`);
    // These finite, test-owned controls run without the replacement adapter.
    const direct = childProcess.spawnSync("bun", [
      "--no-install", "--no-env-file", "--no-addons", "--no-macros",
      "--config=/dev/null", "test", "./test/range.test.mjs",
    ], {
      cwd: workspace, env: { PATH: process.env.PATH }, encoding: "utf8",
      timeout: 10000, killSignal: "SIGKILL",
    });
    assert.equal(direct.error, undefined, value);
    assert.equal(direct.signal, null, value);
    assert([0, 1].includes(direct.status), value);
    assert((direct.stdout + direct.stderr).includes("Ran 4 tests across 1 file."), value);
    const response = await runRepositoryTests(workspace);
    assert.equal(response[1], direct.status === 0, value);

  }
});
