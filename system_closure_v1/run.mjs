import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { admitModelEndpoint } from "./model_protocol_adapter.mjs";

const options = parseArgs(process.argv.slice(2));
assert(["fixture", "live"].includes(options.mode), "--mode must be fixture or live");
if (options.mode === "live") {
  assert(options.endpoint !== undefined, "live mode requires --endpoint");
  assert(process.env.OPENAI_API_KEY, "live mode requires OPENAI_API_KEY");
  admitModelEndpoint(options.endpoint, true);
}
const workDir = resolve(options.workDir);
const workEntries = (await readdir(workDir)).sort();
assert.deepEqual(workEntries, [], "--work-dir must be empty");
const runtime = join(dirname(fileURLToPath(import.meta.url)), "runtime.mjs");
const checkpointKey = randomBytes(32).toString("hex");

for (let chunk = 0; chunk < 16; chunk += 1) {
  const runtimeArgs = [
    runtime,
    "--worldRoot", resolve(options.worldRoot),
    "--worldArchive", resolve(options.worldArchive),
    "--workDir", workDir,
    "--mode", options.mode,
    "--maximumReductions", options.censusOutput === undefined ? "3000" : "30000",
  ];
  if (options.endpoint !== undefined) runtimeArgs.push("--endpoint", options.endpoint);
  if (options.censusOutput !== undefined) {
    runtimeArgs.push(
      "--sourceMap",
      join(dirname(fileURLToPath(import.meta.url)), "source-map.json"),
    );
    runtimeArgs.push("--censusOutput", resolve(options.censusOutput));
  }
  const result = spawnSync(process.execPath, runtimeArgs, {
    encoding: "utf8",
    env: { ...process.env, AGENT_SYSTEM_CHECKPOINT_KEY: checkpointKey },
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.stderr.length !== 0) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`closure runtime chunk failed with status ${result.status}`);
  const receipt = JSON.parse(result.stdout.trim().split("\n").filter(Boolean).at(-1));
  if (receipt.result === "passed") {
    await writeStdout(`${JSON.stringify({ ...receipt, processTransfers: chunk })}\n`);
    process.exit(0);
  }
  assert.equal(receipt.result, "checkpointed");
}
throw new Error("closure runtime exceeded chunk limit");

function writeStdout(value) {
  return new Promise((resolve, reject) => {
    process.stdout.write(value, (error) => error ? reject(error) : resolve());
  });
}

function parseArgs(args) {
  const admitted = new Set([
    "worldRoot",
    "worldArchive",
    "workDir",
    "mode",
    "endpoint",
    "censusOutput",
  ]);
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    assert(key?.startsWith("--") && value !== undefined, "invalid arguments");
    const name = toCamel(key.slice(2));
    assert(admitted.has(name), `unknown scheduler argument --${key.slice(2)}`);
    assert(!(name in result), `duplicate scheduler argument --${key.slice(2)}`);
    result[name] = value;
  }
  for (const key of ["worldRoot", "worldArchive", "workDir", "mode"]) {
    assert(key in result, `missing --${key}`);
  }
  return result;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}
