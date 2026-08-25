import {
  accessSync,
  chmodSync,
  constants,
  mkdirSync,
  realpathSync,
  statSync,
  symlinkSync
} from "node:fs";
import { delimiter, join } from "node:path";

export function resolveVerifierExecutables() {
  return Object.freeze({
    node: admitExecutable(process.execPath, "node"),
    bun: admitExecutable(findOnPath("bun"), "bun"),
    git: admitExecutable("/usr/bin/git", "git")
  });
}

export function materializeVerifierBin(root, zig, executables) {
  const bin = join(root, "verifier-bin");
  mkdirSync(bin, { mode: 0o700 });
  for (const [name, target] of [
    ["bun", executables.bun.real],
    ["git", executables.git.real],
    ["node", executables.node.real],
    ["zig", realpathSync(zig)]
  ]) {
    symlinkSync(target, join(bin, name));
  }
  chmodSync(bin, 0o555);
  return bin;
}

export function closedVerifierPath(verifierBin) {
  return [...new Set([
    verifierBin,
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
