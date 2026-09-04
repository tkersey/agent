import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  agentSourceSha256FromTree,
  gitRegularTree,
} from "./release_source_identity.mjs";
import {
  assertWorldRootMatchesArchive,
  readBoundedRegularFile,
} from "../system_closure_v1/world_archive_binding.mjs";

const ARCHIVE_NAME = "agent-v3.0.0-system-closure-v1.tar.gz";
const ROOT = "agent-v3.0.0-system-closure-v1";
const options = parseArgs(process.argv.slice(2));
const agentRoot = resolve(options.agentRoot);
const boundaryRoot = resolve(options.boundaryRoot);
const worldRoot = resolve(options.worldRoot);
const worldArchivePath = resolve(options.worldArchive);
const agentGit = gitFacts(agentRoot);
assert.equal(agentGit.clean, true,
  "active Agent source tree contains uncommitted changes");
assertNoHiddenIndexFlags(agentRoot);
assertNoIgnoredSourceInputs(agentRoot);
const agentTree = gitRegularTree(agentRoot, undefined, agentGit.commit);
const agentFile = (path) => {
  const bytes = agentTree.get(path);
  assert(bytes !== undefined, `release source is absent from HEAD: ${path}`);
  return bytes;
};
const buildManifest = agentFile("build.zig.zon").toString("utf8");
const releaseIdentityBytes = agentFile("system_closure_v1/release_identity.json");
const releaseIdentity = parseReleaseIdentity(releaseIdentityBytes);
assert.equal(
  agentSourceSha256FromTree(agentTree),
  releaseIdentity.agentSourceSha256,
  "Agent source domain differs from the committed release identity",
);
const boundarySourceMatch = buildManifest.match(/boundary\/archive\/([0-9a-f]{40})\.tar\.gz/);
assert(boundarySourceMatch !== null, "Boundary source commit is absent from build.zig.zon");
const boundarySourceCommit = boundarySourceMatch[1];
assert.equal(boundarySourceCommit, releaseIdentity.boundary.sourceCommit,
  "Boundary source commit differs from the release identity");
const boundaryHashMatch = buildManifest.match(/\.hash = "(boundary-[^"]+)"/);
assert(boundaryHashMatch !== null, "Boundary package hash is absent from build.zig.zon");
const boundaryPackageHash = boundaryHashMatch[1];
assert.equal(boundaryPackageHash, releaseIdentity.boundary.packageHash,
  "Boundary package hash differs from the release identity");
assert(buildManifest.includes(
  '.url = "' + releaseIdentity.boundary.packageUrl + '"',
), "Boundary package URL differs from the release identity");
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
const worldArchive = await readBoundedRegularFile(
  worldArchivePath,
  releaseIdentity.world.archiveByteLength,
  "World runtime archive",
);
assert.equal(basename(worldArchivePath), releaseIdentity.world.archiveName,
  "World archive name differs from the release identity");
assert.equal(worldArchive.byteLength, releaseIdentity.world.archiveByteLength,
  "World archive length differs from the release identity");
assert.equal(sha256(worldArchive), releaseIdentity.world.archiveSha256,
  "World archive digest differs from the release identity");
await assertWorldRootMatchesArchive({
  worldRoot,
  archiveBytes: worldArchive,
  worldVersion: releaseIdentity.world.version,
});
const worldManifest = JSON.parse(await readFile(
  join(worldRoot, "runtime-manifest.json"),
  "utf8",
));
assert.deepEqual(worldManifest, {
  format: "world-process-host-runtime/v1",
  worldVersion: releaseIdentity.world.version,
  processKernelAbiVersion: releaseIdentity.kernel.abiVersion,
  boundaryVersion: releaseIdentity.boundary.version,
  boundaryCommit: releaseIdentity.boundary.sourceCommit,
  kernelSha256: releaseIdentity.kernel.sha256,
  kernelByteLength: releaseIdentity.kernel.byteLength,
  kernelImportCount: releaseIdentity.kernel.importCount,
  sourceCommit: releaseIdentity.world.sourceCommit,
  productionSourceSha256: releaseIdentity.world.productionSourceSha256,
});
assert.equal(
  await digestWorldProductionSource(worldRoot),
  releaseIdentity.world.productionSourceSha256,
  "World production source differs from the release identity",
);
const worldKernel = await readFile(join(worldRoot, "boundary-process-kernel-v1.wasm"));
assert.equal(worldKernel.byteLength, releaseIdentity.kernel.byteLength);
assert.equal(sha256(worldKernel), releaseIdentity.kernel.sha256);
const worldKernelModule = await WebAssembly.compile(worldKernel);
assert.equal(
  WebAssembly.Module.imports(worldKernelModule).length,
  releaseIdentity.kernel.importCount,
);
const worldKernelInstance = await WebAssembly.instantiate(worldKernelModule, {});
assert.equal(
  worldKernelInstance.exports.boundary_process_kernel_abi_version(),
  releaseIdentity.kernel.abiVersion,
);
const image = await readBoundedRegularFile(
  options.image,
  16 * 1024 * 1024,
  "Agent Program image",
);
const initialArgs = await readBoundedRegularFile(
  options.initialArgs,
  1024 * 1024,
  "Agent InitialArgs",
);
const sourceMap = await readBoundedRegularFile(
  options.sourceMap,
  16 * 1024 * 1024,
  "Agent source map",
);
assert.equal(image.subarray(0, 8).toString("ascii"), "ABL_BPI1");
const agentArtifacts = {
  imageSha256: sha256(image),
  imageByteLength: image.byteLength,
  initialArgsSha256: sha256(initialArgs),
  initialArgsByteLength: initialArgs.byteLength,
  sourceMapSha256: sha256(sourceMap),
  programTransitionDigest: image.subarray(32, 64).toString("hex"),
};
assert.deepEqual(
  agentArtifacts,
  releaseIdentity.agentArtifacts,
  "emitted Agent artifacts differ from the clean commit release identity",
);

