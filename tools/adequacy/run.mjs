#!/usr/bin/env bun
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const options = parseArguments(process.argv.slice(2));

if (options.mode === "live") {
  const { runLiveAdequacy } = await import("./live.mjs");
  const receipt = await runLiveAdequacy(options);
  await emitReceipt(receipt, options);
  process.exit(0);
}
if (options.mode !== "deterministic" && options.mode !== "measure") {
  const { runLifecycleProof } = await import("./lifecycle.mjs");
  const receipt = await runLifecycleProof(options.mode, options);
  await emitReceipt(receipt, options);
  process.exit(0);
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "agent-adequacy-v1-"));
try {
  const forwarded = process.argv.slice(2).filter((argument) => argument !== "--keep-temporary");
  const forwardedMode = forwarded.indexOf("--mode");
  if (options.mode === "measure" && forwardedMode !== -1) forwarded[forwardedMode + 1] = "deterministic";
  for (;;) {
    const child = Bun.spawn([
      process.execPath,
      join(import.meta.dir, "deterministic-chunk.mjs"),
      ...forwarded,
      "--chunk-root",
      temporaryRoot,
      "--chunk-limit",
      "5000"
    ], {
      cwd: process.cwd(),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "inherit",
      env: process.env
    });
    const [stdout, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      child.exited
    ]);
    if (exitCode === 75) continue;
    if (exitCode !== 0) throw new Error(`adequacy_chunk_failed:${exitCode}`);
    const receipt = JSON.parse(stdout);
    if (options.mode === "measure") receipt.agent_adequacy_mode = "measure";
    await emitReceipt(receipt, options);
    break;
  }
} finally {
  if (!options.keepTemporary) await rm(temporaryRoot, { recursive: true, force: true });
  else process.stderr.write(`temporary_root=${temporaryRoot}\n`);
}

async function emitReceipt(receipt, options) {
  const encoded = `${JSON.stringify(receipt, null, 2)}\n`;
  if (options.receiptPath) {
    const destination = resolve(options.receiptPath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, encoded, { encoding: "utf8", mode: 0o644 });
  }
  process.stdout.write(encoded);
}

function parseArguments(argv) {
  const result = { mode: "deterministic", keepTemporary: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--keep-temporary") result.keepTemporary = true;
    else if (argument.startsWith("--") && index + 1 < argv.length) {
      const name = argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      result[name] = argv[index += 1];
    } else throw new Error(`unknown_argument:${argument}`);
  }
  return result;
}
