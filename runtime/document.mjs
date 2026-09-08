import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rmdir, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

const lockName = ".agent-document-lock";
const temporaryPrefix = ".agent-document-tmp-";
const queues = new Map();
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * Real document I/O for a caller-owned, isolated directory. Every cooperative
 * writer must use this environment's root lock. Calls in this process queue;
 * another process holding that lock returns `failure: busy`. A stale lock is
 * never stolen. The owner must establish that its writer has stopped before
 * removing it. This is neither distributed locking nor malicious-host defense.
 *
 * Admission errors reject before I/O. Environmental errors are typed results.
 * `uncertain` means replacement occurred, but durable completion could not be
 * established; callers must reconcile, never automatically repeat the write.
 */
export async function createDocumentEnvironment(options) {
  const { root } = record(options, ["root"], "document options");
  text(root, "root");
  if (!isAbsolute(root)) throw new TypeError("document root must be absolute");
  const suppliedRoot = resolve(root);
  const suppliedStat = await lstat(suppliedRoot);
  if (!suppliedStat.isDirectory() || suppliedStat.isSymbolicLink())
    throw new TypeError("document root must be an existing non-symlink directory");
  const directory = await realpath(suppliedRoot);
  const identity = await lstat(directory);
  if (!sameFile(suppliedStat, identity))
    throw new TypeError("document root changed during admission");

  async function checkRoot() {
    const current = await lstat(directory);
    if (!current.isDirectory() || !sameFile(current, identity))
      throw environmental("unsafe_path");
  }

  async function locate(path) {
    await checkRoot();
    const parts = path.split("/");
    let current = directory;
    for (const part of parts.slice(0, -1)) {
      current = join(current, part);
      const stat = await lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw environmental("unsafe_path");
    }
    const filename = join(current, parts.at(-1));
    const stat = await lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw environmental("unsafe_path");
    return { filename, parent: current, stat };
  }

  async function readCurrent(path) {
    const location = await locate(path);
    const handle = await open(location.filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.nlink !== 1 || !sameFile(before, location.stat))
        throw environmental("unsafe_path");
      const bytes = await handle.readFile();
      const after = await handle.stat();
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
          before.ctimeMs !== after.ctimeMs)
        throw environmental("concurrent_change");
      let content;
      try { content = utf8.decode(bytes); }
      catch { throw environmental("invalid_utf8"); }
      return { ...location, observation: Object.freeze({ content, digest: digest(bytes) }) };
    } finally {
      await handle.close();
    }
  }

  async function withLock(operation) {
    return serialized(directory, async () => {
      const lock = join(directory, lockName);
      let acquired = false;
      let result;
      try {
        await checkRoot();
        try { await mkdir(lock, { mode: 0o700 }); }
        catch (error) {
          if (error.code === "EEXIST") return failure("busy");
          throw error;
        }
        acquired = true;
        result = await operation();
      } catch (error) {
        result = failure(failureCode(error));
      } finally {
        if (acquired) {
          try { await rmdir(lock); }
          catch {
            result = Object.freeze({
              kind: result?.kind === "success" && result.committed ? "uncertain" :
                result?.kind === "uncertain" ? "uncertain" : "failure",
              code: "lock_release_failed",
            });
          }
        }
      }
      if (result?.committed) {
        const { committed, ...publicResult } = result;
        return Object.freeze(publicResult);
      }
      return result;
    });
  }

  async function read(input) {
    const { path } = record(input, ["path"], "document read");
    admitPath(path);
    return withLock(async () => {
      const current = await readCurrent(path);
      return Object.freeze({ kind: "success", observation: current.observation });
    });
  }

  async function replace(input) {
    const { path, base, replacement } = record(input,
      ["path", "base", "replacement"], "document replacement");
    admitPath(path);
    const { content, digest: baseDigest } = record(base, ["content", "digest"], "document base");
    text(content, "base content");
    text(replacement, "replacement");
    if (typeof baseDigest !== "string" || !/^[a-f0-9]{64}$/.test(baseDigest) ||
        digest(Buffer.from(content, "utf8")) !== baseDigest)
      throw new TypeError("base digest must match the exact UTF-8 base content");
    const replacementBytes = Buffer.from(replacement, "utf8");
    const observation = Object.freeze({ content: replacement, digest: digest(replacementBytes) });

    return withLock(async () => {
      let temporary;
      let committed = false;
      try {
        const current = await readCurrent(path);
        if (current.observation.content !== content || current.observation.digest !== baseDigest)
          return Object.freeze({ kind: "conflict", observation: current.observation });
        temporary = join(current.parent, `${temporaryPrefix}${randomUUID()}`);
        const handle = await open(temporary,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          current.stat.mode & 0o777);
        try {
          await handle.writeFile(replacementBytes);
          await handle.sync();
        } finally {
          await handle.close();
        }
        // Fail closed if a path or document changed while preparing the file.
        // The root lock supplies atomicity for all admitted cooperative writers.
        const latest = await readCurrent(path);
        if (!sameFile(current.stat, latest.stat) || latest.observation.content !== content ||
            latest.observation.digest !== baseDigest)
          return Object.freeze({ kind: "conflict", observation: latest.observation });
        await rename(temporary, current.filename);
        committed = true;
        temporary = undefined;
        const parent = await open(current.parent,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        try { await parent.sync(); }
        finally { await parent.close(); }
        return Object.freeze({ kind: "success", observation, committed: true });
      } catch (error) {
        return Object.freeze({ kind: committed ? "uncertain" : "failure", code: failureCode(error) });
      } finally {
        if (temporary !== undefined) {
          try { await unlink(temporary); }
          catch (error) {
            if (error.code !== "ENOENT") throw environmental("temporary_cleanup_failed");
          }
        }
      }
    });
  }

  return Object.freeze({ read, replace });
}

function record(value, fields, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new TypeError(`${name} must be an object`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key)) ||
      fields.some((key) => !Object.hasOwn(descriptors, key) || !("value" in descriptors[key])))
    throw new TypeError(`${name} requires exactly: ${fields.join(", ")}`);
  return Object.fromEntries(fields.map((key) => [key, descriptors[key].value]));
}

function text(value, name) {
  if (typeof value !== "string" || !value.isWellFormed())
    throw new TypeError(`${name} must be well-formed Unicode text`);
}

function admitPath(path) {
  text(path, "document path");
  if (!path || isAbsolute(path) || /^[A-Za-z]:/.test(path) || /[\\\0]/.test(path) ||
      path.split("/").some((part) => !part || part === "." || part === ".." ||
        part === lockName || part.startsWith(temporaryPrefix)))
    throw new TypeError("document path must be an unambiguous relative file path");
}

function sameFile(a, b) { return a.dev === b.dev && a.ino === b.ino; }
function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function environmental(code) { return Object.assign(new Error(code), { documentCode: code }); }
function failure(code) { return Object.freeze({ kind: "failure", code }); }
function failureCode(error) {
  if (error.documentCode) return error.documentCode;
  switch (error.code) {
    case "ENOENT": return "not_found";
    case "EACCES": case "EPERM": return "denied";
    case "ELOOP": case "ENOTDIR": case "EISDIR": return "unsafe_path";
    case "ENOSPC": case "EDQUOT": return "storage_full";
    default: return "io_failure";
  }
}

async function serialized(root, operation) {
  const previous = queues.get(root) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  queues.set(root, current);
  await previous;
  try { return await operation(); }
  finally {
    release();
    if (queues.get(root) === current) queues.delete(root);
  }
}
