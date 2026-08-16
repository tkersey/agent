#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const options = parseArguments(process.argv.slice(2));
const agentRoot = resolve(options.agentRoot ?? process.cwd());
const artifactRoot = resolve(options.artifactRoot ?? join(agentRoot, "adequacy/router-policy-v1/zig-out/router-policy-adequacy"));
const lockPath = resolve(options.lock ?? join(agentRoot, "conformance/adequacy-v1/reference-stack.lock.json"));
const lockBytes = await readFile(lockPath);
const lock = JSON.parse(lockBytes);

requireExactKeys(lock, ["format", "historicalLockedTuple", "successorTuple", "archives", "application"], "lock");
require(lock.format === "agent-adequacy-reference-stack-lock-v1", "lock_format");
require(lock.historicalLockedTuple.status === "compiler_expressivity_obstruction", "historical_obstruction");
require(lock.successorTuple.agent === "2.2.0" && lock.successorTuple.boundary === "1.5.0" &&
  lock.successorTuple.world === "3.1.3" && lock.successorTuple.worldHost === "1.0.1" &&
  lock.successorTuple.worldCapabilities === "2.3.2", "successor_tuple");
require(lock.successorTuple.machineAbi === 2 && lock.successorTuple.machineStateFormat === "ABL_RNF2" &&
  lock.successorTuple.applicationAbi === 1 && lock.successorTuple.frame === 1 &&
  lock.successorTuple.effectProtocol === 1 && lock.successorTuple.maximumPendingEffects === 1, "abi_tuple");

for (const [name, archive] of Object.entries(lock.archives)) {
  requireExactKeys(archive, name === "agent" || name === "boundary" || name === "world"
    ? ["url", "sha256", "packageHash", "root"] : ["url", "sha256", "root"], `archive_${name}`);
  require(/^https:\/\/github\.com\/tkersey\//.test(archive.url), `archive_url_${name}`);
  require(!/[?&](?:id|asset_id)=\d+/.test(archive.url), `archive_numeric_asset_id_${name}`);
  requireHex(archive.sha256, `archive_sha256_${name}`);
  require(typeof archive.root === "string" && archive.root.length > 0 && !archive.root.includes("/"), `archive_root_${name}`);
}

const localArtifacts = [
  lock.application.wasm,
  lock.application.manifestBinary,
  lock.application.manifestText,
  lock.application.decisionContractBinary,
  lock.application.decisionContractJson,
  lock.application.initialArgs,
];
for (const artifact of localArtifacts) {
  requireHex(artifact.sha256, `artifact_sha256_${artifact.path}`);
  require(sha256(await readFile(join(artifactRoot, artifact.path))) === artifact.sha256, `artifact_digest_${artifact.path}`);
}
require(sha256(await readFile(join(agentRoot, lock.application.fixtureManifest.path))) ===
  lock.application.fixtureManifest.sha256, "fixture_manifest_digest");

let acquired = false;
if (options.acquire === "true") {
  const acquisitionRoot = await mkdtemp(join(tmpdir(), "agent-adequacy-lock-"));
  try {
    for (const [name, archive] of Object.entries(lock.archives)) {
      const response = await fetch(archive.url, { redirect: "follow", headers: { Accept: "application/octet-stream" } });
      require(response.ok, `archive_download_${name}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      require(bytes.length > 0 && bytes.length <= 64 * 1024 * 1024, `archive_size_${name}`);
      require(sha256(bytes) === archive.sha256, `archive_download_digest_${name}`);
      const destination = join(acquisitionRoot, basename(new URL(archive.url).pathname));
      await writeFile(destination, bytes, { mode: 0o600 });
      const listing = Bun.spawnSync(["tar", "-tzf", destination], { stdout: "pipe", stderr: "pipe" });
      require(listing.exitCode === 0, `archive_listing_${name}`);
      const entries = listing.stdout.toString("utf8").trim().split("\n").filter(Boolean);
      require(entries.length > 0 && entries.every((entry) => entry === archive.root || entry.startsWith(`${archive.root}/`)),
        `archive_root_mismatch_${name}`);
    }
    acquired = true;
  } finally {
    await rm(acquisitionRoot, { recursive: true, force: true });
  }
}

process.stdout.write(`${JSON.stringify({
  schema: "agent-adequacy-lock-check/v1",
  lockSha256: sha256(lockBytes),
  successorTuple: lock.successorTuple,
  applicationId: lock.application.id,
  localArtifactsAuthenticated: true,
  anonymousPublicAcquisition: acquired,
  historicalObstructionPreserved: true,
}, null, 2)}\n`);

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function requireHex(value, label) { require(typeof value === "string" && /^[0-9a-f]{64}$/.test(value), label); }
function require(condition, label) { if (!condition) throw new Error(`adequacy_lock_${label}_failed`); }
function requireExactKeys(value, expected, label) {
  require(value && typeof value === "object" && !Array.isArray(value), `${label}_object`);
  const actual = Object.keys(value).sort();
  require(JSON.stringify(actual) === JSON.stringify([...expected].sort()), `${label}_keys`);
}
function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--") || index + 1 >= argv.length) throw new Error(`unknown_argument:${argument}`);
    result[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = argv[index += 1];
  }
  return result;
}
