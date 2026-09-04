import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  assertWorldRootMatchesArchive,
  readBoundedRegularFile,
} from "../system_closure_v1/world_archive_binding.mjs";

const ROOT = "agent-v3.0.0-system-closure-v1";
const MAXIMUM_EXPANDED_ARCHIVE_BYTES = 2 * 1024 * 1024;
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
  "model_protocol_adapter.mjs",
  "process_state_census.mjs",
  "public_negatives.mjs",
  "public_verify.mjs",
  "release_identity.json",
  "repository_environment.mjs",
  "run.mjs",
  "runtime.mjs",
  "source-map.json",
  "system.bpi1",
  "world_archive_binding.mjs",
]);
const options = parseArgs(process.argv.slice(2));
const archive = await readBoundedRegularFile(
  options.archive,
  2 * 1024 * 1024,
  "Agent archive",
);
const checksum = (await readBoundedRegularFile(
  options.checksum,
  4096,
  "Agent archive checksum",
)).toString("utf8");
const receipt = JSON.parse((await readBoundedRegularFile(
  options.receipt,
  64 * 1024,
  "Agent receipt",
)).toString("utf8"));
const archiveSha256 = sha256(archive);
assert.equal(checksum, `${archiveSha256}  agent-v3.0.0-system-closure-v1.tar.gz\n`);
assert.equal(receipt.format, "agent-system-closure-artifact-receipt/v1");
assert.equal(receipt.status, "artifact-built");
assert.equal(receipt.archiveSha256, archiveSha256);
assert.equal(receipt.archiveByteLength, archive.byteLength);
assert.match(receipt.agentSourceCommit, /^[0-9a-f]{40}$/);
assert.equal(receipt.liveModelTestStatus, "not-run");
assert.equal(receipt.inventoryCount, expectedFiles.size);

