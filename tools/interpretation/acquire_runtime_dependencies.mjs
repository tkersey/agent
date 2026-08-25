#!/usr/bin/env bun
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { inspectTarGz } from "../reference_stack.mjs";
import { runtimeDependencyDigest } from "./dependency_digest.mjs";
import {
  readRuntimeDependencyLock,
  RUNTIME_DEPENDENCY_FORMAT
} from "./runtime_dependency_lock.mjs";

const FORMAT = RUNTIME_DEPENDENCY_FORMAT;
const OUTPUT_SENTINEL = ".agent-interpretation-runtime-dependencies-v1";
const OWNED_OUTPUT_ENTRIES = new Set([
  OUTPUT_SENTINEL,
  "archives",
  "extracted",
  "world-capabilities",
  "world-host"
]);
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_REDIRECTS = 8;
const ALLOWED_HOSTS = new Set([
  "codeload.github.com",
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com"
]);
const parsedOptions = parseArgs(process.argv.slice(2));
const lock = readRuntimeDependencyLock(parsedOptions.lock);
validateArchiveUrls(lock);
const publication = inspectPublicationTarget(parsedOptions.output);
if (publication.state === "owned") {
  await verifyRuntimeAt("worldHost", lock.worldHost, publication.output);
  await verifyRuntimeAt("worldCapabilities", lock.worldCapabilities, publication.output);
} else {
  const [worldHost, worldCapabilities] = await Promise.all([
    acquire("worldHost", lock.worldHost, parsedOptions.worldHostRoot, parsedOptions.worldHostArchive),
    acquire(
      "worldCapabilities",
      lock.worldCapabilities,
      parsedOptions.worldCapabilitiesRoot,
      parsedOptions.worldCapabilitiesArchive
    )
  ]);
  mkdirSync(publication.parent, { recursive: true });
  if (realpathSync(publication.parent) !== publication.parent) {
    throw new Error(`runtime dependency output has a symlink ancestor: ${publication.output}`);
  }
  const staging = mkdtempSync(join(publication.parent, `.${publication.basename}.staging-`));
  try {
    materialize("worldHost", worldHost, staging);
    materialize("worldCapabilities", worldCapabilities, staging);
    await verifyRuntimeAt("worldHost", lock.worldHost, staging);
    await verifyRuntimeAt("worldCapabilities", lock.worldCapabilities, staging);
    writeFileSync(join(staging, OUTPUT_SENTINEL), `${FORMAT}\n`, { flag: "wx" });
    publishOutput(publication, staging);
  } finally {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
  }
}

function inspectPublicationTarget(output) {
  const absolute = resolve(output);
  const parent = dirname(absolute);
  requireCanonicalExistingAncestor(parent, absolute);
  let state = "absent";
  if (existsSync(absolute)) {
    const metadata = lstatSync(absolute);
    if (metadata.isSymbolicLink() || !metadata.isDirectory() || realpathSync(absolute) !== absolute) {
      throw new Error(`runtime dependency output is not a canonical directory: ${output}`);
    }
    const entries = readdirSync(absolute);
    state = entries.length === 0 ? "empty" : "owned";
    if (state === "owned") requireOwnedOutput(absolute);
  }
  return Object.freeze({ output: absolute, parent, basename: basename(absolute), state });
}

function requireCanonicalExistingAncestor(path, output) {
  let ancestor = resolve(path);
  while (!existsSync(ancestor)) {
    const next = dirname(ancestor);
    if (next === ancestor) throw new Error(`runtime dependency output has no existing ancestor: ${output}`);
    ancestor = next;
  }
  const metadata = lstatSync(ancestor);
  if (metadata.isSymbolicLink() || !metadata.isDirectory() || realpathSync(ancestor) !== ancestor) {
    throw new Error(`runtime dependency output has a symlink ancestor: ${output}`);
  }
}

function requireOwnedOutput(output) {
  const entries = readdirSync(output);
  const entriesOwned = entries.every((entry) => OWNED_OUTPUT_ENTRIES.has(entry));
  const sentinel = join(output, OUTPUT_SENTINEL);
  const sentinelValid = entries.includes(OUTPUT_SENTINEL) &&
    !lstatSync(sentinel).isSymbolicLink() && lstatSync(sentinel).isFile() &&
    readFileSync(sentinel, "utf8") === `${FORMAT}\n`;
  const childrenValid = entries.filter((entry) => entry !== OUTPUT_SENTINEL)
    .every((entry) => {
      const metadata = lstatSync(join(output, entry));
      return !metadata.isSymbolicLink() && metadata.isDirectory();
    });
  if (!entriesOwned || !childrenValid || !sentinelValid) {
    throw new Error(`runtime dependency output is not owned: ${output}`);
  }
}

function publishOutput(publication, staging) {
  if (publication.state === "absent") {
    renameSync(staging, publication.output);
    return;
  }
  if (publication.state === "empty") {
    rmdirSync(publication.output);
    try {
      renameSync(staging, publication.output);
    } catch (error) {
      mkdirSync(publication.output);
      throw error;
    }
    return;
  }
}

