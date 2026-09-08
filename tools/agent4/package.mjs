import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { DEFAULT_LOCK, readDependencyLock, readRegular, sha256, verifyRuntime } from "./dependencies.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const runtimeFiles = ["runtime/world.mjs", "runtime/world.d.mts", "runtime/values.mjs", "runtime/runner.mjs",
  "runtime/model.mjs", "runtime/document.mjs", "tools/agent4/dependencies.mjs",
  "docs/agent4-runtime.md", "docs/migration_from_3.md", "docs/model-invocation-v3.md", "LICENSE"];
// Optional test oracles supply prescribed external values and independently
// assert application behavior. Production execution never imports these files.
const fixtureTests = ["test/agent4/document_runtime.mjs", "test/agent4/review_runtime.mjs"];
const roles = new Set(["image", "initial-args", "contract", "synthetic-fixture"]);
const compare = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

function fail(message) { throw new Error(`Agent4Package: ${message}`); }
function exact(object, fields, label) {
  if (!object || typeof object !== "object" || Array.isArray(object) ||
      Object.keys(object).length !== fields.length || fields.some(key => !Object.hasOwn(object, key)))
    fail(`${label} requires exactly ${fields.join(", ")}`);
}
function safeRelative(path) {
  return typeof path === "string" && path.length > 0 && path.isWellFormed() && !isAbsolute(path) &&
    !/[\\\x00-\x1f\x7f]/.test(path) && path.split("/").every(part => part && part !== "." && part !== "..");
}
function inside(path, directory) {
  const suffix = relative(directory, path);
  return suffix === "" || (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith("../"));
}
function physical(path) {
  const absolute = resolve(path);
  if (existsSync(absolute)) return realpathSync(absolute);
  // Dangling symlinks must not conceal a dependency destination.
  try { if (lstatSync(absolute).isSymbolicLink()) fail("dangling output symlink"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const parent = dirname(absolute);
  if (parent === absolute) fail("unresolvable output path");
  return join(physical(parent), basename(absolute));
}

export function parseArguments(argv) {
  const mapping = new Map([["--images-dir", "imagesDir"], ["--output-dir", "outputDir"],
    ["--version", "version"], ["--world-runtime", "worldRuntime"], ["--lock", "lockPath"]]);
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = mapping.get(argv[i]), value = argv[i + 1];
    if (!key || typeof value !== "string" || !value || value.startsWith("--") || value.includes("\0"))
      fail(`unknown or incomplete argument: ${argv[i]}`);
    if (Object.hasOwn(options, key)) fail(`duplicate argument: ${argv[i]}`);
    options[key] = value;
  }
  for (const name of ["imagesDir", "outputDir", "version"])
    if (!Object.hasOwn(options, name)) fail(`missing argument: ${[...mapping].find(([, v]) => v === name)[0]}`);
  if (!/^4\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(options.version))
    fail("version must select an Agent 4 release or prerelease line");
  return options;
}

function readInventory(directory) {
  const bytes = readRegular(join(directory, "inventory.json"), 1024 * 1024);
  const manifest = JSON.parse(bytes);
  exact(manifest, ["format", "examples", "files"], "inventory");
  if (manifest.format !== "agent4-use-inventory/v1" || !Array.isArray(manifest.examples) ||
      !manifest.examples.length || !Array.isArray(manifest.files) || !manifest.files.length)
    fail("invalid use inventory");
  const files = new Map(), records = new Map();
  for (const record of manifest.files) {
    exact(record, ["path", "role", "sha256"], "inventory file");
    if (!safeRelative(record.path) || record.path === "inventory.json" ||
        !roles.has(record.role) || !/^[a-f0-9]{64}$/.test(record.sha256) || records.has(record.path))
      fail("invalid or duplicate inventory file");
    const extension = record.role === "image" ? /\.bpi2$/ : record.role === "initial-args" ? /\.(bin|args)$/ :
      record.role === "contract" ? /\.(md|txt)$/ : /\.(json|bin|txt|md)$/;
    if (!extension.test(record.path)) fail(`unexpected ${record.role} file type: ${record.path}`);
    const path = join(directory, record.path);
    if (!inside(realpathSync(path), directory)) fail(`inventory path escapes its directory: ${record.path}`);
    const content = readRegular(path);
    if (sha256(content) !== record.sha256) fail(`input digest mismatch: ${record.path}`);
    records.set(record.path, record);
    files.set(`examples/${record.path}`, content);
  }
  const names = new Set(), used = new Set();
  for (const example of manifest.examples) {
    exact(example, ["name", "image", "initialArgs"], "example");
    if (!/^[a-z0-9][a-z0-9-]*$/.test(example.name) || names.has(example.name) ||
        records.get(example.image)?.role !== "image" || records.get(example.initialArgs)?.role !== "initial-args")
      fail("invalid or duplicate example binding");
    names.add(example.name);
    used.add(example.image); used.add(example.initialArgs);
  }
  for (const record of records.values())
    if (["image", "initial-args"].includes(record.role) && !used.has(record.path))
      fail(`unbound executable input: ${record.path}`);
  for (const role of ["contract", "synthetic-fixture"])
    if (![...records.values()].some(record => record.role === role)) fail(`missing ${role} inventory input`);
  files.set("examples/inventory.json", bytes);
  return { manifest, files, inputSha256: sha256(bytes) };
}

function sourceFacts(sourceFiles) {
  function git(args) {
    const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    if (result.status !== 0) fail(`cannot inspect Git source identity: ${args.join(" ")}`);
    return result.stdout.trim();
  }
  const head = git(["rev-parse", "HEAD"]), headTree = git(["rev-parse", "HEAD^{tree}"]);
  const matchesHead = [...sourceFiles].every(([path, bytes]) => {
    const result = spawnSync("git", ["show", `${head}:${path}`], { cwd: ROOT, maxBuffer: 16 * 1024 * 1024 });
    return result.status === 0 && Buffer.from(result.stdout).equals(bytes);
  });
  return { head, headTree, packagedSourceMatchesHead: matchesHead,
    packagedSourceSha256: sha256(json([...sourceFiles].sort(([a], [b]) => compare(a, b))
      .map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha256(bytes) })))),
    relation: "Observed Git identity and actual packaged file hashes; image compilation provenance is supplied by separate emitter/integration evidence." };
}

