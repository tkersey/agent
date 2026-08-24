#!/usr/bin/env node
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const EXPECTED_KERNEL_SHA256 = "12973fb655f126c2acd5693a84be47496649d1ab10bf22d565c9b675172e4f27";
const [boundaryRootArgument, overrideArgument, kernelOutput, imageOutput, profileOutput] = process.argv.slice(2);
if (![boundaryRootArgument, overrideArgument, kernelOutput, imageOutput, profileOutput].every(Boolean)) {
  throw new Error("usage: acquire_kernel.mjs BOUNDARY_ROOT OVERRIDE_OR_DASH KERNEL_OUT IMAGE_OUT PROFILE_OUT");
}
const boundaryRoot = resolve(boundaryRootArgument);
const temporary = await mkdtemp(join(tmpdir(), "agent-boundary-assets-"));
try {
  const result = spawnSync("zig", ["build", "emit-boundary-reification-assets", "--prefix", temporary, "--summary", "all"], {
    cwd: boundaryRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: process.env
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`boundary_asset_build_failed:${result.status}:${result.stderr}`);
  const rebuiltKernel = join(temporary, "boundary-machine-v2-kernel-v1.wasm");
  verifyKernel(await readFile(rebuiltKernel), "rebuilt");
  const selectedKernel = overrideArgument === "-" ? rebuiltKernel : resolve(overrideArgument);
  verifyKernel(await readFile(selectedKernel), "selected");
  await Promise.all([
    copyFile(selectedKernel, kernelOutput),
    copyFile(join(temporary, "one-effect.boundary-program-image"), imageOutput),
    copyFile(join(temporary, "one-effect.machine-v2-profile"), profileOutput)
  ]);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

function verifyKernel(bytes, label) {
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== EXPECTED_KERNEL_SHA256) throw new Error(`${label}_kernel_sha256_mismatch:${digest}`);
}
