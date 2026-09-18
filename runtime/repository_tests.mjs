// Preserved repository fixture executor: real Bun tests in an OS sandbox,
// candidate code in a separate realm, and a complete reporter result required.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access, lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Execute exactly the admitted bytes. A concurrent change to the caller's root
// cannot substitute a different source while Bun opens its input files.
export async function runRepositorySnapshot(source, tests) {
  const root = await mkdtemp(join(tmpdir(), "agent-repository-snapshot-"));
  try {
    await mkdir(join(root, "src"));
    await mkdir(join(root, "test"));
    await writeFile(join(root, "src/range.mjs"), source, {flag: "wx", mode: 0o400});
    await writeFile(join(root, "test/range.test.mjs"), tests, {flag: "wx", mode: 0o400});
    return await runRepositoryTests(root);
  } finally { await rm(root, {recursive: true, force: true}); }
}

export async function runRepositoryTests(workspace) {
  workspace = await realpath(workspace);
  const reportRoot = await mkdtemp(join(tmpdir(), "agent-repository-tests-"));
  try {
    const reportPath = join(await realpath(reportRoot), "report.xml");
    await writeFile(reportPath, "", { flag: "wx", mode: 0o600 });
    const command = await repositoryTestCommand(workspace, reportPath);
    const result = spawnSync(command[0], command.slice(1), {
      cwd: workspace,
      encoding: "utf8",
      timeout: 10_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
      env: { AGENT_REPOSITORY_TEST_PRELOAD: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error !== undefined) throw result.error;
    assert.equal(result.signal, null, "repository test process was killed");
    assert(Number.isInteger(result.status), "repository test process has no exit status");
    const stat = await lstat(reportPath);
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1024 * 1024,
      "repository test report exceeds its file bound");
    // Bun's reporter takes a filesystem path, not a pipe-descriptor alias.
    // Only its completed report establishes test execution, including failure.
    const report = await readFile(reportPath, "utf8");
    assert(report.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n') &&
      /<testsuites name="bun test" tests="[1-9][0-9]*"/.test(report) &&
      report.trimEnd().endsWith("</testsuites>"),
    "repository test runner did not report completed tests");
    const stdout = boundedOutput(result.stdout), stderr = boundedOutput(result.stderr);
    return [result.status, result.status === 0, stdout.text, stderr.text, stdout.truncated, stderr.truncated];
  } finally {
    await rm(reportRoot, { recursive: true, force: true });
  }
}

async function repositoryTestCommand(workspace, reportPath) {
  const bun = await executablePath("bun");
  const preload = await realpath(fileURLToPath(import.meta.url));
  const command = [bun, "--no-install", "--no-env-file", "--no-addons", "--no-macros",
    "--config=/dev/null", "test", "--preload", preload,
    "--reporter=junit", `--reporter-outfile=${reportPath}`, "./test/range.test.mjs"];
  if (process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec")) {
    const readable = ["/System/Library", "/usr/lib", "/usr/share", "/dev",
      "/private/etc", "/private/var/db/timezone", workspace, bun, preload, reportPath]
      .filter(existsSync);
    const paths = [...new Set(await Promise.all(readable.map((path) => realpath(path))))];
    const ancestors = new Set(["/"]);
    for (const path of paths) {
      for (let parent = dirname(path); parent !== "/"; parent = dirname(parent)) ancestors.add(parent);
    }
    const allowed = [...paths.map((path) => `(subpath ${JSON.stringify(path)})`),
      ...[...ancestors].map((path) => `(literal ${JSON.stringify(path)})`)];
    // The loader needs root and preload-directory entries, not workspace ancestors.
    const data = [...paths.map((path) => `(subpath ${JSON.stringify(path)})`),
      '(literal "/")', `(literal ${JSON.stringify(dirname(preload))})`];
    const profile = `(version 1)
      (allow default)
      (deny network*)
      (deny file-read* (require-all ${allowed.map((rule) => `(require-not ${rule})`).join(" ")}))
      (deny file-read-data (require-all ${data.map((rule) => `(require-not ${rule})`).join(" ")}))
      (deny file-write* (require-not (literal ${JSON.stringify(reportPath)})))
      (deny process-fork)
      (deny process-exec (require-not (literal ${JSON.stringify(bun)})))`;
    return ["/usr/bin/sandbox-exec", "-p", profile, ...command];
  }
  if (process.platform === "linux") {
    const selected = ["/usr/bin/bwrap", "/bin/bwrap"].find(existsSync);
    assert(selected, "repository tests require Bubblewrap");
    const bwrap = await realpath(selected);
    const stat = await lstat(bwrap);
    assert(stat.isFile() && stat.uid === 0 && (stat.mode & 0o022) === 0, "untrusted Bubblewrap");
    const directories = ["/usr", "/nix/store", "/run/current-system/sw"].filter(existsSync);
    const links = [];
    for (const path of ["/bin", "/sbin", "/lib", "/lib64"].filter(existsSync)) {
      if ((await lstat(path)).isSymbolicLink()) links.push([await readlink(path), path]);
      else directories.push(path);
    }
    const files = ["/etc/ld.so.cache", "/etc/localtime", bun, preload].filter(existsSync);
    const mounts = [...directories, workspace];
    const parents = new Set();
    for (const path of [...mounts, ...files.map(dirname), dirname(reportPath)]) {
      for (let parent = path; parent !== "/"; parent = dirname(parent)) parents.add(parent);
    }
    return [bwrap, "--die-with-parent", "--new-session", "--unshare-all", "--clearenv",
      ...[...parents].sort((a, b) => a.length - b.length).flatMap((path) => ["--dir", path]),
      ...mounts.flatMap((path) => ["--ro-bind", path, path]),
      ...links.flatMap(([target, path]) => ["--symlink", target, path]),
      ...files.filter((path) => !mounts.some((root) => path.startsWith(`${root}/`)))
        .flatMap((path) => ["--ro-bind", path, path]),
      "--bind", reportPath, reportPath,
      "--dev", "/dev", "--proc", "/proc", "--remount-ro", "/", "--chdir", workspace,
      "--setenv", "AGENT_REPOSITORY_TEST_PRELOAD", "1", ...command];
  }
  throw new Error("repository tests require an OS sandbox");
}

async function executablePath(name) {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const path = resolve(directory, name);
    try {
      await access(path, constants.X_OK);
      if ((await lstat(await realpath(path))).isFile()) return realpath(path);
    } catch {}
  }
  throw new Error(`repository test executable unavailable: ${name}`);
}

