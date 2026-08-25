#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { inspectTarGz } from "../reference_stack.mjs";

const FORMAT = "agent-interpretation-runtime-dependencies-v1";
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_REDIRECTS = 8;
const ALLOWED_HOSTS = new Set([
  "codeload.github.com",
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com"
]);
const REQUIRED_PATHS = Object.freeze({
  worldHost: Object.freeze([
    "src/v1"
  ]),
  worldCapabilities: Object.freeze([
    "src/v1/errors.mjs",
    "src/v1/protocol.mjs",
    "src/v1/router.mjs",
    "src/v1/actuality/repository_repair_codecs.mjs",
    "src/v1/actuality/repository_repair_fixture_binding.mjs",
    "src/v1/actuality/repository_workspace_binding.mjs",
    "packages/repository-repair-decision-fixture",
    "packages/repository-workspace-actuality"
  ])
});

const options = parseArgs(process.argv.slice(2));
const lock = readLock(options.lock);
mkdirSync(options.output, { recursive: true });

await materialize("worldHost", lock.worldHost, options.worldHostRoot, options.worldHostArchive);
await materialize(
  "worldCapabilities",
  lock.worldCapabilities,
  options.worldCapabilitiesRoot,
  options.worldCapabilitiesArchive
);

async function materialize(kind, entry, rootOverride, archiveOverride) {
  const destination = join(options.output, kind === "worldHost" ? "world-host" : "world-capabilities");
  if (existsSync(destination)) throw new Error(`runtime dependency output already exists: ${destination}`);
  if (rootOverride !== null) {
    requirePaths(kind, rootOverride);
    copyRuntimeClosure(kind, rootOverride, destination);
    return;
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

  const archiveRoot = join(options.output, "archives");
  const extractionRoot = join(options.output, "extracted", kind);
  mkdirSync(archiveRoot, { recursive: true });
  mkdirSync(extractionRoot, { recursive: true });
  const archivePath = join(archiveRoot, `${kind}.tar.gz`);
  writeFileSync(archivePath, acquired.bytes, { flag: "wx" });
  inspectTarGz(archivePath, acquired.archive.root);
  run("tar", ["-xzf", archivePath, "-C", extractionRoot]);
  const source = join(extractionRoot, acquired.archive.root);
  requirePaths(kind, source);
  copyRuntimeClosure(kind, source, destination);
}

function copyRuntimeClosure(kind, source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const relativePath of REQUIRED_PATHS[kind]) {
    const target = join(destination, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(source, relativePath), target, { recursive: true, errorOnExist: true });
  }
}

function readLock(path) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (value?.format !== FORMAT) throw new Error(`unsupported runtime dependency lock: ${value?.format}`);
  for (const [kind, expectedRepository] of [
    ["worldHost", "tkersey/world-host"],
    ["worldCapabilities", "tkersey/world-capabilities"]
  ]) {
    const entry = value[kind];
    if (entry?.repository !== expectedRepository) throw new Error(`${kind} repository mismatch`);
    if (!/^\d+\.\d+\.\d+$/.test(entry.version)) throw new Error(`${kind} version is not canonical`);
    for (const archive of [entry.defaultArchive, ...(entry.overrideArchives ?? [])]) validateArchive(archive, kind);
  }
  return Object.freeze(value);
}

function validateArchive(archive, kind) {
  if (!archive || !/^[0-9a-f]{64}$/.test(archive.sha256) || typeof archive.root !== "string" || archive.root === "") {
    throw new Error(`${kind} archive binding is invalid`);
  }
  validatedUrl(archive.url, `${kind} archive URL`);
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

function requirePaths(kind, root) {
  for (const relative of REQUIRED_PATHS[kind]) {
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
