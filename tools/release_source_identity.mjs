import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const MAXIMUM_GIT_BLOB_BYTES = 64 * 1024 * 1024;

export function agentSourceSha256(root, ref = "HEAD") {
  return agentSourceSha256FromTree(gitRegularTree(root, undefined, ref));
}

export function agentSourceSha256FromTree(tree) {
  const records = [...tree]
    .filter(([path]) => isReleaseSource(path))
    .map(([path, bytes]) => [path, sha256(bytes)]);
  return sha256(Buffer.from(JSON.stringify([
    "agent-release-source/v1",
    records,
  ])));
}

export function gitRegularTree(root, prefix, ref = "HEAD") {
  const result = new Map();
  for (const entry of gitTreeEntries(root, ref, prefix)) {
    assert(
      entry.mode === "100644" || entry.mode === "100755",
      `release source is not a regular Git file: ${entry.path}`,
    );
    result.set(entry.path, gitBlob(root, entry.oid));
  }
  return result;
}

function gitTreeEntries(root, ref, prefix = undefined) {
  const args = ["ls-tree", "-r", "-z", "--full-tree", ref];
  if (prefix !== undefined) args.push("--", prefix);
  const bytes = git(root, args, MAXIMUM_GIT_BLOB_BYTES);
  return bytes.toString("utf8").split("\0").filter(Boolean).map((record) => {
    const match = /^(\d+) (\w+) ([0-9a-f]{40})\t(.+)$/.exec(record);
    assert(match !== null && match[2] === "blob", `invalid Git tree entry: ${record}`);
    return { mode: match[1], oid: match[3], path: match[4] };
  });
}

function gitBlob(root, oid) {
  const bytes = git(root, ["cat-file", "blob", oid], MAXIMUM_GIT_BLOB_BYTES);
  assert(bytes.byteLength <= MAXIMUM_GIT_BLOB_BYTES, "release source blob exceeds its bound");
  return bytes;
}

function git(root, args, maxBuffer) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: null,
    env: { PATH: process.env.PATH ?? "" },
    maxBuffer,
  });
  assert.equal(result.status, 0, result.stderr?.toString() ?? "git failed");
  return result.stdout;
}

function isReleaseSource(path) {
  if (path.startsWith("economy/")) return false;
  return ![
    "system_closure_v1/admission-proof.json",
    "system_closure_v1/fixture-proof.json",
    "system_closure_v1/release_identity.json",
  ].includes(path);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
