import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Main-module identity, including aliases and Node versions without meta.main. */
export function isMain(meta) {
  if (typeof meta.main === "boolean") return meta.main;
  if (!process.argv[1] || !meta.url.startsWith("file:")) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(meta.url));
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}
