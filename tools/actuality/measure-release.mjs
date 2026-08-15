#!/usr/bin/env bun
import { cp, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const options = parseArguments(process.argv.slice(2));
for (const name of ["agentRoot", "artifactRoot", "worldHostRoot", "capabilitiesRoot"]) {
  if (!options[name]) throw new Error(`--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
}

const agentRoot = resolve(options.agentRoot);
const artifactRoot = resolve(options.artifactRoot);
const hostRoot = resolve(options.worldHostRoot);
const capabilitiesRoot = resolve(options.capabilitiesRoot);
const workerMemoryBytes = Number(options.workerMemoryBytes ?? 512 * 1024 * 1024);
const temporaryRoot = await mkdtemp(join(tmpdir(), "agent-release-measurement-"));

try {
  const host = await import(pathToFileURL(join(hostRoot, "src/v1/index.mjs")));
  const capabilities = await import(pathToFileURL(join(capabilitiesRoot, "src/v1/index.mjs")));
  const workspaceRoot = join(temporaryRoot, "workspace");
  const temporaryHome = join(temporaryRoot, "home");
  await cp(join(agentRoot, "fixtures/repository-repair-v1"), workspaceRoot, { recursive: true, errorOnExist: true });
  await mkdir(temporaryHome);
  await initializeGit(workspaceRoot);

  const wasmBytes = await readFile(join(artifactRoot, "repository-repair-actuality.world.wasm"));
  const initialArgsBytes = await readFile(join(artifactRoot, "initial-args.bin"));
  const controller = await host.RunControllerV1.create({
    wasmBytes,
    blockStore: new host.MemoryBlockStore(),
    headStore: new host.MemoryBranchHeadStore(),
    workerFactory: () => new host.ApplicationWorker({ maximumMemoryBytes: workerMemoryBytes }),
    preflight: async (manifest) => ({
      blockers: Buffer.from(manifest.applicationId).toString("hex") === capabilities.ACTUALITY_APPLICATION_ID
        ? []
        : ["application_identity_mismatch"]
    })
  });
  const router = new capabilities.CapabilityRouterV1({
    bindings: [
      capabilities.repositoryRepairDecisionFixtureBinding(),
      ...capabilities.repositoryWorkspaceBindings()
    ]
  });
  const context = {
    applicationId: capabilities.ACTUALITY_APPLICATION_ID,
    workspaceRoot,
    workspaceRootReal: await realpath(workspaceRoot),
    temporaryHome,
    bunExecutable: process.execPath,
    fixtureInitialManifestMatched: true,
    policy: { repositoryActuality: true, repositoryRepairDecisionFixture: true }
  };

  const stepDurations = [];
  const effects = [];
  const started = performance.now();
  let current = await controller.initialize("measurement", "main", { initialArgsBytes });
  stepDurations.push(performance.now() - started);
  const frames = [frameMeasurement(current.frameBytes, current.frame)];
  const firstFrameBytes = current.frameBytes.length;
  const firstDecisionPayloadBytes = current.frame.pendingEffect?.payloadBytes.length ?? 0;
  let peakFrameBytes = firstFrameBytes;
  let peakStateBytes = current.frame.stateBytes.length;
  let peakDecisionPayloadBytes = firstDecisionPayloadBytes;

  while (current.frame.status === host.FrameStatus.needsEffect ||
      current.frame.status === host.FrameStatus.yieldedFuel) {
    let advanceOptions;
    if (current.frame.status === host.FrameStatus.yieldedFuel) {
      advanceOptions = undefined;
    } else {
      const request = current.frame.pendingEffect;
      const inspected = router.inspect(request.encodedBytes);
      if (inspected.bindingId === "repository-workspace-actuality.replace.v1") {
        const proposal = capabilities.decodeRepositoryReplaceRequest(request.payloadBytes);
        const workspace = await import(pathToFileURL(join(
          capabilitiesRoot,
          "packages/repository-workspace-actuality/adapter.mjs"
        )));
        const proposalDigest = workspace.proposalDigest({ operation: "replace", ...proposal });
        context.fixtureRequestDigest = proposalDigest;
        context.approval = {
          approved: true,
          requestId: Buffer.from(request.requestId).toString("hex"),
          proposalDigest,
          mode: "fixture-auto"
        };
      }
      const resolved = await router.resolve(context, request.encodedBytes);
      effects.push({
        bindingId: inspected.bindingId,
        requestPayloadBytes: request.payloadBytes.length,
        resultPayloadBytes: resolved.result.resultBytes?.length ?? 0
      });
      advanceOptions = {
        effectResult: resolved.result,
        effectMetadata: {
          handlerId: resolved.handlerIdentity,
          handlerConfigurationId: resolved.handlerConfigurationIdentity,
          recoveryClass: resolved.recoveryClass
        }
      };
    }
    const before = performance.now();
    current = advanceOptions === undefined
      ? await controller.advance("measurement", "main")
      : await controller.advance("measurement", "main", advanceOptions);
    stepDurations.push(performance.now() - before);
    frames.push(frameMeasurement(current.frameBytes, current.frame));
    peakFrameBytes = Math.max(peakFrameBytes, current.frameBytes.length);
    peakStateBytes = Math.max(peakStateBytes, current.frame.stateBytes.length);
    if (current.frame.pendingEffect !== null) {
      peakDecisionPayloadBytes = Math.max(
        peakDecisionPayloadBytes,
        current.frame.pendingEffect.payloadBytes.length
      );
    }
  }
  if (current.frame.status !== host.FrameStatus.completed) {
    throw new Error(`measurement_terminal_status:${current.frame.status}`);
  }

  const warm = stepDurations.slice(1).sort((left, right) => left - right);
  process.stdout.write(`${JSON.stringify({
    applicationWasmBytes: wasmBytes.length,
    firstFrameBytes,
    peakFrameBytes,
    peakMachineStateBytes: peakStateBytes,
    firstDecisionPayloadBytes,
    peakDecisionPayloadBytes,
    coldStepNanoseconds: Math.round(stepDurations[0] * 1_000_000),
    warmStepNanoseconds: Math.round(warm[Math.floor(warm.length / 2)] * 1_000_000),
    stepCount: stepDurations.length,
    frames,
    effects
  }, null, 2)}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function initializeGit(workspaceRoot) {
  await git(workspaceRoot, ["init", "--quiet"]);
  await git(workspaceRoot, ["config", "user.name", "Agent Measurement Fixture"]);
  await git(workspaceRoot, ["config", "user.email", "measurement@example.invalid"]);
  await git(workspaceRoot, ["add", "--", "README.md", "package.json", "src/range.mjs", "test/range.test.mjs"]);
  await git(workspaceRoot, ["commit", "--quiet", "-m", "fixture baseline"]);
}

async function git(cwd, argv) {
  const child = Bun.spawn(["git", ...argv], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: process.env.PATH }
  });
  const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) throw new Error(`git_failed:${argv[0]}:${stderr.trim()}`);
}

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    if (!name?.startsWith("--") || index + 1 >= argv.length) throw new Error(`invalid_argument:${name}`);
    result[name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = argv[index + 1];
  }
  return result;
}

function frameMeasurement(frameBytes, frame) {
  return {
    sequence: Number(frame.sequence),
    status: frame.status,
    frameBytes: frameBytes.length,
    stateBytes: frame.stateBytes.length,
    payloadBytes: frame.pendingEffect?.payloadBytes.length ?? 0
  };
}
