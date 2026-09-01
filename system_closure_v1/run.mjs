import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const options = parseArgs(process.argv.slice(2));
assert(["fixture", "live"].includes(options.mode), "--mode must be fixture or live");
if (options.mode === "live") {
  assert(options.endpoint !== undefined, "live mode requires --endpoint");
  assert(process.env.OPENAI_API_KEY, "live mode requires OPENAI_API_KEY");
}
const workDir = resolve(options.workDir);
const workEntries = (await readdir(workDir)).sort();
if (workEntries.length !== 0) {
  assert.deepEqual(
    workEntries,
    ["checkpoint.json", "workspace"],
    "--work-dir must be empty or contain one resumable fixture checkpoint",
  );
}
const runtime = join(dirname(fileURLToPath(import.meta.url)), "runtime.mjs");

for (let chunk = 0; chunk < 16; chunk += 1) {
  const runtimeArgs = [
    runtime,
    "--worldRoot", resolve(options.worldRoot),
    "--workDir", workDir,
    "--mode", options.mode,
    "--maximumReductions", "3000",
  ];
  if (options.endpoint !== undefined) runtimeArgs.push("--endpoint", options.endpoint);
  const result = spawnSync(process.execPath, runtimeArgs, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.stderr.length !== 0) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`closure runtime chunk failed with status ${result.status}`);
  const receipt = JSON.parse(result.stdout.trim().split("\n").filter(Boolean).at(-1));
  if (receipt.result === "passed") {
    process.stdout.write(`${JSON.stringify({ ...receipt, processTransfers: chunk })}\n`);
    process.exit(0);
  }
  assert.equal(receipt.result, "checkpointed");
}
throw new Error("closure runtime exceeded chunk limit");

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    assert(key?.startsWith("--") && value !== undefined, "invalid arguments");
    result[toCamel(key.slice(2))] = value;
  }
  for (const key of ["worldRoot", "workDir", "mode"]) assert(key in result, `missing --${key}`);
  return result;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}
