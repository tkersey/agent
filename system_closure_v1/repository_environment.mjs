import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";

export const EXPECTED_INITIAL_DIGEST = "8832f65e4bcf4a701dc76f310f3af34296bf8e95feb16ad70608041cb2e6dbb3";
export const EXPECTED_FINAL_DIGEST = "8bf50f62e3a4294ef359a6b9096d66e5597ce37824b3483ddad541ee21438453";
export const EXPECTED_FINAL_TREE = "0d9ac8802aac6597cb0a443245efb6f92a0249fe";
export const CORRECT_SOURCE = `export function normalizeRange(start, end) {
  if (start <= end) {
    return { start, end };
  }
  return { start: end, end: start };
}
`;

export async function createRepositoryEnvironment(workspaceRoot, restored = {}) {
  const workspaceReal = await realpath(workspaceRoot);
  let baselineFailed = restored.baselineFailed ?? false;
  let mutationApplied = restored.mutationApplied ?? false;
  let postMutationPassed = restored.postMutationPassed ?? false;
  let requestCount = restored.repositoryRequests ?? 0;

  async function resolveEffect(request) {
    requestCount += 1;
    switch (request.effectSemanticIdentity) {
      case "repo.list.v1": {
        assert.equal(request.payload.length, 0);
        const paths = ["README.md", "package.json", "src/range.mjs", "test/range.test.mjs"];
        for (const path of paths) await admittedRead(path);
        return encodeText(paths.join("\n"));
      }
      case "repo.read.v1": {
        assert.equal(request.payload.length, 1);
        const role = request.payload[0];
        const path = ["package.json", "src/range.mjs", "test/range.test.mjs"][role];
        assert(path !== undefined, "invalid read role");
        const contents = await admittedRead(path);
        return concat(Buffer.from([role]), encodeText(path), encodeText(sha256(contents)), encodeText(contents));
      }
      case "repo.search.v1":
        throw new Error("nominal fixture must not require search");
      case "repo.test.v1": {
        assert.equal(request.payload.length, 0);
        const result = spawnSync("bun", ["test"], {
          cwd: workspaceRoot,
          encoding: "utf8",
          env: { PATH: process.env.PATH ?? "" },
        });
        const passed = result.status === 0;
        const output = clipUtf8(`${result.stdout ?? ""}${result.stderr ?? ""}`, 1900);
        if (!mutationApplied) {
          assert.equal(passed, false);
          baselineFailed = true;
        } else {
          assert.equal(passed, true);
          postMutationPassed = true;
        }
        return concat(Buffer.from([Number(passed)]), encodeText(output));
      }
      case "repo.replace.approved.v1": {
        assert.equal(baselineFailed, true);
        const proposal = decodeReplaceRequest(request.payload);
        assert.deepEqual(proposal, {
          path: "src/range.mjs",
          expected_sha256: EXPECTED_INITIAL_DIGEST,
          replacement: CORRECT_SOURCE,
          rationale: "Correct ascending preservation and descending normalization.",
        });
        const handle = await admittedFile(proposal.path, "r+");
        try {
          const current = await handle.readFile();
          assert.equal(sha256(current), proposal.expected_sha256);
          await handle.truncate(0);
          const replacement = Buffer.from(proposal.replacement, "utf8");
          const written = await handle.write(replacement, 0, replacement.length, 0);
          assert.equal(written.bytesWritten, replacement.length);
          await handle.sync();
        } finally {
          await handle.close();
        }
        mutationApplied = true;
        return concat(
          Buffer.from([1]),
          encodeText(proposal.path),
          encodeText(EXPECTED_INITIAL_DIGEST),
          encodeText(EXPECTED_FINAL_DIGEST),
          encodeText("replacement applied"),
        );
      }
      default:
        throw new Error(`unexpected repository effect ${request.effectSemanticIdentity}`);
    }
  }

  async function admittedRead(relativePath) {
    const handle = await admittedFile(relativePath, "r");
    try {
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  }

  async function admittedFile(relativePath, flags) {
    assert(!relativePath.startsWith("/") && !relativePath.split("/").includes(".."));
    const absolute = join(workspaceRoot, relativePath);
    const parentReal = await realpath(dirname(absolute));
    assert(parentReal === workspaceReal || parentReal.startsWith(`${workspaceReal}/`));
    const stat = await lstat(absolute);
    assert(stat.isFile() && !stat.isSymbolicLink());
    return open(absolute, flags);
  }

  return Object.freeze({
    resolveEffect,
    admittedRead,
    snapshot() {
      return Object.freeze({ baselineFailed, mutationApplied, postMutationPassed, repositoryRequests: requestCount });
    },
  });
}

export function decodeFinalResult(bytes) {
  const cursor = { value: 0 };
  const result = {
    summary: decodeText(bytes, cursor),
    changed_path: decodeText(bytes, cursor),
    final_source_sha256: decodeText(bytes, cursor),
  };
  assert.equal(cursor.value, bytes.length);
  return result;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function decodeReplaceRequest(bytes) {
  const cursor = { value: 0 };
  const result = {
    path: decodeText(bytes, cursor),
    expected_sha256: decodeText(bytes, cursor),
    replacement: decodeText(bytes, cursor),
    rationale: decodeText(bytes, cursor),
  };
  assert.equal(cursor.value, bytes.length);
  return result;
}

function encodeText(value) {
  const bytes = Buffer.from(value);
  return concat(u32(bytes.length), bytes);
}

function decodeText(bytes, cursor) {
  return new TextDecoder("utf-8", { fatal: true }).decode(decodeBytes(bytes, cursor));
}

function decodeBytes(bytes, cursor) {
  const length = readU32(bytes, cursor);
  assert(length <= bytes.length - cursor.value);
  const result = Buffer.from(bytes.subarray(cursor.value, cursor.value + length));
  cursor.value += length;
  return result;
}

function readU32(bytes, cursor) {
  assert(cursor.value + 4 <= bytes.length);
  const value = Buffer.from(bytes).readUInt32LE(cursor.value);
  cursor.value += 4;
  return value;
}

function u32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

function concat(...parts) {
  return Buffer.concat(parts.map((part) => Buffer.from(part)));
}

function clipUtf8(value, maximumBytes) {
  const source = Buffer.from(value);
  if (source.length <= maximumBytes) return value;
  return source.subarray(0, maximumBytes).toString("utf8");
}
