#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

if (process.argv.length !== 3) throw new Error("sha256_file_requires_one_path");
const bytes = await readFile(process.argv[2]);
process.stdout.write(`${createHash("sha256").update(bytes).digest("hex")}\n`);
