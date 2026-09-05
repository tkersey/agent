import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { access, lstat, mkdtemp, open, readFile, readlink, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const EXPECTED_INITIAL_DIGEST = "8832f65e4bcf4a701dc76f310f3af34296bf8e95feb16ad70608041cb2e6dbb3";
export const EXPECTED_FINAL_DIGEST = "8bf50f62e3a4294ef359a6b9096d66e5597ce37824b3483ddad541ee21438453";
export const EXPECTED_FINAL_TREE = "0d9ac8802aac6597cb0a443245efb6f92a0249fe";
export const CORRECT_SOURCE = `export function normalizeRange(start, end) {
  if (start <= end) {
    return { start, end };
  }
  return { start: end, end: start };
}
`;

export async function createRepositoryEnvironment(
  workspaceRoot,
  restored = {},
) {
  const workspaceReal = await realpath(workspaceRoot);
  let baselineFailed = restored.baselineFailed ?? false;
  let mutationApplied = restored.mutationApplied ?? false;
  let postMutationPassed = restored.postMutationPassed ?? false;
  let requestCount = restored.repositoryRequests ?? 0;
  let testProcessCount = restored.realTestProcesses ?? 0;

  async function resolveEffect(request) {
    requestCount += 1;
    switch (request.effectSemanticIdentity) {
      case "repo.list.v1": {
        assert.equal(request.payload.length, 0);
        const paths = ["README.md", "package.json", "src/range.mjs", "test/range.test.mjs"];
        for (const path of paths) await admittedRead(path);
        return encodeText(paths.join("\n"));
      }
      case "repo.read.v1": {
        assert.equal(request.payload.length, 1);
        const role = request.payload[0];
        const path = ["package.json", "src/range.mjs", "test/range.test.mjs"][role];
        assert(path !== undefined, "invalid read role");
        const contents = await admittedRead(path);
        return concat(Buffer.from([role]), encodeText(path), encodeText(sha256(contents)), encodeText(contents));
      }
      case "repo.search.v1": {
        const cursor = { value: 0 };
        const query = decodeText(request.payload, cursor);
        assert.equal(cursor.value, request.payload.length);
        if (query.length === 0) return encodeText("");
        const matches = [];
        for (const path of ["README.md", "package.json", "src/range.mjs", "test/range.test.mjs"]) {
          const contents = (await admittedRead(path)).toString("utf8");
          for (const [index, line] of contents.split("\n").entries()) {
            if (line.includes(query)) matches.push(`${path}:${index + 1}:${line}`);
          }
        }
        const encoded = matches.join("\n");
        assert(Buffer.byteLength(encoded) <= 1900, "search result exceeds admitted evidence bound");
        return encodeText(encoded);
      }
      case "repo.test.v1": {
        assert.equal(request.payload.length, 0);
        const passed = await runRepositoryTests(workspaceReal);
        testProcessCount += 1;
        if (!mutationApplied) {
          baselineFailed ||= !passed;
        } else {
          postMutationPassed = passed;
        }
        const observation = passed
          ? "complete fixture test suite passed"
          : "complete fixture test suite failed";
        return concat(Buffer.from([Number(passed)]), encodeText(observation));
      }
      case "repo.replace.approved.v1": {
        const proposal = decodeReplaceRequest(request.payload);
        // Filesystem authority is narrower than the image's Agent policy.
        assert.equal(proposal.path, "src/range.mjs");
        const replacement = Buffer.from(proposal.replacement, "utf8");
        const handle = await admittedFile(proposal.path, "r");
        const absolute = join(workspaceRoot, proposal.path);
        const temporary = `${absolute}.agent-replacement`;
        try {
          const current = await handle.readFile();
          assert.equal(sha256(current), proposal.expected_sha256);
          await rm(temporary, { force: true });
          const replacementHandle = await open(temporary, "wx", 0o644);
          try {
            const written = await replacementHandle.write(replacement, 0, replacement.length, 0);
            assert.equal(written.bytesWritten, replacement.length);
            await replacementHandle.sync();
          } finally {
            await replacementHandle.close();
          }
          await rename(temporary, absolute);
        } finally {
          await handle.close();
          await rm(temporary, { force: true });
        }
        mutationApplied = true;
        return concat(
          Buffer.from([1]),
          encodeText(proposal.path),
          encodeText(proposal.expected_sha256),
          encodeText(sha256(replacement)),
          encodeText("replacement applied"),
        );
      }
      default:
        throw new Error(`unexpected repository effect ${request.effectSemanticIdentity}`);
    }
  }

  async function admittedRead(relativePath) {
    const handle = await admittedFile(relativePath, "r");
    try {
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  }

  async function admittedFile(relativePath, flags) {
    assert(!relativePath.startsWith("/") && !relativePath.split("/").includes(".."));
    const absolute = join(workspaceRoot, relativePath);
    const parentReal = await realpath(dirname(absolute));
    assert(parentReal === workspaceReal || parentReal.startsWith(`${workspaceReal}/`));
    const stat = await lstat(absolute);
    assert(stat.isFile() && !stat.isSymbolicLink());
    return open(absolute, flags);
  }

  return Object.freeze({
    resolveEffect,
    admittedRead,
    snapshot() {
      return Object.freeze({
        baselineFailed,
        mutationApplied,
        postMutationPassed,
        repositoryRequests: requestCount,
        realTestProcesses: testProcessCount,
      });
    },
  });
}

async function runRepositoryTests(workspace) {
  const reportRoot = await mkdtemp(join(tmpdir(), "agent-repository-tests-"));
  try {
    const reportPath = join(await realpath(reportRoot), "report.xml");
    await writeFile(reportPath, "", { flag: "wx", mode: 0o600 });
    const command = await repositoryTestCommand(workspace, reportPath);
    const result = spawnSync(command[0], command.slice(1), {
      cwd: workspace,
      encoding: "utf8",
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
    return result.status === 0;
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

// Bun retains the actual fixture assertions and suite verdict. The replacement
// gets only its own JavaScript realm, not Bun, process, module mocks, or host
// objects. The OS sandbox above remains the filesystem/network boundary.
if (process.env.AGENT_REPOSITORY_TEST_PRELOAD === "1") {
  const { mock } = await import("bun:test");
  const { createContext, Script, SourceTextModule } = await import("node:vm");
  const source = resolve("src/range.mjs");
  const context = createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
  });
  // Resolve authored properties inside their own realm. Only resulting data,
  // never getters, Proxy traps, or matchers, enters Bun's assertion realm.
  const invoke = new Script(`"use strict";
    (() => {
      const parse = JSON.parse, stringify = JSON.stringify, apply = Reflect.apply;
      const keys = Reflect.ownKeys, get = Reflect.get, descriptor = Object.getOwnPropertyDescriptor;
      const create = Object.create, array = Array.isArray, prototype = Object.setPrototypeOf;
      const SetType = Set, has = Set.prototype.has, add = Set.prototype.add, remove = Set.prototype.delete;
      function data(value, seen) {
        if (value === null || typeof value !== 'object') {
          switch (typeof value) { case 'function': case 'symbol': case 'bigint': throw null; }
          return value;
        }
        if (apply(has, seen, [value])) throw null;
        apply(add, seen, [value]);
        const output = array(value) ? prototype([], null) : create(null);
        const names = keys(value);
        for (let i = 0; i < names.length; i += 1) {
          const key = names[i], item = descriptor(value, key);
          if (!item || !item.enumerable) continue;
          if (typeof key !== 'string') throw null;
          output[key] = data(get(value, key), seen);
        }
        apply(remove, seen, [value]);
        return output;
      }
      return (namespace, args) => stringify(data(
        apply(namespace.normalizeRange, undefined, parse(args)), new SetType()));
    })()`
  ).runInContext(context);
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
      return result === undefined ? undefined : JSON.parse(result);
    },
  }));
}