const files = new Map();
files.set("system.bpi1", image);
files.set("initial-args.bin", initialArgs);
files.set("source-map.json", sourceMap);
files.set("release_identity.json", releaseIdentityBytes);
files.set("LICENSE", agentFile("LICENSE"));
files.set("README.md", agentFile("system_closure_v1/README.md"));
for (const name of [
  "run.mjs",
  "runtime.mjs",
  "model_protocol_adapter.mjs",
  "fixture_model_server.mjs",
  "repository_environment.mjs",
  "process_state_census.mjs",
  "public_negatives.mjs",
  "public_verify.mjs",
  "world_archive_binding.mjs",
]) {
  files.set(name, agentFile(`system_closure_v1/${name}`));
}
for (const [path, bytes] of agentTree) {
  const prefix = "fixtures/repository-repair-v1/";
  if (path.startsWith(prefix)) files.set(`fixture/${path.slice(prefix.length)}`, bytes);
}
const runtimeInputSha256 = digestRuntimeInputs(files);
const inventory = [...files.keys()].sort(compareUtf8);
const checksums = inventory.map((name) => `${sha256(files.get(name))}  ${name}`).join("\n") + "\n";
files.set("checksums.sha256", Buffer.from(checksums));
const checksumsSha256 = sha256(files.get("checksums.sha256"));

const archive = gzipSync(buildTar(files), { level: 9, mtime: 0 });
const archiveSha256 = sha256(archive);
const receipt = {
  format: "agent-system-closure-artifact-receipt/v1",
  status: "artifact-built",
  publicationStatus: "pending-owner-authorization",
  agentVersion: "3.0.0",
  agentSourceCommit: agentGit.commit,
  agentSourceSha256: releaseIdentity.agentSourceSha256,
  releaseIdentitySha256: sha256(releaseIdentityBytes),
  boundaryVersion: releaseIdentity.boundary.version,
  boundaryReleaseTag: releaseIdentity.boundary.releaseTag,
  boundarySourceCommit,
  boundaryPackageUrl: releaseIdentity.boundary.packageUrl,
  boundaryPackageHash,
  worldVersion: releaseIdentity.world.version,
  worldReleaseTag: releaseIdentity.world.releaseTag,
  worldSourceCommit: releaseIdentity.world.sourceCommit,
  worldProductionSourceSha256: releaseIdentity.world.productionSourceSha256,
  worldRuntimeArchiveName: releaseIdentity.world.archiveName,
  worldRuntimeArchiveSha256: releaseIdentity.world.archiveSha256,
  worldRuntimeArchiveByteLength: releaseIdentity.world.archiveByteLength,
  kernelSha256: releaseIdentity.kernel.sha256,
  kernelByteLength: releaseIdentity.kernel.byteLength,
  kernelImportCount: releaseIdentity.kernel.importCount,
  kernelAbiVersion: releaseIdentity.kernel.abiVersion,
  liveModelTestStatus: "not-run",
  imageSha256: agentArtifacts.imageSha256,
  imageByteLength: agentArtifacts.imageByteLength,
  programTransitionIdentity: agentArtifacts.programTransitionDigest,
  initialArgsSha256: agentArtifacts.initialArgsSha256,
  initialArgsByteLength: agentArtifacts.initialArgsByteLength,
  sourceMapSha256: agentArtifacts.sourceMapSha256,
  runtimeInputSha256,
  inventoryCount: files.size,
  checksumsSha256,
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

function assertNoHiddenIndexFlags(root) {
  const records = run("git", ["ls-files", "-v", "-z"], root)
    .split("\0").filter(Boolean);
  const hidden = records.filter((record) => record[0] !== "H");
  assert.deepEqual(hidden, [],
    "Git index flags hide worktree changes from release source custody");
}

function assertNoIgnoredSourceInputs(root) {
  const ignored = run(
    "git",
    [
      "ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--",
      ":(glob)**/*.json", ":(glob)**/*.mjs", ":(glob)**/*.zig",
      ":(glob)**/*.zon", ":(glob)fixtures/**",
      ":(glob,exclude).ledger/**", ":(glob,exclude).uv-cache/**",
      ":(glob,exclude).zig-cache/**", ":(glob,exclude).zig-global-cache/**",
      ":(glob,exclude)dist/**", ":(glob,exclude)zig-out/**",
      ":(glob,exclude)zig-pkg/**", ":(glob,exclude)**/.ledger/**",
      ":(glob,exclude)**/.uv-cache/**", ":(glob,exclude)**/.zig-cache/**",
      ":(glob,exclude)**/.zig-global-cache/**", ":(glob,exclude)**/dist/**",
      ":(glob,exclude)**/zig-out/**", ":(glob,exclude)**/zig-pkg/**",
    ],
    root,
  ).split("\0").filter(Boolean);
  assert.deepEqual(ignored, [],
    "ignored source-like files are forbidden during release emission");
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "" },
    maxBuffer: 64 * 1024 * 1024,
  });
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
    .filter(([name]) =>
      name.endsWith(".mjs") ||
      name === "release_identity.json" ||
      name.startsWith("fixture/")
    )
    .sort(([left], [right]) => compareUtf8(left, right))
    .map(([name, bytes]) => [name, sha256(bytes)]);
  return sha256(Buffer.from(JSON.stringify(records)));
}

