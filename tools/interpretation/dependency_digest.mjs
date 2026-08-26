import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

export async function runtimeDependencyDigest(root, admittedRoots) {
  const files = [];
  for (const admitted of admittedRoots) await collect(root, join(root, admitted), files);
  files.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  const hasher = createHash("sha256");
  hasher.update("agent-interpretation-runtime-dependency-v1\0");
  for (const path of files) {
    const bytes = await readFile(join(root, path));
    const pathBytes = Buffer.from(path, "utf8");
    const length = Buffer.alloc(8);
    length.writeUInt32LE(pathBytes.length, 0);
    length.writeUInt32LE(bytes.length, 4);
    hasher.update(length);
    hasher.update(pathBytes);
    hasher.update(bytes);
  }
  return Object.freeze({ sha256: hasher.digest("hex"), files: Object.freeze(files) });
}

async function collect(root, path, files) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`runtime_dependency_symlink:${relative(root, path)}`);
  if (info.isFile()) {
    files.push(relative(root, path));
    return;
  }
  if (!info.isDirectory()) throw new Error(`runtime_dependency_non_regular:${relative(root, path)}`);
  const entries = await readdir(path, { withFileTypes: true });
  entries.sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
  for (const entry of entries) await collect(root, join(path, entry.name), files);
}
