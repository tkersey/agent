import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const ROOT = "agent-v3.0.0-system-closure-v1";
const expectedFiles = new Set([
  "LICENSE",
  "README.md",
  "checksums.sha256",
  "fixture/README.md",
  "fixture/package.json",
  "fixture/src/range.mjs",
  "fixture/test/range.test.mjs",
  "fixture_model_server.mjs",
  "initial-args.bin",
  "model_transport.mjs",
  "repository_environment.mjs",
  "run.mjs",
  "runtime.mjs",
  "system.bpi1",
]);
const options = parseArgs(process.argv.slice(2));
const archive = await readFile(options.archive);
const checksum = await readFile(options.checksum, "utf8");
const receipt = JSON.parse(await readFile(options.receipt, "utf8"));
const archiveSha256 = sha256(archive);
assert.equal(checksum, `${archiveSha256}  agent-v3.0.0-system-closure-v1.tar.gz\n`);
assert.equal(receipt.format, "agent-system-closure-receipt/v1");
assert.equal(receipt.archiveSha256, archiveSha256);
assert.equal(receipt.archiveByteLength, archive.byteLength);

const extractionRoot = await mkdtemp(join(tmpdir(), "agent-system-closure-distribution-"));
try {
  const files = parseTar(gunzipSync(archive));
  assert.deepEqual(new Set(files.keys()), expectedFiles);
  for (const [name, bytes] of files) {
    const destination = join(extractionRoot, ROOT, name);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: "wx" });
  }
  const root = join(extractionRoot, ROOT);
  const checksums = parseChecksums(files.get("checksums.sha256"));
  assert.equal(checksums.size, expectedFiles.size - 1);
  for (const name of expectedFiles) {
    if (name === "checksums.sha256") continue;
    assert.equal(checksums.get(name), sha256(files.get(name)), `checksum mismatch: ${name}`);
  }
  assert.equal(sha256(files.get("system.bpi1")), receipt.imageSha256);
  assert.equal(files.get("system.bpi1").byteLength, receipt.imageByteLength);
  assert.equal(sha256(files.get("initial-args.bin")), receipt.initialArgsSha256);
  assert.equal(files.get("initial-args.bin").byteLength, receipt.initialArgsByteLength);
  let execution = null;
  if (options.worldRoot !== undefined) {
    const workDir = join(extractionRoot, "work");
    await mkdir(workDir);
    const result = spawnSync(process.execPath, [
      join(root, "run.mjs"),
      "--world-root", resolve(options.worldRoot),
      "--mode", "fixture",
      "--work-dir", workDir,
    ], {
      cwd: root,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
      timeout: 30 * 60 * 1000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.status !== 0) {
      throw new Error(`source-free fixture failed: status=${result.status} signal=${result.signal}\n${result.stderr}`);
    }
    execution = JSON.parse(result.stdout.trim().split("\n").filter(Boolean).at(-1));
    assert.equal(execution.result, "passed");
    assert.equal(execution.imageSha256, receipt.imageSha256);
    assert.equal(execution.initialArgsSha256, receipt.initialArgsSha256);
    assert.equal(execution.kernelSha256, receipt.boundary.kernelSha256);
    assert.equal(execution.reductions, receipt.observedReductionCount);
    assert.equal(execution.modelRequests, receipt.observedModelRequestCount);
    assert.deepEqual(
      execution.requestBodySha256,
      receipt.observedModelRequestBodySha256,
    );
    assert.equal(execution.repositoryRequests, receipt.observedRepositoryRequestCount);
    assert.equal(execution.finalTree, receipt.repository.finalTree);
    assert.equal(execution.terminalSha256, receipt.terminalResultSha256);
  }
  process.stdout.write(`${JSON.stringify({
    format: "agent-system-closure-distribution-check/v1",
    result: "passed",
    archiveSha256,
    archiveByteLength: archive.byteLength,
    inventoryCount: expectedFiles.size,
    sourceIndependentInventory: true,
    safeExtraction: true,
    execution,
  })}\n`);
} finally {
  await rm(extractionRoot, { recursive: true, force: true });
}

function parseTar(bytes) {
  const files = new Map();
  let offset = 0;
  let entryCount = 0;
  let expandedBytes = 0;
  while (offset + 512 <= bytes.byteLength) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    assert(entryCount++ < 64, "archive entry limit exceeded");
    const name = field(header, 0, 100);
    assert(name.startsWith(`${ROOT}/`), `unexpected archive root: ${name}`);
    assert(!name.includes("\\") && !name.includes("\0") && !name.startsWith("/"));
    const relativeName = name.slice(ROOT.length + 1).replace(/\/$/, "");
    assert(relativeName.length > 0 && !relativeName.split("/").includes(".."));
    const size = readOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const storedChecksum = readOctal(header, 148, 8);
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    assert.equal(checksumHeader.reduce((sum, byte) => sum + byte, 0), storedChecksum);
    offset += 512;
    assert(size <= bytes.byteLength - offset);
    if (type === "0") {
      assert(!files.has(relativeName), `duplicate archive path: ${relativeName}`);
      expandedBytes += size;
      assert(expandedBytes <= 2 * 1024 * 1024, "archive expansion limit exceeded");
      files.set(relativeName, Buffer.from(bytes.subarray(offset, offset + size)));
    } else {
      assert.equal(type, "5", `archive links and special entries are forbidden: ${name}`);
      assert.equal(size, 0);
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return files;
}

function parseChecksums(bytes) {
  const result = new Map();
  for (const line of bytes.toString("utf8").trimEnd().split("\n")) {
    const match = /^([0-9a-f]{64})  ([^/].*)$/.exec(line);
    assert(match !== null, `invalid checksum line: ${line}`);
    assert(!result.has(match[2]), `duplicate checksum path: ${match[2]}`);
    result.set(match[2], match[1]);
  }
  return result;
}

function field(bytes, offset, length) {
  const end = bytes.indexOf(0, offset);
  const limit = end === -1 || end > offset + length ? offset + length : end;
  return bytes.subarray(offset, limit).toString("utf8");
}

function readOctal(bytes, offset, length) {
  const value = field(bytes, offset, length).trim();
  assert(/^[0-7]+$/.test(value));
  const result = Number.parseInt(value, 8);
  assert(Number.isSafeInteger(result) && result >= 0);
  return result;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    assert(key?.startsWith("--") && value !== undefined, "invalid arguments");
    result[toCamel(key.slice(2))] = value;
  }
  for (const key of ["archive", "checksum", "receipt"]) assert(key in result, `missing --${key}`);
  return result;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}