async function digestWorldProductionSource(root) {
  const records = [];
  async function addTree(sourceRoot, prefix) {
    for (const entry of (await readdir(sourceRoot, { withFileTypes: true }))
      .sort((left, right) => compareUtf8(left.name, right.name))) {
      const source = join(sourceRoot, entry.name);
      const name = prefix + "/" + entry.name;
      const stat = await lstat(source);
      assert(!stat.isSymbolicLink(), "World production source link is forbidden: " + name);
      if (entry.isDirectory()) await addTree(source, name);
      else if (entry.isFile()) records.push([name, sha256(await readFile(source))]);
      else throw new Error("unsupported World production source: " + name);
    }
  }
  records.push(["bin/world.mjs", sha256(await readFile(join(root, "bin/world.mjs")))]);
  await addTree(join(root, "src/process_v1"), "src/process_v1");
  records.sort(([left], [right]) => compareUtf8(left, right));
  return sha256(Buffer.from(JSON.stringify([
    "world-production-source/v2",
    records,
  ])));
}

function parseReleaseIdentity(bytes) {
  const identity = JSON.parse(bytes.toString("utf8"));
  assert.equal(identity.format, "agent-system-closure-release-identity/v1");
  assert.equal(identity.agentVersion, "3.0.0");
  assert.deepEqual(Object.keys(identity).sort(), [
    "agentArtifacts", "agentSourceSha256", "agentVersion", "boundary", "format",
    "kernel", "world",
  ]);
  assert.deepEqual(Object.keys(identity.agentArtifacts).sort(), [
    "imageByteLength", "imageSha256", "initialArgsByteLength",
    "initialArgsSha256", "programTransitionDigest", "sourceMapSha256",
  ]);
  assert.deepEqual(Object.keys(identity.boundary).sort(), [
    "packageHash", "packageUrl", "releaseTag", "sourceCommit", "version",
  ]);
  assert.deepEqual(Object.keys(identity.world).sort(), [
    "archiveByteLength", "archiveName", "archiveSha256",
    "productionSourceSha256", "releaseTag", "sourceCommit", "version",
  ]);
  assert.deepEqual(Object.keys(identity.kernel).sort(), [
    "abiVersion", "byteLength", "importCount", "sha256",
  ]);
  assert.match(identity.boundary.sourceCommit, /^[0-9a-f]{40}$/);
  assert.match(identity.agentSourceSha256, /^[0-9a-f]{64}$/);
  assert.match(identity.agentArtifacts.imageSha256, /^[0-9a-f]{64}$/);
  assert.match(identity.agentArtifacts.initialArgsSha256, /^[0-9a-f]{64}$/);
  assert.match(identity.agentArtifacts.sourceMapSha256, /^[0-9a-f]{64}$/);
  assert.match(identity.agentArtifacts.programTransitionDigest, /^[0-9a-f]{64}$/);
  assert.match(identity.boundary.packageHash, /^boundary-/);
  assert.match(identity.world.sourceCommit, /^[0-9a-f]{40}$/);
  assert.match(identity.world.archiveSha256, /^[0-9a-f]{64}$/);
  assert.match(identity.world.productionSourceSha256, /^[0-9a-f]{64}$/);
  assert.match(identity.kernel.sha256, /^[0-9a-f]{64}$/);
  return Object.freeze(identity);
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
    "worldRoot",
    "worldArchive",
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