function octal(header, offset, length, value) {
  const text = value.toString(8).padStart(length - 1, "0");
  if (text.length >= length) fail("tar numeric field overflow");
  header.write(text, offset, length - 1, "ascii");
}
function tarEntry(path, contents, directory = false) {
  let name = path, prefix = "";
  if (Buffer.byteLength(name) > 100) {
    const splits = [...path.matchAll(/\//g)].map(match => match.index).reverse();
    const split = splits.find(index => Buffer.byteLength(path.slice(0, index)) <= 155 &&
      Buffer.byteLength(path.slice(index + 1)) <= 100);
    if (split === undefined) fail(`tar path is too long: ${path}`);
    prefix = path.slice(0, split); name = path.slice(split + 1);
  }
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8"); header.write(prefix, 345, 155, "utf8");
  octal(header, 100, 8, directory ? 0o755 : 0o644);
  octal(header, 108, 8, 0); octal(header, 116, 8, 0);
  octal(header, 124, 12, contents.length); octal(header, 136, 12, 0);
  header.fill(0x20, 148, 156); header.write(directory ? "5" : "0", 156, 1);
  header.write("ustar\0", 257, 6); header.write("00", 263, 2);
  header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0"), 148, 6);
  header[154] = 0; header[155] = 0x20;
  return Buffer.concat([header, contents, Buffer.alloc((512 - contents.length % 512) % 512)]);
}
function archiveBytes(name, files) {
  const directories = new Set([name]);
  for (const path of files.keys()) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) directories.add(`${name}/${parts.slice(0, i).join("/")}`);
  }
  const entries = [...directories].sort(compare).map(path => tarEntry(path, Buffer.alloc(0), true));
  for (const path of [...files.keys()].sort(compare)) entries.push(tarEntry(`${name}/${path}`, files.get(path)));
  // No timestamps, owners, paths, random IDs or gzip filename enter these bytes.
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]), { level: 9 });
}
function atomic(path, bytes) {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try { writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 }); renameSync(temporary, path); }
  finally { rmSync(temporary, { force: true }); }
}

