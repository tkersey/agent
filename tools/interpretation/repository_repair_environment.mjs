import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function createEnvironment({
  capabilitiesRoot,
  workspaceRoot,
  temporaryHome,
  bunExecutable,
  applicationId
}) {
  const capabilityProtocol = await import(pathToFileURL(join(
    capabilitiesRoot,
    "src/v1/protocol.mjs"
  )));
  const codecs = await import(pathToFileURL(join(
    capabilitiesRoot,
    "src/v1/actuality/repository_repair_codecs.mjs"
  )));
  const fixtureBinding = await import(pathToFileURL(join(
    capabilitiesRoot,
    "src/v1/actuality/repository_repair_fixture_binding.mjs"
  )));
  const workspaceBinding = await import(pathToFileURL(join(
    capabilitiesRoot,
    "src/v1/actuality/repository_workspace_binding.mjs"
  )));
  const workspaceAdapter = await import(pathToFileURL(join(
    capabilitiesRoot,
    "packages/repository-workspace-actuality/adapter.mjs"
  )));
  const fixtureAdapter = await import(pathToFileURL(join(
    capabilitiesRoot,
    "packages/repository-repair-decision-fixture/adapter.mjs"
  )));
  const bindings = Object.freeze([
    fixtureBinding.repositoryRepairDecisionFixtureBinding(),
    ...workspaceBinding.repositoryWorkspaceBindings()
  ]);
  const context = {
    applicationId,
    workspaceRoot,
    workspaceRootReal: await realpath(workspaceRoot),
    temporaryHome,
    bunExecutable,
    fixtureInitialManifestMatched: true,
    policy: Object.freeze({
      repositoryActuality: true,
      repositoryRepairDecisionFixture: true
    })
  };
  return Object.freeze({
    bindings,
    context,
    expectedDecisionContractDigest: fixtureAdapter.INTERPRETATION_DECISION_CONTRACT_DIGEST,
    beforeResolve: async ({ effect, projected }) => {
      if (effect.identity !== "repo.replace.approved.v1") return;
      const proposalDigest = workspaceAdapter.proposalDigest(projected.payload);
      context.fixtureRequestDigest = proposalDigest;
      context.approval = Object.freeze({
        approved: true,
        requestId: projected.requestId,
        proposalDigest,
        mode: "fixture-auto"
      });
    },
    beforeSpecializedResolve: async (request) => {
      const replaceInterfaceId = capabilityProtocol.effectInterfaceId("repo.replace.approved.v1");
      if (!Buffer.from(request.interfaceId).equals(Buffer.from(replaceInterfaceId))) return;
      const proposal = codecs.decodeReplaceRequest(request.payloadBytes);
      const proposalDigest = workspaceAdapter.proposalDigest({ operation: "replace", ...proposal });
      context.fixtureRequestDigest = proposalDigest;
      context.approval = Object.freeze({
        approved: true,
        requestId: Buffer.from(request.requestId).toString("hex"),
        proposalDigest,
        mode: "fixture-auto"
      });
    },
    verifyTerminal: async (finalResultBytes) => {
      const result = codecs.decodeFinalResult(finalResultBytes);
      const source = await readFile(join(workspaceRoot, "src/range.mjs"));
      const hiddenVerifierPassed = await hiddenVerify(workspaceRoot);
      if (result.tests_passed !== true || result.changed_files.length !== 1 ||
          result.changed_files[0] !== "src/range.mjs" ||
          result.final_source_sha256 !== sha256(source) || !hiddenVerifierPassed) {
        throw new Error("interpreted_terminal_verification_failed");
      }
      return Object.freeze({ result, hiddenVerifierPassed, finalSource: source });
    }
  });
}

async function hiddenVerify(workspaceRoot) {
  const module = await import(`${pathToFileURL(join(workspaceRoot, "src/range.mjs")).href}?digest=${Date.now()}`);
  const cases = [
    [1, 3, { start: 1, end: 3 }],
    [3, 1, { start: 1, end: 3 }],
    [2, 2, { start: 2, end: 2 }],
    [-1, -5, { start: -5, end: -1 }]
  ];
  return cases.every(([start, end, expected]) =>
    JSON.stringify(module.normalizeRange(start, end)) === JSON.stringify(expected));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
