import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const paths = process.argv.slice(2);
assert.equal(paths.length, 11, "expected eleven scaling and ablation images");
const sizes = Object.fromEntries(
  await Promise.all(paths.map(async (path) => [
    path.match(/([^/]+)\.bpi1$/)?.[1],
    (await readFile(path)).byteLength,
  ])),
);

const prompt1To8 = sizes["prompt-8k"] - sizes["prompt-1k"];
const prompt8To16 = sizes["prompt-16k"] - sizes["prompt-8k"];
const skill4k = sizes["skill-4k"] - sizes["skill-base"];
const extraTool = sizes["tool-extra"] - sizes["tool-base"];
const sixToolDecoder = sizes["six-tools-decode"] - sizes["six-tools-no-decode"];

assert.ok(prompt1To8 <= 7 * 1024 + 1024, "1 KiB to 8 KiB prompt slope exceeded");
assert.ok(prompt8To16 <= 8 * 1024 + 1024, "8 KiB to 16 KiB prompt slope exceeded");
assert.ok(skill4k <= 5 * 1024, "4 KiB skill slope exceeded");
assert.ok(extraTool <= 4 * 1024, "one-tool slope exceeded");

process.stdout.write(`${JSON.stringify({
  format: "agent-system-economy-marginals/v1",
  images: sizes,
  deltas: { prompt1To8, prompt8To16, skill4k, extraTool, sixToolDecoder },
  gates: {
    prompt1To8Maximum: 8 * 1024,
    prompt8To16Maximum: 9 * 1024,
    skill4kMaximum: 5 * 1024,
    extraToolMaximum: 4 * 1024,
  },
}, null, 2)}\n`);
