import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

export function resolveVerifierExecutables() {
  return Object.freeze({
    node: admitExecutable(process.execPath, "node"),
    bun: admitExecutable(findOnPath("bun"), "bun")
  });
}

export function closedVerifierPath(zig, executables) {
  return [...new Set([
    dirname(zig),
    dirname(executables.node.invocation),
    dirname(executables.node.real),
    dirname(executables.bun.invocation),
    dirname(executables.bun.real),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin"
  ])].join(delimiter);
}

function findOnPath(name) {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (directory.length === 0) continue;
    const candidate = join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error(`required verifier executable is unavailable: ${name}`);
}

function admitExecutable(invocation, label) {
  const real = realpathSync(invocation);
  const metadata = statSync(real);
  const currentUid = typeof process.getuid === "function" ? process.getuid() : metadata.uid;
  if (!metadata.isFile() || metadata.size === 0 ||
      (metadata.uid !== 0 && metadata.uid !== currentUid) ||
      (metadata.mode & 0o022) !== 0) {
    throw new Error(`verifier executable is not admitted: ${label}:${real}`);
  }
  return Object.freeze({ invocation, real });
}