export function decodeFinalResult(bytes) {
  const cursor = { value: 0 };
  const result = {
    summary: decodeText(bytes, cursor),
    changed_path: decodeText(bytes, cursor),
    final_source_sha256: decodeText(bytes, cursor),
  };
  assert.equal(cursor.value, bytes.length);
  return result;
}

export function validateFinalResult(result, mode, sourceBytes) {
  assert(["fixture", "live"].includes(mode));
  const sourceDigest = sha256(sourceBytes);
  assert.equal(result.changed_path, "src/range.mjs");
  assert.equal(result.final_source_sha256, sourceDigest);
  // The deterministic answer is a fixture oracle, never effect admission.
  if (mode === "fixture") {
    assert.deepEqual(result, {
      summary: "Corrected normalizeRange and verified the complete suite.",
      changed_path: "src/range.mjs",
      final_source_sha256: EXPECTED_FINAL_DIGEST,
    });
    assert.deepEqual(Buffer.from(sourceBytes), Buffer.from(CORRECT_SOURCE));
  }
  return sourceDigest;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function decodeReplaceRequest(bytes) {
  const cursor = { value: 0 };
  const result = {
    path: decodeText(bytes, cursor),
    expected_sha256: decodeText(bytes, cursor),
    replacement: decodeText(bytes, cursor),
    rationale: decodeText(bytes, cursor),
  };
  assert.equal(cursor.value, bytes.length);
  return result;
}

function encodeText(value) {
  const bytes = Buffer.from(value);
  return concat(u32(bytes.length), bytes);
}

function decodeText(bytes, cursor) {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    decodeBytes(bytes, cursor),
  );
}

function decodeBytes(bytes, cursor) {
  const length = readU32(bytes, cursor);
  assert(length <= bytes.length - cursor.value);
  const result = Buffer.from(bytes.subarray(cursor.value, cursor.value + length));
  cursor.value += length;
  return result;
}

function readU32(bytes, cursor) {
  assert(cursor.value + 4 <= bytes.length);
  const value = Buffer.from(bytes).readUInt32LE(cursor.value);
  cursor.value += 4;
  return value;
}

function u32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

function concat(...parts) {
  return Buffer.concat(parts.map((part) => Buffer.from(part)));
}
