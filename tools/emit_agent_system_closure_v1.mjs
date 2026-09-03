import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ARCHIVE_NAME = "agent-v3.0.0-system-closure-v1.tar.gz";
const ROOT = "agent-v3.0.0-system-closure-v1";
const options = parseArgs(process.argv.slice(2));
const agentRoot = resolve(options.agentRoot);
const boundaryRoot = resolve(options.boundaryRoot);
const agentGit = gitFacts(agentRoot);
assert.equal(agentGit.clean, true,
  "active Agent source tree contains uncommitted changes");
const buildManifest = await readFile(join(agentRoot, "build.zig.zon"), "utf8");
const boundarySourceMatch = buildManifest.match(/boundary\/archive\/([0-9a-f]{40})\.tar\.gz/);
assert(boundarySourceMatch !== null, "Boundary source commit is absent from build.zig.zon");
const boundarySourceCommit = boundarySourceMatch[1];
const boundaryHashMatch = buildManifest.match(/\.hash = "(boundary-[^"]+)"/);
assert(boundaryHashMatch !== null, "Boundary package hash is absent from build.zig.zon");
const boundaryPackageHash = boundaryHashMatch[1];
const boundaryHashCache = await mkdtemp(join(tmpdir(), "agent-boundary-hash-"));
let activeBoundaryPackageHash;
try {
  activeBoundaryPackageHash = run(options.zigExecutable, [
    "fetch",
    "--global-cache-dir",
    boundaryHashCache,
    boundaryRoot,
  ], agentRoot).trim();
} finally {
  await rm(boundaryHashCache, { recursive: true, force: true });
}
assert.equal(activeBoundaryPackageHash, boundaryPackageHash,
  "active Boundary package contents differ from the locked package hash");
const boundaryGit = await lstat(join(boundaryRoot, ".git")).then(
  () => gitFacts(boundaryRoot),
  (error) => error?.code === "ENOENT" ? null : Promise.reject(error),
);
if (boundaryGit !== null) {
  assert.equal(boundaryGit.commit, boundarySourceCommit,
    "active Boundary fork commit differs from the locked dependency");
  assert.equal(boundaryGit.clean, true,
    "active Boundary fork contains uncommitted compiler changes");
} else {
  assert(boundaryRoot.includes("/zig-pkg/boundary-"),
    "unversioned Boundary dependency root is not admissible for emission");
}
const image = await readFile(options.image);
const initialArgs = await readFile(options.initialArgs);
const sourceMap = await readFile(options.sourceMap);
assert.equal(image.subarray(0, 8).toString("ascii"), "ABL_BPI1");

const files = new Map();
files.set("system.bpi1", image);
files.set("initial-args.bin", initialArgs);
files.set("source-map.json", sourceMap);
files.set("LICENSE", await readFile(join(agentRoot, "LICENSE")));
files.set("README.md", await readFile(join(agentRoot, "system_closure_v1/README.md")));
for (const name of [
  "run.mjs",
  "runtime.mjs",
  "model_protocol_adapter.mjs",
  "fixture_model_server.mjs",
  "repository_environment.mjs",
  "process_state_census.mjs",
]) {
  files.set(name, await readFile(join(agentRoot, "system_closure_v1", name)));
}
await addTree(files, join(agentRoot, "fixtures/repository-repair-v1"), "fixture");
const runtimeInputSha256 = digestRuntimeInputs(files);
assert.equal(proof.runtimeInputSha256, runtimeInputSha256, "fixture proof runtime inputs are stale");
const inventory = [...files.keys()].sort(compareUtf8);
const checksums = inventory.map((name) => `${sha256(files.get(name))}  ${name}`).join("\n") + "\n";
files.set("checksums.sha256", Buffer.from(checksums));

