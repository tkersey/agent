import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "run_repository_system_world.mjs");
const workRoot = await mkdtemp(join(tmpdir(), "agent-system-closure-chunks-"));
try {
  for (let chunk = 0; chunk < 16; chunk += 1) {
    const result = spawnSync(process.execPath, [
      script,
      ...process.argv.slice(2),
      "--workRoot",
      workRoot,
      "--maximumReductions",
      "3000",
    ], {
      encoding: "utf8",
      env: process.env,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.stderr.length !== 0) process.stderr.write(result.stderr);
    if (result.status !== 0) {
      throw new Error(`repository fixture chunk failed with status ${result.status}`);
    }
    const lines = result.stdout.trim().split("\n").filter(Boolean);
    const receipt = JSON.parse(lines.at(-1));
    if (receipt.result === "passed") {
      process.stdout.write(`${JSON.stringify(receipt)}\n`);
      break;
    }
    if (receipt.result !== "checkpointed") {
      throw new Error(`unexpected repository fixture result: ${receipt.result}`);
    }
    if (chunk === 15) throw new Error("repository fixture exceeded chunk limit");
  }
} finally {
  await rm(workRoot, { recursive: true, force: true });
}