const extractionRoot = await mkdtemp(join(tmpdir(), "agent-system-closure-distribution-"));
try {
  const files = parseTar(gunzipSync(archive, {
    maxOutputLength: MAXIMUM_EXPANDED_ARCHIVE_BYTES,
  }));
  assert.deepEqual(new Set(files.keys()), expectedFiles);
  for (const [name, bytes] of files) {
    const destination = join(extractionRoot, ROOT, name);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: "wx" });
  }
  const root = join(extractionRoot, ROOT);
  const checksums = parseChecksums(files.get("checksums.sha256"));
  assert.equal(sha256(files.get("checksums.sha256")), receipt.checksumsSha256);
  assert.equal(checksums.size, expectedFiles.size - 1);
  for (const name of expectedFiles) {
    if (name === "checksums.sha256") continue;
    assert.equal(checksums.get(name), sha256(files.get(name)), `checksum mismatch: ${name}`);
  }
  assert.equal(sha256(files.get("system.bpi1")), receipt.imageSha256);
  assert.equal(files.get("system.bpi1").byteLength, receipt.imageByteLength);
  assert.equal(sha256(files.get("initial-args.bin")), receipt.initialArgsSha256);
  assert.equal(files.get("initial-args.bin").byteLength, receipt.initialArgsByteLength);
  const sourceMap = JSON.parse(files.get("source-map.json").toString("utf8"));
  const releaseIdentityBytes = files.get("release_identity.json");
  const releaseIdentity = JSON.parse(releaseIdentityBytes.toString("utf8"));
  assert.equal(sha256(releaseIdentityBytes), receipt.releaseIdentitySha256);
  assert.equal(releaseIdentity.format, "agent-system-closure-release-identity/v1");
  assert.equal(releaseIdentity.agentVersion, receipt.agentVersion);
  assert.equal(releaseIdentity.agentSourceSha256, receipt.agentSourceSha256);
  assert.equal(releaseIdentity.agentArtifacts.imageSha256, receipt.imageSha256);
  assert.equal(releaseIdentity.agentArtifacts.imageByteLength, receipt.imageByteLength);
  assert.equal(releaseIdentity.agentArtifacts.initialArgsSha256, receipt.initialArgsSha256);
  assert.equal(releaseIdentity.agentArtifacts.initialArgsByteLength, receipt.initialArgsByteLength);
  assert.equal(releaseIdentity.agentArtifacts.sourceMapSha256, receipt.sourceMapSha256);
  assert.equal(
    releaseIdentity.agentArtifacts.programTransitionDigest,
    receipt.programTransitionIdentity,
  );
  assert.equal(releaseIdentity.boundary.version, receipt.boundaryVersion);
  assert.equal(releaseIdentity.boundary.releaseTag, receipt.boundaryReleaseTag);
  assert.equal(releaseIdentity.boundary.sourceCommit, receipt.boundarySourceCommit);
  assert.equal(releaseIdentity.boundary.packageUrl, receipt.boundaryPackageUrl);
  assert.equal(releaseIdentity.boundary.packageHash, receipt.boundaryPackageHash);
  assert.equal(releaseIdentity.world.version, receipt.worldVersion);
  assert.equal(releaseIdentity.world.releaseTag, receipt.worldReleaseTag);
  assert.equal(releaseIdentity.world.sourceCommit, receipt.worldSourceCommit);
  assert.equal(releaseIdentity.world.productionSourceSha256, receipt.worldProductionSourceSha256);
  assert.equal(releaseIdentity.world.archiveName, receipt.worldRuntimeArchiveName);
  assert.equal(releaseIdentity.world.archiveSha256, receipt.worldRuntimeArchiveSha256);
  assert.equal(releaseIdentity.world.archiveByteLength, receipt.worldRuntimeArchiveByteLength);
  assert.equal(releaseIdentity.kernel.sha256, receipt.kernelSha256);
  assert.equal(releaseIdentity.kernel.byteLength, receipt.kernelByteLength);
  assert.equal(releaseIdentity.kernel.importCount, receipt.kernelImportCount);
  assert.equal(releaseIdentity.kernel.abiVersion, receipt.kernelAbiVersion);
  assert.equal(sha256(files.get("source-map.json")), receipt.sourceMapSha256);
  assert.equal(sourceMap.format, "agent-bpi1-source-map/v1");
  assert.equal(sourceMap.imageSha256, receipt.imageSha256);
  assert.equal(sourceMap.programTransitionDigest, receipt.programTransitionIdentity);
  let execution = null;
  let publicVerification = null;
  let extractionBindingNegative = null;
  let extractionInventoryNegative = null;
  if (options.worldRoot !== undefined) {
    assert(options.worldArchive !== undefined, "--world-root requires --world-archive");
    const worldArchive = await readBoundedRegularFile(
      options.worldArchive,
      16 * 1024 * 1024,
      "World archive",
    );
    assert.equal(worldArchive.byteLength, receipt.worldRuntimeArchiveByteLength);
    assert.equal(sha256(worldArchive), receipt.worldRuntimeArchiveSha256);
    await assertWorldRootMatchesArchive({
      worldRoot: options.worldRoot,
      archiveBytes: worldArchive,
      worldVersion: releaseIdentity.world.version,
    });
    const workDir = join(extractionRoot, "work");
    await mkdir(workDir);
    const result = spawnSync(process.execPath, [
      join(root, "run.mjs"),
      "--world-root", resolve(options.worldRoot),
      "--world-archive", resolve(options.worldArchive),
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
    assert.equal(execution.runtimeInputSha256, receipt.runtimeInputSha256);
    assert.equal(execution.worldVersion, receipt.worldVersion);
    assert.equal(execution.worldSourceCommit, receipt.worldSourceCommit);
    assert.equal(execution.worldProductionSourceSha256, receipt.worldProductionSourceSha256);
    assert.equal(execution.worldRuntimeArchiveSha256, receipt.worldRuntimeArchiveSha256);
    assert.equal(execution.worldRuntimeArchiveByteLength, receipt.worldRuntimeArchiveByteLength);
    assert.equal(execution.kernelBoundarySourceCommit, receipt.boundarySourceCommit);
    assert.equal(execution.kernelSha256, receipt.kernelSha256);
    assert.equal(execution.kernelByteLength, receipt.kernelByteLength);
    assert(execution.reductions <= 512);
    assert.equal(execution.modelRequests, 8);
    assert.equal(execution.repositoryRequests, 7);
    assert.equal(execution.httpBodyEqualityCount, execution.modelRequests);
    assert.equal(execution.finalTree, "0d9ac8802aac6597cb0a443245efb6f92a0249fe");
    assert.equal(execution.terminalSha256,
      "36c4354afea674adb139253064d7d14563ab3296804ff7cbefbba508a93f1032");
    const publicWork = join(extractionRoot, "public-verification-work");
    await mkdir(publicWork);
    const publicResult = spawnSync(process.execPath, [
      join(root, "public_verify.mjs"),
      "--world-root", resolve(options.worldRoot),
      "--world-archive", resolve(options.worldArchive),
      "--agent-archive", resolve(options.archive),
      "--agent-receipt", resolve(options.receipt),
      "--work-root", publicWork,
      "--census-output", join(extractionRoot, "public-census.json"),
      "--negative-output", join(extractionRoot, "public-negatives.json"),
    ], {
      cwd: root,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
      timeout: 30 * 60 * 1000,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (publicResult.status !== 0) {
      throw new Error("public source-free verification failed: " + publicResult.stderr);
    }
    publicVerification = JSON.parse(
      publicResult.stdout.trim().split("\n").filter(Boolean).at(-1),
    );
    assert.equal(publicVerification.result, "passed");
    assert.equal(publicVerification.publicNegativeResult, "passed");
    assert.equal(publicVerification.dangerousRepositoryEffects, 0);
    assert.equal(publicVerification.prematureSuccessfulCompletions, 0);
    assert.equal(publicVerification.liveModelTestStatus, "not-run");

    const tamperedInitial = Buffer.from(files.get("initial-args.bin"));
    tamperedInitial[tamperedInitial.length - 1] ^= 1;
    await writeFile(join(root, "initial-args.bin"), tamperedInitial);
    const tamperedWork = join(extractionRoot, "tampered-extraction-work");
    await mkdir(tamperedWork);
    const tamperedResult = spawnSync(process.execPath, [
      join(root, "public_verify.mjs"),
      "--world-root", resolve(options.worldRoot),
      "--world-archive", resolve(options.worldArchive),
      "--agent-archive", resolve(options.archive),
      "--agent-receipt", resolve(options.receipt),
      "--work-root", tamperedWork,
      "--census-output", join(extractionRoot, "tampered-census.json"),
      "--negative-output", join(extractionRoot, "tampered-negatives.json"),
    ], {
      cwd: root,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
      timeout: 30 * 60 * 1000,
      maxBuffer: 8 * 1024 * 1024,
    });
    assert.notEqual(tamperedResult.status, 0, "tampered extraction was admitted");
    assert.match(tamperedResult.stderr, /executed bytes differ from archive: initial-args\.bin/);
    assert.deepEqual(await readdir(tamperedWork), []);
    extractionBindingNegative = "passed";

    await writeFile(join(root, "initial-args.bin"), files.get("initial-args.bin"));
    await writeFile(join(root, "fixture/test/unsigned.test.mjs"),
      "throw new Error('unsigned fixture code executed');\n");
    const unsignedWork = join(extractionRoot, "unsigned-extraction-work");
    await mkdir(unsignedWork);
    const unsignedResult = spawnSync(process.execPath, [
      join(root, "public_verify.mjs"),
      "--world-root", resolve(options.worldRoot),
      "--world-archive", resolve(options.worldArchive),
      "--agent-archive", resolve(options.archive),
      "--agent-receipt", resolve(options.receipt),
      "--work-root", unsignedWork,
      "--census-output", join(extractionRoot, "unsigned-census.json"),
      "--negative-output", join(extractionRoot, "unsigned-negatives.json"),
    ], {
      cwd: root,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
      timeout: 30 * 60 * 1000,
      maxBuffer: 8 * 1024 * 1024,
    });
    assert.notEqual(unsignedResult.status, 0, "unsigned extraction file was admitted");
    assert.match(unsignedResult.stderr, /executed root inventory differs from the authenticated archive/);
    assert.deepEqual(await readdir(unsignedWork), []);
    extractionInventoryNegative = "passed";
  }
  process.stdout.write(`${JSON.stringify({
    format: "agent-system-closure-distribution-check/v1",
    result: "passed",
    archiveSha256,
    archiveByteLength: archive.byteLength,
    inventoryCount: expectedFiles.size,
    sourceIndependentInventory: true,
    safeExtraction: true,
    extractionBindingNegative,
    extractionInventoryNegative,
    execution,
    publicVerification,
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
  const admitted = new Set(["archive", "checksum", "receipt", "worldRoot", "worldArchive"]);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    assert(key?.startsWith("--") && value !== undefined, "invalid arguments");
    const name = toCamel(key.slice(2));
    assert(admitted.has(name), "unknown distribution-check argument --" + key.slice(2));
    assert(!(name in result), "duplicate distribution-check argument --" + key.slice(2));
    result[name] = value;
  }
  for (const key of ["archive", "checksum", "receipt"]) {
    assert(key in result, "missing --" + key);
  }
  assert(
    (result.worldRoot === undefined) === (result.worldArchive === undefined),
    "--world-root and --world-archive must be supplied together",
  );
  return result;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}