const archive = gzipSync(buildTar(files), { level: 9, mtime: 0 });
const archiveSha256 = sha256(archive);
const receipt = {
  format: "agent-system-closure-artifact-receipt/v1",
  status: "artifact-built",
  publicationStatus: "pending-owner-authorization",
  agentVersion: "3.0.0",
  agentSourceCommit: agentGit.commit,
  agentSourceClean: agentGit.clean,
  boundary: {
    version: "1.8.0-candidate",
    sourceCommit: boundarySourceCommit,
    packageHash: boundaryPackageHash,
    sourceResolution: boundaryGit === null ? "locked-package" : "exact-clean-git",
  },
  imageSha256: sha256(image),
  imageByteLength: image.byteLength,
  programTransitionIdentity: image.subarray(32, 64).toString("hex"),
  initialArgsSha256: sha256(initialArgs),
  initialArgsByteLength: initialArgs.byteLength,
  sourceMapSha256: sha256(sourceMap),
  runtimeInputSha256,
  archiveName: ARCHIVE_NAME,
  archiveSha256,
  archiveByteLength: archive.byteLength,
};
const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
await Promise.all([
  writeOutput(options.archive, archive),
  writeOutput(options.checksum, Buffer.from(`${archiveSha256}  ${ARCHIVE_NAME}\n`)),
  writeOutput(options.receipt, receiptBytes),
]);

async function addTree(target, sourceRoot, archiveRoot) {
  for (const entry of (await readdir(sourceRoot, { withFileTypes: true })).sort((a, b) => compareUtf8(a.name, b.name))) {
    const source = join(sourceRoot, entry.name);
    const destination = `${archiveRoot}/${entry.name}`;
    const stat = await lstat(source);
    assert(!stat.isSymbolicLink(), `archive source link is forbidden: ${source}`);
    if (entry.isDirectory()) await addTree(target, source, destination);
    else if (entry.isFile()) target.set(destination, await readFile(source));
    else throw new Error(`unsupported archive source: ${source}`);
  }
}

function buildTar(files) {
  const chunks = [];
  const directories = new Set();
  for (const name of files.keys()) {
    const parts = name.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(`${ROOT}/${parts.slice(0, index).join("/")}/`);
    }
  }
  for (const name of [...directories].sort(compareUtf8)) chunks.push(tarEntry(name, Buffer.alloc(0), 0o755, "5"));
  for (const name of [...files.keys()].sort(compareUtf8)) {
    const mode = name === "run.mjs" ? 0o755 : 0o644;
    chunks.push(tarEntry(`${ROOT}/${name}`, files.get(name), mode, "0"));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function tarEntry(name, contents, mode, type) {
  assert(Buffer.byteLength(name) <= 100, `archive path is too long: ${name}`);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  octal(header, 100, 8, mode);
  octal(header, 108, 8, 0);
  octal(header, 116, 8, 0);
  octal(header, 124, 12, contents.byteLength);
  octal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header.write(type, 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  header.write("root", 265, 32, "ascii");
  header.write("root", 297, 32, "ascii");
  octal(header, 329, 8, 0);
  octal(header, 337, 8, 0);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const encoded = checksum.toString(8).padStart(6, "0");
  header.write(encoded, 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;
  const padding = Buffer.alloc((512 - (contents.byteLength % 512)) % 512);
  return Buffer.concat([header, contents, padding]);
}

function octal(target, offset, length, value) {
  const encoded = value.toString(8).padStart(length - 1, "0");
  assert(encoded.length < length);
  target.write(encoded, offset, length - 1, "ascii");
  target[offset + length - 1] = 0;
}

function gitFacts(cwd) {
  const commit = run("git", ["rev-parse", "HEAD"], cwd).trim();
  const status = run("git", ["status", "--porcelain", "--untracked-files=all"], cwd);
  return Object.freeze({ commit, clean: status.length === 0 });
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: { PATH: process.env.PATH ?? "" } });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
  return result.stdout;
}

async function writeOutput(path, bytes) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, bytes);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function digestRuntimeInputs(files) {
  const records = [...files.entries()]
    .filter(([name]) => name.endsWith(".mjs") || name.startsWith("fixture/"))
    .sort(([left], [right]) => compareUtf8(left, right))
    .map(([name, bytes]) => [name, sha256(bytes)]);
  return sha256(Buffer.from(JSON.stringify(records)));
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    assert(key?.startsWith("--") && value !== undefined, "invalid arguments");
    result[toCamel(key.slice(2))] = value;
  }
  for (const key of [
    "agentRoot",
    "boundaryRoot",
    "zigExecutable",
    "image",
    "initialArgs",
    "sourceMap",
    "archive",
    "checksum",
    "receipt",
  ]) {
    assert(key in result, `missing --${key}`);
  }
  return result;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}