// Bun retains the fixture tests and suite verdict. The replacement gets only
// its own JavaScript realm, not Bun, process, module mocks, or host objects.
// The OS sandbox above remains the filesystem/network boundary.
if (process.env.AGENT_REPOSITORY_TEST_PRELOAD === "1") {
  const testApi = { ...await import("bun:test") };
  const { mock, expect: nativeExpect } = testApi;
  const deepEquals = Bun.deepEquals;
  const { createContext, Script, SourceTextModule } = await import("node:vm");
  const source = resolve("src/range.mjs");
  const context = createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
  });
  // Keep original values for the native equality operation. Copying a value
  // into JSON can change the outcome of the fixture's toEqual assertion.
  const invoke = new Script(`"use strict";
    (() => {
      const parse = JSON.parse, apply = Reflect.apply;
      return (namespace, args) => apply(namespace.normalizeRange, undefined, parse(args));
    })()`
  ).runInContext(context);
  const expectedValue = new Script(`(() => {
    const parse = JSON.parse;
    return encoded => parse(encoded);
  })()`).runInContext(context);
  const results = new WeakMap();
  let module;
  let evaluationFailed = false;
  try {
    module = new SourceTextModule(await readFile(source, "utf8"), {
      context,
      identifier: pathToFileURL(source).href,
      // Do not leak a host Error object into the replacement's realm.
      importModuleDynamically() { throw null; },
    });
    await module.link(() => { throw null; });
    await module.evaluate();
  } catch {
    evaluationFailed = true;
  }
  mock.module(source, () => ({
    normalizeRange(...args) {
      if (evaluationFailed) throw new Error("repository replacement evaluation failed");
      let result;
      try { result = invoke(module.namespace, JSON.stringify(args)); }
      catch { throw new Error("repository replacement invocation failed"); }
      const handle = Object.freeze(Object.create(null));
      results.set(handle, result);
      return handle;
    },
  }));
  mock.module("bun:test", () => ({
    ...testApi,
    expect: new Proxy(nativeExpect, {
      apply(target, receiver, args) {
        if (!results.has(args[0])) return Reflect.apply(target, receiver, args);
        const actual = results.get(args[0]);
        return {
          toEqual(expected) {
            let passed = false;
            try { passed = deepEquals(actual, expectedValue(JSON.stringify(expected))); }
            catch {}
            // Bun records the assertion, but cannot call an authored formatter
            // or expose its host-owned expected object to an authored matcher.
            return nativeExpect(passed).toBe(true);
          },
        };
      },
    }),
  }));
}


function boundedOutput(value) {
  let text = "", bytes = 0;
  for (const scalar of value) {
    const length = Buffer.byteLength(scalar);
    if (bytes + length > 4096) return { text, truncated: true };
    text += scalar; bytes += length;
  }
  return { text, truncated: false };
}