export function packageArtifacts(argv) {
  const options = parseArguments(argv);
  const imageRoot = realpathSync(options.imagesDir);
  const runtimeRoot = options.worldRuntime === undefined ? undefined : realpathSync(options.worldRuntime);
  const outputRoot = physical(options.outputDir), lockPath = realpathSync(options.lockPath ?? DEFAULT_LOCK);
  for (const protectedRoot of [imageRoot, runtimeRoot, join(ROOT, ".agent4/inputs"),
    join(ROOT, ".agent4/out/world-runtime"), join(ROOT, ".agent4/out/world")].filter(Boolean))
    if (inside(outputRoot, physical(protectedRoot))) fail("output directory overlaps immutable inputs");
  const before = runtimeRoot === undefined ? undefined : verifyRuntime(runtimeRoot, { lockPath });
  const lock = readDependencyLock(lockPath);
  const declaredVersion = readRegular(join(ROOT, "build.zig.zon")).toString("utf8").match(/\.version\s*=\s*"([^"]+)"/)?.[1];
  if (declaredVersion !== options.version) fail("archive version differs from Agent's package version");
  const { manifest, files, inputSha256 } = readInventory(imageRoot);
  const sources = new Map([...runtimeFiles, ...fixtureTests].map(path => [path, readRegular(join(ROOT, path))]));
  sources.set("conformance/agent4/dependencies.lock.json", readRegular(lockPath));
  for (const [path, bytes] of sources) files.set(path, bytes);
  files.set("README.md", Buffer.from(`# Agent ${options.version}: resumable interaction examples\n\n` +
    `This source-independent use archive contains compiled BPI2 and typed InitialArgs.\n` +
    `Supply the unchanged World runtime authenticated by conformance/agent4/dependencies.lock.json.\n` +
    `The dependency tuple is ${lock.status}; this archive does not claim completion, stable release, or live-model validation.\n\n` +
    `See docs/agent4-runtime.md for start, resume, inspect, cancel and raw World usage.\n` +
    `examples/inventory.json is only a file inventory; execution never reads it to select application control.\n` +
    `Synthetic fixture files are explicitly alternative environmental inputs, not recorded program state.\n` +
    `test/agent4/*.mjs are optional scripted external-input test oracles. They are not production control and are never imported by the runner.\n\n` +
    `Examples: ${manifest.examples.map(example => example.name).join(", ")}.\n`));
  const rows = [...files].sort(([a], [b]) => compare(a, b)).map(([path, bytes]) =>
    ({ path, bytes: bytes.length, sha256: sha256(bytes) }));
  files.set("SHA256SUMS", Buffer.from(rows.map(row => `${row.sha256}  ${row.path}`).join("\n") + "\n"));
  const name = `agent-v${options.version}-resumable-interactions-v1`;
  const archive = archiveBytes(name, files), archiveName = `${name}.tar.gz`, receiptName = `${name}-receipt.json`;
  const receipt = {
    format: "agent4-use-archive-receipt/v1", status: "artifact-built", version: options.version,
    dependencyStatus: lock.status, source: sourceFacts(sources), inventorySha256: inputSha256,
    dependencyLockSha256: sha256(sources.get("conformance/agent4/dependencies.lock.json")),
    boundary: { commit: lock.boundary.commit, packageHash: lock.boundary.package.zigHash },
    world: { commit: lock.world.commit, kernelSha256: lock.world.runtime.kernel.sha256,
      runtimeInventorySha256: lock.world.runtime.inventorySha256, abi: lock.world.runtime.abi,
      runtimeVerification: before === undefined ? "not-performed" : "verified" },
    archive: { name: archiveName, bytes: archive.length, sha256: sha256(archive) },
    files: [...rows, { path: "SHA256SUMS", bytes: files.get("SHA256SUMS").length,
      sha256: sha256(files.get("SHA256SUMS")) }],
    executionStatus: "not-established-by-packaging", reviewStatus: "not-established-by-packaging",
    publicationStatus: "not-published-by-packaging", liveModelStatus: "not-run",
  };
  if (runtimeRoot !== undefined)
    assert.deepEqual(verifyRuntime(runtimeRoot, { lockPath }), before, "World runtime changed during packaging");
  // Re-read all image inputs: generated files must not change mid-package.
  assert.deepEqual([...readInventory(imageRoot).files], [...files].filter(([path]) => path.startsWith("examples/")));
  for (const [path, bytes] of sources)
    assert.deepEqual(readRegular(path === "conformance/agent4/dependencies.lock.json" ? lockPath : join(ROOT, path)), bytes,
      `Agent package source changed: ${path}`);
  mkdirSync(outputRoot, { recursive: true });
  const receiptBytes = json(receipt);
  atomic(join(outputRoot, archiveName), archive);
  atomic(join(outputRoot, receiptName), receiptBytes);
  atomic(join(outputRoot, "SHA256SUMS"), Buffer.from(`${sha256(archive)}  ${archiveName}\n${sha256(receiptBytes)}  ${receiptName}\n`));
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const receipt = packageArtifacts(process.argv.slice(2)); console.log(JSON.stringify(receipt.archive)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