async function acquire(kind, entry, rootOverride, archiveOverride) {
  if (rootOverride !== null) {
    requirePaths(kind, rootOverride, entry.runtimePaths);
    return Object.freeze({ entry, root: rootOverride, bytes: null, archive: null });
  }
  const candidates = [entry.defaultArchive, ...entry.overrideArchives];
  const acquired = archiveOverride === null
    ? { bytes: await download(entry.defaultArchive.url), archive: entry.defaultArchive }
    : selectLocalArchive(archiveOverride, candidates);
  if (acquired.bytes.length > MAX_ARCHIVE_BYTES) throw new Error(`${kind} archive exceeds byte limit`);
  const actual = sha256(acquired.bytes);
  if (actual !== acquired.archive.sha256) {
    throw new Error(`${kind} archive checksum mismatch: expected=${acquired.archive.sha256} actual=${actual}`);
  }
  return Object.freeze({ entry, root: null, ...acquired });
}

function materialize(kind, acquired, output) {
  const destination = join(output, kind === "worldHost" ? "world-host" : "world-capabilities");
  if (existsSync(destination)) throw new Error(`runtime dependency output already exists: ${destination}`);
  if (acquired.root !== null) {
    copyRuntimeClosure(acquired.root, destination, acquired.entry.runtimePaths);
    return;
  }
  const archiveRoot = join(output, "archives");
  const extractionRoot = join(output, "extracted", kind);
  mkdirSync(archiveRoot, { recursive: true });
  mkdirSync(extractionRoot, { recursive: true });
  const archivePath = join(archiveRoot, `${kind}.tar.gz`);
  writeFileSync(archivePath, acquired.bytes, { flag: "wx" });
  inspectTarGz(archivePath, acquired.archive.root);
  run("tar", ["-xzf", archivePath, "-C", extractionRoot]);
  const source = join(extractionRoot, acquired.archive.root);
  requirePaths(kind, source, acquired.entry.runtimePaths);
  copyRuntimeClosure(source, destination, acquired.entry.runtimePaths);
}

async function verifyRuntimeAt(kind, entry, output) {
  const directory = kind === "worldHost" ? "world-host" : "world-capabilities";
  const digest = await runtimeDependencyDigest(join(output, directory), entry.runtimePaths);
  if (digest.sha256 !== entry.runtimeSha256) {
    throw new Error(`${kind} runtime digest mismatch: expected=${entry.runtimeSha256} actual=${digest.sha256}`);
  }
}

function copyRuntimeClosure(source, destination, runtimePaths) {
  mkdirSync(destination, { recursive: true });
  for (const relativePath of runtimePaths) {
    const target = join(destination, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(source, relativePath), target, { recursive: true, errorOnExist: true });
  }
}

function validateArchiveUrls(lock) {
  for (const [kind, entry] of [["worldHost", lock.worldHost], ["worldCapabilities", lock.worldCapabilities]]) {
    for (const archive of [entry.defaultArchive, ...entry.overrideArchives]) {
      validatedUrl(archive.url, `${kind} archive URL`);
    }
  }
}

function selectLocalArchive(path, candidates) {
  const bytes = readFileSync(path);
  const actual = sha256(bytes);
  const archive = candidates.find((candidate) => candidate.sha256 === actual);
  if (archive === undefined) throw new Error(`runtime dependency archive is not admitted: ${actual}`);
  return Object.freeze({ bytes, archive });
}

async function download(initial) {
  let current = validatedUrl(initial, "runtime dependency URL");
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetch(current, { redirect: "manual", headers: { Accept: "application/octet-stream" } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location === null) throw new Error(`runtime dependency redirect has no location: ${current.href}`);
      current = validatedUrl(new URL(location, current).href, "runtime dependency redirect");
      continue;
    }
    if (!response.ok) throw new Error(`runtime dependency download failed: ${current.href} HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  throw new Error("runtime dependency redirect limit exceeded");
}

function validatedUrl(value, label) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || !ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error(`${label} is not an admitted unauthenticated GitHub HTTPS URL`);
  }
  return url;
}

function requirePaths(kind, root, runtimePaths) {
  for (const relative of runtimePaths) {
    if (!existsSync(join(root, relative))) throw new Error(`${kind} runtime dependency is missing ${relative}`);
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
}

function parseArgs(argv) {
  const result = {
    lock: null,
    output: null,
    worldHostRoot: null,
    worldCapabilitiesRoot: null,
    worldHostArchive: null,
    worldCapabilitiesArchive: null
  };
  const names = new Set([
    "--lock",
    "--output",
    "--world-host-root",
    "--world-capabilities-root",
    "--world-host-archive",
    "--world-capabilities-archive"
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!names.has(argument) || index + 1 >= argv.length) throw new Error(`invalid argument: ${argument}`);
    const key = argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    result[key] = resolve(argv[index += 1]);
  }
  if (result.lock === null || result.output === null) throw new Error("--lock and --output are required");
  return Object.freeze(result);
}
