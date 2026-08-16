#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const options = parseArguments(process.argv.slice(2));
const agentRoot = resolve(options.agentRoot ?? process.cwd());
const artifactRoot = resolve(options.artifactRoot ?? join(agentRoot, "adequacy/router-policy-v1/zig-out/router-policy-adequacy"));
const lock = JSON.parse(await readFile(resolve(options.lock ?? join(agentRoot, "conformance/adequacy-v1/reference-stack.lock.json"))));
const temporaryRoot = await mkdtemp(join(tmpdir(), "agent-adequacy-reference-stack-"));

try {
  const host = await acquire("worldHost", options.worldHostArchive);
  const capabilities = await acquire("worldCapabilities", options.worldCapabilitiesArchive);
  const hostRoot = await extract(host, lock.archives.worldHost.root);
  const capabilitiesRoot = await extract(capabilities, lock.archives.worldCapabilities.root);
  await verifyCapabilityDistribution(capabilitiesRoot, capabilities);

  const receipts = {};
  for (const mode of ["deterministic", "retry", "replay", "branch", "migrate", "measure"]) {
    const destination = options.receiptRoot ? resolve(options.receiptRoot, `${mode}.json`) : null;
    if (destination) await mkdir(resolve(options.receiptRoot), { recursive: true });
    const command = [process.execPath, join(agentRoot, "tools/adequacy/run.mjs"), "--mode", mode,
      "--artifact-root", artifactRoot, "--capabilities-root", capabilitiesRoot, "--world-host-root", hostRoot];
    if (destination) command.push("--receipt-path", destination);
    const child = Bun.spawn(command, { cwd: agentRoot, stdin: "ignore", stdout: "pipe", stderr: "inherit", env: process.env });
    const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    require(exitCode === 0, `mode_${mode}`);
    receipts[mode] = JSON.parse(stdout);
  }

  require(receipts.deterministic.external_effect_count === 47, "deterministic_effect_count");
  require(receipts.deterministic.hidden_verifier_passed === true && receipts.deterministic.typed_final_result === true,
    "deterministic_terminal");
  require(receipts.retry.deterministic_retry === true && receipts.retry.retry_capability_invocations === 1,
    "retry");
  require(receipts.replay.replay_fresh_effect_count === 0 && receipts.replay.replay_terminal_frame_byte_identical === true,
    "replay");
  require(receipts.branch.branching === true && receipts.branch.branch_result_crossing_rejected === true, "branch");
  require(receipts.migrate.migration === true && receipts.migrate.migration_receiver_preflight === true, "migration");

  process.stdout.write(`${JSON.stringify({
    schema: "agent-adequacy-reference-stack/v1",
    mode: options.offline === "true" ? "offline" : "anonymous-public",
    applicationId: receipts.deterministic.application_id,
    worldHostSha256: host.sha256,
    worldCapabilitiesSha256: capabilities.sha256,
    externalEffectCount: 47,
    deterministic: true,
    retry: true,
    replay: true,
    branching: true,
    migration: true,
    anonymousPublicAcquisition: options.offline !== "true",
    githubAuthenticationRequired: false,
    sourceCheckoutRequiredAtRuntime: false,
    zigRequiredAtRuntime: false,
  }, null, 2)}\n`);

  async function acquire(name, offlinePath) {
    const admitted = lock.archives[name];
    let bytes;
    let filename;
    if (options.offline === "true") {
      require(typeof offlinePath === "string", `offline_${name}_required`);
      bytes = await readFile(resolve(offlinePath));
      filename = basename(offlinePath);
    } else {
      const response = await fetch(admitted.url, { redirect: "follow", headers: { Accept: "application/octet-stream" } });
      require(response.ok, `download_${name}`);
      bytes = new Uint8Array(await response.arrayBuffer());
      filename = basename(new URL(admitted.url).pathname);
    }
    require(bytes.length > 0 && bytes.length <= 64 * 1024 * 1024, `size_${name}`);
    const digest = sha256(bytes);
    require(digest === admitted.sha256, `digest_${name}`);
    const path = join(temporaryRoot, filename);
    await writeFile(path, bytes, { mode: 0o600 });
    return { path, sha256: digest, name };
  }

  async function extract(archive, expectedRoot) {
    const listing = Bun.spawnSync(["tar", "-tzf", archive.path], { stdout: "pipe", stderr: "pipe" });
    require(listing.exitCode === 0, `listing_${archive.name}`);
    const entries = listing.stdout.toString("utf8").trim().split("\n").filter(Boolean);
    require(entries.length > 0 && entries.every((entry) => entry === expectedRoot || entry.startsWith(`${expectedRoot}/`)),
      `root_${archive.name}`);
    const destination = join(temporaryRoot, `extract-${archive.name}`);
    await mkdir(destination);
    const extracted = Bun.spawnSync(["tar", "-xzf", archive.path, "-C", destination], { stdout: "pipe", stderr: "pipe" });
    require(extracted.exitCode === 0, `extract_${archive.name}`);
    return join(destination, expectedRoot);
  }

  async function verifyCapabilityDistribution(root, archive) {
    const sidecar = join(temporaryRoot, `${basename(archive.path)}.sha256`);
    await writeFile(sidecar, `${archive.sha256}  ${basename(archive.path)}\n`, { encoding: "utf8", mode: 0o600 });
    const child = Bun.spawn(["sh", join(root, "conformance/run-conformance.sh"),
      "--archive", archive.path, "--checksum", sidecar], {
      cwd: temporaryRoot, stdin: "ignore", stdout: "pipe", stderr: "inherit", env: process.env,
    });
    const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    require(exitCode === 0, "capability_conformance");
    require(JSON.parse(stdout).proofExitCode === 0, "capability_conformance_receipt");
  }
} finally {
  if (options.keepTemporary !== "true") await rm(temporaryRoot, { recursive: true, force: true });
  else process.stderr.write(`temporary_root=${temporaryRoot}\n`);
}

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function require(condition, label) { if (!condition) throw new Error(`adequacy_reference_stack_${label}_failed`); }
function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--") || index + 1 >= argv.length) throw new Error(`unknown_argument:${argument}`);
    result[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = argv[index += 1];
  }
  return result;
}
