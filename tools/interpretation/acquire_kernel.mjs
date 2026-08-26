#!/usr/bin/env node
import { createHash } from "node:crypto";
import { copyFile, cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const EXPECTED_KERNEL_SHA256 = "12973fb655f126c2acd5693a84be47496649d1ab10bf22d565c9b675172e4f27";
const EXPECTED_UNRELATED_BPI1_SHA256 = "6564f37639bfd4cf33491582e71b4f6602f865ea619b9616627080d86f805f0e";
const EXPECTED_UNRELATED_MV2P1_SHA256 = "08ad3c629f819e580c6bec364db9c88ad578f66e24a2cbb1e3c5424987fa7ec5";
const GENERATED_BOUNDARY_ROOTS = new Set([".git", ".zig-cache", "zig-cache", "zig-out", "zig-pkg"]);
const [zigExecutable, boundaryRootArgument, overrideArgument, kernelOutput, imageOutput, profileOutput] = process.argv.slice(2);
if (![zigExecutable, boundaryRootArgument, overrideArgument, kernelOutput, imageOutput, profileOutput].every(Boolean)) {
  throw new Error("usage: acquire_kernel.mjs ZIG BOUNDARY_ROOT OVERRIDE_OR_DASH KERNEL_OUT IMAGE_OUT PROFILE_OUT");
}
const boundaryRoot = resolve(boundaryRootArgument);
const temporary = await mkdtemp(join(tmpdir(), "agent-boundary-assets-"));
try {
  const buildRoot = join(temporary, "boundary-source");
  await cp(boundaryRoot, buildRoot, {
    recursive: true,
    filter(source) {
      const path = relative(boundaryRoot, source);
      return path === "" || !GENERATED_BOUNDARY_ROOTS.has(path.split(/[\\/]/, 1)[0]);
    }
  });
  const selectedOverride = overrideArgument === "-" ? null : resolve(overrideArgument);
  if (selectedOverride !== null) verifyKernel(await readFile(selectedOverride), "selected");
  const buildStep = selectedOverride === null
    ? "emit-boundary-kernel-assets"
    : "emit-boundary-unrelated-pair";
  const result = spawnSync(resolve(zigExecutable), ["build", buildStep, "--prefix", temporary, "--summary", "all"], {
    cwd: buildRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: process.env
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`boundary_asset_build_failed:${result.status}:${result.stderr}`);
  const selectedKernel = selectedOverride ?? join(temporary, "boundary-machine-v2-kernel-v1.wasm");
  if (selectedOverride === null) verifyKernel(await readFile(selectedKernel), "rebuilt");
  const unrelatedBpi1 = join(temporary, "one-effect.boundary-program-image");
  const unrelatedMv2p1 = join(temporary, "one-effect.machine-v2-profile");
  verifyDigest(await readFile(unrelatedBpi1), EXPECTED_UNRELATED_BPI1_SHA256, "unrelated_bpi1");
  verifyDigest(await readFile(unrelatedMv2p1), EXPECTED_UNRELATED_MV2P1_SHA256, "unrelated_mv2p1");
  await Promise.all([
    copyFile(selectedKernel, kernelOutput),
    copyFile(unrelatedBpi1, imageOutput),
    copyFile(unrelatedMv2p1, profileOutput)
  ]);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

function verifyKernel(bytes, label) {
  verifyDigest(bytes, EXPECTED_KERNEL_SHA256, `${label}_kernel`);
}

function verifyDigest(bytes, expected, label) {
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== expected) throw new Error(`${label}_sha256_mismatch:${digest}`);
}
