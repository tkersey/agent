#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { lstat, open, readFile, readlink, realpath, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultLockPath = fileURLToPath(new URL("../conformance/agent4/dependencies.lock.json", import.meta.url));

const flags = new Map([
  ["--world-runtime", "worldRuntime"],
  ["--image", "image"],
  ["--initial-args", "initialArgs"],
  ["--outcome", "outcome"],
  ["--reply", "reply"],
  ["--reason", "reason"],
  ["--out", "out"],
  ["--lock", "lock"],
]);

const commandFlags = {
  start: ["worldRuntime", "image", "initialArgs", "out"],
  resume: ["worldRuntime", "image", "outcome", "reply", "out"],
  inspect: ["worldRuntime", "outcome"],
  cancel: ["worldRuntime", "image", "outcome", "reason", "out"],
};

function flagName(name) {
  return [...flags].find(([, value]) => value === name)[0];
}

/** Parse only the documented command-specific interface, before any file I/O. */
export function parseArguments(argv) {
  if (!Array.isArray(argv) || argv.some((value) => typeof value !== "string")) {
    throw new TypeError("runner arguments must be strings");
  }
  const [command, ...rest] = argv;
  if (!Object.hasOwn(commandFlags, command)) {
    throw new Error("expected one runner command: start, resume, inspect, cancel");
  }
  const options = { command };
  const allowed = new Set([...commandFlags[command], "lock"]);
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const name = flags.get(flag);
    if (!name) throw new Error(`unknown runner argument ${flag}`);
    if (!allowed.has(name)) throw new Error(`${flag} is not accepted by ${command}`);
    if (Object.hasOwn(options, name)) throw new Error(`duplicate runner argument ${flag}`);
    const value = rest[index + 1];
    if (value === undefined || value.length === 0 || value.startsWith("--")) {
      throw new Error(`missing value for ${flag}`);
    }
    if (value.includes("\0")) throw new Error(`NUL is not allowed in ${flag}`);
    options[name] = value;
  }
  for (const name of commandFlags[command]) {
    if (!Object.hasOwn(options, name)) throw new Error(`missing required ${flagName(name)} for ${command}`);
  }
  return options;
}

// Resolve the existing prefix as well as dangling links. This prevents a missing
// output file or parent from concealing that the destination is under a runtime.
async function physicalPath(path, links = 0) {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let entry;
  try {
    entry = await lstat(absolute);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (entry?.isSymbolicLink()) {
    if (links >= 40) throw new Error("too many symbolic links in output path");
    return physicalPath(resolve(dirname(absolute), await readlink(absolute)), links + 1);
  }
  const parent = dirname(absolute);
  if (parent === absolute) throw new Error(`cannot resolve output path ${path}`);
  return join(await physicalPath(parent, links), basename(absolute));
}

function isWithin(path, directory) {
  const suffix = relative(directory, path);
  return suffix === "" || (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`));
}

async function inspectPaths(options) {
  const paths = { lock: await realpath(options.lock ?? defaultLockPath) };
  const protectedPaths = [];
  for (const name of ["lock", "worldRuntime", "image", "initialArgs", "outcome", "reply"]) {
    if (name !== "lock" && !Object.hasOwn(options, name)) continue;
    const path = name === "lock" ? paths.lock : await realpath(options[name]);
    const info = await stat(path);
    if (name !== "worldRuntime" && !info.isFile()) throw new Error(`${flagName(name)} must name a regular file`);
    paths[name] = path;
    protectedPaths.push({ name, path, info });
  }
  if (options.out !== undefined) {
    paths.out = await physicalPath(options.out);
    await protectOutput(paths.out, protectedPaths);
    const parent = await stat(dirname(paths.out));
    if (!parent.isDirectory()) throw new Error("output parent must be an existing directory");
  }
  return { paths, protectedPaths };
}

async function protectOutput(output, protectedPaths) {
  let outputInfo;
  try {
    outputInfo = await stat(output);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const protectedPath of protectedPaths) {
    if (
      output === protectedPath.path ||
      (protectedPath.info.isDirectory() && isWithin(output, protectedPath.path)) ||
      (outputInfo && outputInfo.dev === protectedPath.info.dev && outputInfo.ino === protectedPath.info.ino)
    ) {
      throw new Error(`output path must not overwrite or enter ${flagName(protectedPath.name)}`);
    }
  }
  if (outputInfo && !outputInfo.isFile()) throw new Error("output path must name a regular file");
}

async function writeCheckpoint(output, bytes, protectedPaths) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("World outcome has no canonical PKO2 bytes");
  // Use the resolved destination and recheck it before replacement. The runner
  // is single-writer; it does not provide distributed checkpoint locking.
  if (await physicalPath(output) !== output) throw new Error("output path changed during execution");
  await protectOutput(output, protectedPaths);
  const temporary = join(dirname(output), `.${basename(output)}.${randomUUID()}.tmp`);
  let handle;
  let replaced = false;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, output);
    replaced = true;
    const directory = await open(dirname(output), "r");
    try {
      await directory.sync();
    } catch (error) {
      throw new Error("checkpoint was written, but directory durability could not be confirmed", { cause: error });
    } finally {
      await directory.close();
    }
  } finally {
    if (handle) await handle.close();
    if (!replaced) await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

function jsonValue(value) {
  if (typeof value === "bigint") return { integer: value.toString(10) };
  if (value instanceof Uint8Array) return { encoding: "base64", bytes: Buffer.from(value).toString("base64") };
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, jsonValue(entry)]));
  }
  return value;
}

/** Run one World operation. Environmental effects are returned, never serviced. */
export async function executeCli(argv, { stdout = process.stdout } = {}) {
  const options = parseArguments(argv);
  const { paths, protectedPaths } = await inspectPaths(options);
  const { loadWorldRuntime } = await import("./world.mjs");
  const world = await loadWorldRuntime({ runtimePath: paths.worldRuntime, lockPath: paths.lock });

  let outcome;
  if (options.command === "start") {
    const [image, initialArgs] = await Promise.all([readFile(paths.image), readFile(paths.initialArgs)]);
    outcome = await world.start(image, initialArgs);
  } else {
    outcome = world.decodeOutcome(await readFile(paths.outcome));
    if (options.command === "resume") {
      if (outcome.kind !== "Requested" || !outcome.state || !outcome.request) {
        throw new Error("resume requires a Requested outcome with its saved State and current request");
      }
      const [image, reply] = await Promise.all([readFile(paths.image), readFile(paths.reply)]);
      outcome = await world.resume(image, outcome.state, outcome.request, reply);
    } else if (options.command === "cancel") {
      if (!outcome.state) throw new Error("cancel requires an outcome with saved State");
      outcome = await world.cancel(await readFile(paths.image), outcome.state, options.reason);
    }
  }

  if (options.command !== "inspect") await writeCheckpoint(paths.out, outcome.bytes, protectedPaths);
  const view = await world.inspectPending(outcome);
  const result = options.command === "inspect" ? view : { ...view, checkpoint: paths.out };
  stdout.write(`${JSON.stringify(jsonValue(result))}\n`);
  return outcome;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  executeCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`agent runner: ${error.message}\n`);
    process.exitCode = 1;
  });
}
