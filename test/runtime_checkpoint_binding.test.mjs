import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFile,
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const [runtime, worldRoot, worldArchive, image, initial, sourceMap, fixture] = process.argv
  .slice(2)
  .map((value) => resolve(value));
const checkpointKey = "7f".repeat(32);
let runtimeUnderTest;

function run(selectedWorld, workDir, maximumReductions = 1, extra = [], mode = "fixture") {
  return spawnSync(process.execPath, [
    runtimeUnderTest,
    "--worldRoot", selectedWorld,
    "--worldArchive", worldArchive,
    "--workDir", workDir,
    "--mode", mode,
    "--maximumReductions", String(maximumReductions),
    ...extra,
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      AGENT_SYSTEM_CHECKPOINT_KEY: checkpointKey,
      OPENAI_API_KEY: "runtime-preflight-test-key",
    },
    timeout: 5 * 60 * 1000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

const root = await mkdtemp(join(tmpdir(), "agent-runtime-binding-"));
try {
  const distributionRoot = join(root, "distribution");
  await mkdir(distributionRoot);
  for (const name of [
    "run.mjs",
    "runtime.mjs",
    "model_protocol_adapter.mjs",
    "fixture_model_server.mjs",
    "repository_environment.mjs",
    "process_state_census.mjs",
    "public_negatives.mjs",
    "public_verify.mjs",
    "world_archive_binding.mjs",
    "release_identity.json",
  ]) {
    await copyFile(join(dirname(runtime), name), join(distributionRoot, name));
  }
  await copyFile(image, join(distributionRoot, "system.bpi1"));
  await copyFile(initial, join(distributionRoot, "initial-args.bin"));
  await cp(fixture, join(distributionRoot, "fixture"), { recursive: true });
  runtimeUnderTest = join(distributionRoot, "runtime.mjs");
  const releaseIdentity = JSON.parse(await readFile(
    join(distributionRoot, "release_identity.json"),
    "utf8",
  ));
  assert.equal(
    createHash("sha256").update(await readFile(worldArchive)).digest("hex"),
    releaseIdentity.world.archiveSha256,
  );

  const initialPath = join(distributionRoot, "initial-args.bin");
  const originalInitial = await readFile(initialPath);
  const tamperedInitial = Buffer.from(originalInitial);
  tamperedInitial[tamperedInitial.length - 1] ^= 1;
  await writeFile(initialPath, tamperedInitial);
  const tamperedInitialWork = join(root, "tampered-initial-work");
  const rejectedInitial = run(worldRoot, tamperedInitialWork);
  assert.notEqual(rejectedInitial.status, 0);
  assert.match(rejectedInitial.stderr, /Agent InitialArgs digest differs/);
  await lstat(tamperedInitialWork).then(
    () => assert.fail("tampered InitialArgs reached workspace creation"),
    (error) => assert.equal(error?.code, "ENOENT"),
  );
  await writeFile(initialPath, originalInitial);

  const imagePath = join(distributionRoot, "system.bpi1");
  const originalImage = await readFile(imagePath);
  const tamperedImage = Buffer.from(originalImage);
  tamperedImage[tamperedImage.length - 1] ^= 1;
  await writeFile(imagePath, tamperedImage);
  const tamperedImageWork = join(root, "tampered-image-work");
  const rejectedImage = run(worldRoot, tamperedImageWork);
  assert.notEqual(rejectedImage.status, 0);
  assert.match(rejectedImage.stderr, /Agent Program Image digest differs/);
  await lstat(tamperedImageWork).then(
    () => assert.fail("tampered Program Image reached workspace creation"),
    (error) => assert.equal(error?.code, "ENOENT"),
  );
  await writeFile(imagePath, originalImage);

  const directEndpointWork = join(root, "direct-endpoint-work");
  const rejectedEndpoint = run(
    worldRoot,
    directEndpointWork,
    1,
    ["--endpoint", "https://example.com/v1/responses"],
    "live",
  );
  assert.notEqual(rejectedEndpoint.status, 0);
  assert.match(rejectedEndpoint.stderr, /credentialed model endpoint must be/);
  await lstat(directEndpointWork).then(
    () => assert.fail("invalid direct endpoint reached workspace creation"),
    (error) => assert.equal(error?.code, "ENOENT"),
  );

  const tamperedSourceMap = join(root, "tampered-source-map.json");
  const sourceMapBytes = await readFile(sourceMap);
  await writeFile(tamperedSourceMap, Buffer.concat([sourceMapBytes, Buffer.from(" ")]));
  const tamperedSourceMapWork = join(root, "tampered-source-map-work");
  const rejectedSourceMap = run(worldRoot, tamperedSourceMapWork, 1, [
    "--sourceMap", tamperedSourceMap,
    "--censusOutput", join(root, "tampered-census.json"),
  ]);
  assert.notEqual(rejectedSourceMap.status, 0);
  assert.match(rejectedSourceMap.stderr, /Agent source-map digest differs/);
  await lstat(tamperedSourceMapWork).then(
    () => assert.fail("tampered source map reached workspace creation"),
    (error) => assert.equal(error?.code, "ENOENT"),
  );

  const alternateImage = run(
    worldRoot,
    join(root, "alternate-image-work"),
    1,
    ["--image", image],
  );
  assert.notEqual(alternateImage.status, 0);
  assert.match(alternateImage.stderr, /unknown runtime argument --image/);

  const duplicateMode = run(
    worldRoot,
    join(root, "duplicate-mode-work"),
    1,
    ["--mode", "fixture"],
  );
  assert.notEqual(duplicateMode.status, 0);
  assert.match(duplicateMode.stderr, /duplicate runtime argument --mode/);

  const checkpointWork = join(root, "checkpoint-work");
  const first = run(worldRoot, checkpointWork);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout.trim()).result, "checkpointed");
  const checkpoint = JSON.parse(await readFile(
    join(checkpointWork, "checkpoint.json"),
    "utf8",
  ));
  assert.match(checkpoint.workspaceSha256, /^[0-9a-f]{64}$/);
  assert.match(checkpoint.kernelSha256, /^[0-9a-f]{64}$/);
  assert.equal(checkpoint.worldProductionSourceSha256,
    "7254df7071bea1daa67d6843d4a32bd1371e1ae9327af3efa5f2dbf35b431b0b");
  const checkpointPath = join(checkpointWork, "checkpoint.json");
  await writeFile(checkpointPath, `${JSON.stringify({
    ...checkpoint,
    kernelSha256: "0".repeat(64),
  })}\n`);
  const changedKernel = run(worldRoot, checkpointWork);
  assert.notEqual(changedKernel.status, 0);
  assert.match(changedKernel.stderr, /checkpoint integrity check failed/);
  await writeFile(checkpointPath, `${JSON.stringify({
    ...checkpoint,
    baselineFailed: true,
  })}\n`);
  const forgedEvidence = run(worldRoot, checkpointWork);
  assert.notEqual(forgedEvidence.status, 0);
  assert.match(forgedEvidence.stderr, /checkpoint integrity check failed/);
  await writeFile(checkpointPath, `${JSON.stringify(checkpoint)}\n`);
  await appendFile(
    join(checkpointWork, "workspace/test/range.test.mjs"),
    "\n// unauthorized post-checkpoint mutation\n",
  );
  const resumed = run(worldRoot, checkpointWork);
  assert.notEqual(resumed.status, 0);
  assert.match(resumed.stderr, /checkpoint workspace changed after suspension/);

  const unmodifiedWork = join(root, "unmodified-checkpoint-work");
  const unmodifiedStart = run(worldRoot, unmodifiedWork);
  assert.equal(unmodifiedStart.status, 0, unmodifiedStart.stderr);
  const unmodifiedResume = run(worldRoot, unmodifiedWork, 512);
  assert.equal(unmodifiedResume.status, 0, unmodifiedResume.stderr);
  assert.equal(JSON.parse(unmodifiedResume.stdout.trim()).result, "passed");

  for (const mutation of ["filter", "hook-mode", "index", "file-mode"]) {
    const work = join(root, `git-metadata-${mutation}`);
    const started = run(worldRoot, work);
    assert.equal(started.status, 0, started.stderr);
    const workspace = join(work, "workspace");
    const marker = join(root, `escaped-${mutation}`);
    if (mutation === "filter") {
      await appendFile(join(workspace, ".git/config"),
        `\n[filter "escape"]\n\tclean = "touch '${marker}'; cat"\n`);
      await writeFile(join(workspace, ".git/info/attributes"), "src/range.mjs filter=escape\n");
    } else if (mutation === "hook-mode") {
      await chmod(join(workspace, ".git/hooks/pre-commit.sample"), 0o600);
    } else if (mutation === "index") {
      await appendFile(join(workspace, ".git/index"), "changed");
    } else {
      await chmod(join(workspace, "src/range.mjs"), 0o755);
    }
    const rejected = run(worldRoot, work, 512);
    assert.notEqual(rejected.status, 0, `${mutation} was accepted: ${rejected.stdout}`);
    assert.match(rejected.stderr, /checkpoint workspace changed after suspension/);
    await lstat(marker).then(
      () => assert.fail("checkpoint metadata executed an external command"),
      (error) => assert.equal(error?.code, "ENOENT"),
    );
  }

  const collisionWork = join(root, "workspace-framing-work");
  const collisionFirst = run(worldRoot, collisionWork);
  assert.equal(collisionFirst.status, 0, collisionFirst.stderr);
  const collisionWorkspace = join(collisionWork, "workspace");
  const readmePath = join(collisionWorkspace, "README.md");
  const packagePath = join(collisionWorkspace, "package.json");
  const [readme, packageBytes] = await Promise.all([
    readFile(readmePath),
    readFile(packagePath),
  ]);
  await writeFile(readmePath, Buffer.concat([
    readme,
    Buffer.from("\0package.json\0"),
    packageBytes,
  ]));
  await rm(packagePath);
  const boundaryShift = run(worldRoot, collisionWork);
  assert.notEqual(boundaryShift.status, 0);
  assert.match(boundaryShift.stderr, /checkpoint workspace changed after suspension/);

  const aliasWork = join(root, "census-checkpoint-alias");
  const aliasedOutput = run(worldRoot, aliasWork, 1, [
    "--censusOutput", join(aliasWork, "checkpoint.json"),
  ]);
  assert.notEqual(aliasedOutput.status, 0);
  assert.match(aliasedOutput.stderr, /census-output must not alias the runtime checkpoint/);

  const realAliasRoot = join(root, "canonical-census-root");
  const linkedAliasRoot = join(root, "linked-census-root");
  await mkdir(realAliasRoot);
  await symlink(realAliasRoot, linkedAliasRoot, "dir");
  const aliasedParentOutput = run(worldRoot, join(linkedAliasRoot, "work"), 1, [
    "--censusOutput", join(realAliasRoot, "work/checkpoint.json"),
  ]);
  assert.notEqual(aliasedParentOutput.status, 0);
  assert.match(
    aliasedParentOutput.stderr,
    /census-output must not alias the runtime checkpoint/,
  );

  const existingWork = join(root, "existing-work");
  const existingSource = join(existingWork, "workspace/src/range.mjs");
  await mkdir(join(existingWork, "workspace/src"), { recursive: true });
  await writeFile(existingSource, "must survive\n");
  const overwrite = run(worldRoot, existingWork);
  assert.notEqual(overwrite.status, 0);
  assert.match(overwrite.stderr, /workspace already exists/);
  assert.equal(await readFile(existingSource, "utf8"), "must survive\n");

  const changedWorld = join(root, "changed-world");
  await cp(worldRoot, changedWorld, { recursive: true });
  await appendFile(
    join(changedWorld, "src/process_v1/index.mjs"),
    "\n// unauthorized host mutation\n",
  );
  const changedHost = run(changedWorld, join(root, "changed-host-work"));
  assert.notEqual(changedHost.status, 0);
  assert.match(changedHost.stderr, /executed bytes differ from archive: src\/process_v1\/index\.mjs/);
} finally {
  await rm(root, { recursive: true, force: true });
}
