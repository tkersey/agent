#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, resolve } from "node:path";

export const BOUNDARY_VERSION = "1.7.0";
export const BOUNDARY_COMMIT = "4fd4cd959ea283a6b5af12a228f0d80a102683e3";
export const PROCESS_KERNEL_ABI_VERSION = 1;
export const PROCESS_KERNEL_ASSET_NAME = "boundary-process-kernel-v1.wasm";
export const PROCESS_KERNEL_BYTE_LENGTH = 647_473;
export const PROCESS_KERNEL_SHA256 =
  "178f9c2fb79402a85ab5a7905586879347ad5c99f988127eec001c9ecfd813f0";
export const PROCESS_KERNEL_RELEASE_URL =
  `https://github.com/tkersey/boundary/releases/download/v${BOUNDARY_VERSION}/${PROCESS_KERNEL_ASSET_NAME}`;

export const PROCESS_KERNEL_EXPORTS = Object.freeze([
  Object.freeze(["memory", "memory"]),
  Object.freeze(["boundary_process_kernel_execute", "function"]),
  Object.freeze(["boundary_process_kernel_error_len", "function"]),
  Object.freeze(["boundary_process_kernel_error_ptr", "function"]),
  Object.freeze(["boundary_process_kernel_output_len", "function"]),
  Object.freeze(["boundary_process_kernel_output_ptr", "function"]),
  Object.freeze(["boundary_process_kernel_prepare_input", "function"]),
  Object.freeze(["boundary_process_kernel_occupied_memory_bytes", "function"]),
  Object.freeze(["boundary_process_kernel_input_payload_ptr", "function"]),
  Object.freeze(["boundary_process_kernel_input_capacity", "function"]),
  Object.freeze(["boundary_process_kernel_input_ptr", "function"]),
  Object.freeze(["boundary_process_kernel_reserve", "function"]),
  Object.freeze(["boundary_process_kernel_abi_version", "function"]),
]);

const RELEASE_ASSET_PATH =
  `/tkersey/boundary/releases/download/v${BOUNDARY_VERSION}/${PROCESS_KERNEL_ASSET_NAME}`;
const RELEASE_ASSET_REDIRECT_PREFIX = "/github-production-release-asset/1176152390/";
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 2;
const REQUEST_TIMEOUT_MS = 30_000;

export async function verifyProcessKernel(bytes, label = "boundary_process_kernel") {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError(`${label}_bytes_required`);
  }
  const owned = Buffer.from(bytes);
  if (owned.length !== PROCESS_KERNEL_BYTE_LENGTH) {
    throw new Error(`${label}_byte_length_mismatch:${owned.length}`);
  }
  const sha256 = createHash("sha256").update(owned).digest("hex");
  if (sha256 !== PROCESS_KERNEL_SHA256) {
    throw new Error(`${label}_sha256_mismatch:${sha256}`);
  }
  if (!WebAssembly.validate(owned)) {
    throw new Error(`${label}_wasm_invalid`);
  }

  const module = await WebAssembly.compile(owned);
  const imports = WebAssembly.Module.imports(module);
  if (imports.length !== 0) {
    throw new Error(`${label}_imports_present:${imports.length}`);
  }
  const exports = WebAssembly.Module.exports(module).map(({ name, kind }) => [name, kind]);
  if (JSON.stringify(exports) !== JSON.stringify(PROCESS_KERNEL_EXPORTS)) {
    throw new Error(`${label}_export_surface_mismatch:${JSON.stringify(exports)}`);
  }

  return Object.freeze({
    bytes: owned,
    module,
    sha256,
    byteLength: owned.length,
    importCount: imports.length,
    expectedAbiVersion: PROCESS_KERNEL_ABI_VERSION,
    exports: Object.freeze(exports.map(Object.freeze)),
  });
}

export async function acquireProcessKernel(overrideArgument) {
  if (overrideArgument === "-") {
    return verifyProcessKernel(await downloadReleaseAsset(), "downloaded_process_kernel");
  }
  if (!isAbsolute(overrideArgument)) {
    throw new Error("boundary_process_kernel_override_must_be_absolute");
  }
  const metadata = await stat(overrideArgument);
  if (!metadata.isFile()) {
    throw new Error("boundary_process_kernel_override_not_a_file");
  }
  if (metadata.size !== PROCESS_KERNEL_BYTE_LENGTH) {
    throw new Error(`boundary_process_kernel_override_byte_length_mismatch:${metadata.size}`);
  }
  return verifyProcessKernel(
    await readFile(overrideArgument),
    "boundary_process_kernel_override",
  );
}

async function downloadReleaseAsset() {
  let url = new URL(PROCESS_KERNEL_RELEASE_URL);
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    assertAllowedDownloadUrl(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "application/octet-stream",
          "Accept-Encoding": "identity",
          "User-Agent": "tkersey-agent-process-transcript-v1",
        },
      });
      if (REDIRECT_STATUS_CODES.has(response.status)) {
        await response.body?.cancel();
        if (redirectCount === MAX_REDIRECTS) {
          throw new Error("boundary_process_kernel_download_redirect_limit");
        }
        const location = response.headers.get("location");
        if (location === null) {
          throw new Error("boundary_process_kernel_download_redirect_without_location");
        }
        url = new URL(location, url);
        continue;
      }
      if (response.status !== 200) {
        await response.body?.cancel();
        throw new Error(`boundary_process_kernel_download_status:${response.status}`);
      }
      return await readBoundedResponse(response);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("boundary_process_kernel_download_redirect_limit");
}

function assertAllowedDownloadUrl(url) {
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
      (url.port !== "" && url.port !== "443") || url.hash !== "") {
    throw new Error("boundary_process_kernel_download_url_rejected");
  }
  if (url.hostname === "github.com") {
    if (url.pathname !== RELEASE_ASSET_PATH || url.search !== "") {
      throw new Error("boundary_process_kernel_download_url_rejected");
    }
    return;
  }
  if (url.hostname === "release-assets.githubusercontent.com" &&
      url.pathname.startsWith(RELEASE_ASSET_REDIRECT_PREFIX)) {
    return;
  }
  throw new Error(`boundary_process_kernel_download_host_rejected:${url.hostname}`);
}

async function readBoundedResponse(response) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(declaredLength)) {
      throw new Error("boundary_process_kernel_download_content_length_invalid");
    }
    if (Number(declaredLength) !== PROCESS_KERNEL_BYTE_LENGTH) {
      throw new Error(
        `boundary_process_kernel_download_content_length_mismatch:${declaredLength}`,
      );
    }
  }
  if (response.body === null) {
    throw new Error("boundary_process_kernel_download_body_missing");
  }

  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > PROCESS_KERNEL_BYTE_LENGTH) {
      await reader.cancel();
      throw new Error(`boundary_process_kernel_download_too_large:${length}`);
    }
    chunks.push(Buffer.from(value));
  }
  if (length !== PROCESS_KERNEL_BYTE_LENGTH) {
    throw new Error(`boundary_process_kernel_download_byte_length_mismatch:${length}`);
  }
  return Buffer.concat(chunks, length);
}

async function main() {
  const [overrideArgument, outputArgument, ...unexpected] = process.argv.slice(2);
  if (!overrideArgument || !outputArgument || unexpected.length !== 0) {
    throw new Error("usage: acquire_kernel.mjs OVERRIDE_OR_DASH OUTPUT");
  }
  const acquired = await acquireProcessKernel(overrideArgument);
  const output = resolve(outputArgument);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, acquired.bytes);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
