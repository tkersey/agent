import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [zig, sourceRootInput, globalCacheInput] = process.argv.slice(2);
assert(zig && sourceRootInput && globalCacheInput, "expected Zig, Agent root, and cache");
const sourceRoot = resolve(sourceRootInput);
const globalCache = resolve(globalCacheInput);
const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "external_consumer");
const root = await mkdtemp(join(tmpdir(), "agent-external-consumer-"));
try {
  await Promise.all([
    copyFile(join(fixtureRoot, "build.zig"), join(root, "build.zig")),
    copyFile(join(fixtureRoot, "main.zig"), join(root, "main.zig")),
  ]);
  const dependencyPath = relative(await realpath(root), await realpath(sourceRoot));
  assert(dependencyPath.length > 0 && !isAbsolute(dependencyPath));
  await writeFile(join(root, "build.zig.zon"), `.{
    .name = .agent_external_consumer,
    .version = "0.0.0",
    .dependencies = .{ .agent = .{ .path = ${JSON.stringify(dependencyPath)} } },
    .minimum_zig_version = "0.16.0",
    .paths = .{ "build.zig", "build.zig.zon", "main.zig" },
    .fingerprint = 0xb44d50a79d4246cc,
}\n`);
  const result = spawnSync(zig, [
    "build",
    "check",
    "--cache-dir",
    join(root, ".zig-cache"),
    "--global-cache-dir",
    globalCache,
    "--summary",
    "all",
  ], {
    cwd: root,
    encoding: "utf8",
    timeout: 15 * 60 * 1000,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
  process.stdout.write(result.stdout);
} finally {
  await rm(root, { recursive: true, force: true });
}
