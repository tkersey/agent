// Shared fresh-process embeddings of the existing World PKI2/PKO2 contract.
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const project = import.meta.dirname;
export function wasmtime(runtime, inputPath, expectedHash = runtime.kernelSha256) {
  const result = spawnSync("uv", ["run", "--locked", "--project", project,
    "python", join(project, "embedding.py"), runtime.kernelPath, expectedHash, inputPath], {
    cwd: root,
    env: { ...process.env,
      UV_CACHE_DIR: join(root, ".agent4/cache/independent/uv"),
      UV_PROJECT_ENVIRONMENT: join(root, ".agent4/cache/independent/environment"),
      UV_PYTHON_INSTALL_DIR: join(root, ".agent4/cache/independent/python") },
    timeout: 60_000, maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

export function native(executable, inputPath, statistics = false) {
  const result = spawnSync(executable, [inputPath, ...(statistics ? ["--statistics"] : [])], {
    cwd: root, timeout: 60_000, maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}
