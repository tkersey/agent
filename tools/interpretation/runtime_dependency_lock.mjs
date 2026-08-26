import { readFileSync } from "node:fs";

export const RUNTIME_DEPENDENCY_FORMAT = "agent-interpretation-runtime-dependencies-v1";

export function readRuntimeDependencyLock(path) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (value?.format !== RUNTIME_DEPENDENCY_FORMAT) {
    throw new Error(`unsupported runtime dependency lock: ${value?.format}`);
  }
  for (const [kind, repository] of [
    ["worldHost", "tkersey/world-host"],
    ["worldCapabilities", "tkersey/world-capabilities"]
  ]) {
    const entry = value[kind];
    if (entry?.repository !== repository) throw new Error(`${kind} repository mismatch`);
    if (!/^\d+\.\d+\.\d+$/.test(entry.version)) throw new Error(`${kind} version is not canonical`);
    if (!/^[0-9a-f]{64}$/.test(entry.runtimeSha256 ?? "")) throw new Error(`${kind} runtime digest is invalid`);
    if (!Array.isArray(entry.runtimePaths) || entry.runtimePaths.length === 0 ||
        new Set(entry.runtimePaths).size !== entry.runtimePaths.length ||
        entry.runtimePaths.some((item) => !safeRelativePath(item))) {
      throw new Error(`${kind} runtime paths are invalid`);
    }
    for (const archive of [entry.defaultArchive, ...(entry.overrideArchives ?? [])]) {
      if (!archive || !/^[0-9a-f]{64}$/.test(archive.sha256) ||
          typeof archive.root !== "string" || archive.root === "" ||
          typeof archive.url !== "string") {
        throw new Error(`${kind} archive binding is invalid`);
      }
    }
  }
  return Object.freeze(value);
}

function safeRelativePath(value) {
  return typeof value === "string" && value.length > 0 && !value.startsWith("/") &&
    !value.includes("\\") && !value.includes("\0") &&
    !value.split("/").some((part) => part === "" || part === "." || part === "..");
}
