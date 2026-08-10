import { describe, expect, test } from "bun:test";

import { validateLiveReceipt } from "../tools/actuality/verify-live-receipt.mjs";

const H = "a".repeat(64);
const I = "b".repeat(64);
const W = "c".repeat(64);

describe("released live actuality receipt", () => {
  test("admits exact released evidence and completion predicates", () => {
    expect(validateLiveReceipt(validReceipt(), evidence())).toBe(true);
  });

  test("rejects self-consistent receipt claims without the expected release hashes", () => {
    const receipt = validReceipt();
    receipt.components.agent.archiveSha256 = I;
    expect(() => validateLiveReceipt(receipt, evidence())).toThrow("agent_archive_digest_mismatch");
  });

  test("rejects success before the passing test, approval, or exact effect trace", () => {
    const receipt = validReceipt();
    receipt.workspace.passingTestObserved = false;
    expect(() => validateLiveReceipt(receipt, evidence())).toThrow("passing_test_not_observed");
    receipt.workspace.passingTestObserved = true;
    receipt.approval.approvalBeforeMutation = false;
    expect(() => validateLiveReceipt(receipt, evidence())).toThrow("approval_after_mutation");
    receipt.approval.approvalBeforeMutation = true;
    receipt.run.interfaces.pop();
    expect(() => validateLiveReceipt(receipt, evidence())).toThrow("effect_sequence_invalid");
  });

  test("rejects leaked private material and excess live attempts", () => {
    const receipt = validReceipt();
    receipt.rawModelOutput = "private";
    expect(() => validateLiveReceipt(receipt, evidence())).toThrow("receipt_field_unknown");
    delete receipt.rawModelOutput;
    receipt.attempts.push(
      { ordinal: 2, outcome: "failed" },
      { ordinal: 3, outcome: "failed" },
      { ordinal: 4, outcome: "failed" }
    );
    expect(() => validateLiveReceipt(receipt, evidence())).toThrow("live_attempt_count_invalid");
  });
});

function evidence() {
  return {
    agentArchiveSha256: H,
    boundaryArchiveSha256: H,
    worldArchiveSha256: H,
    worldHostArchiveSha256: H,
    capabilitiesArchiveSha256: I,
    applicationWasmSha256: W,
    applicationManifestSha256: H,
    initialArgsSha256: H,
    decisionContractDigest: H,
    expectedAgentArchiveSha256: H,
    expectedBoundaryArchiveSha256: H,
    expectedWorldArchiveSha256: H,
    expectedWorldHostArchiveSha256: H,
    expectedCapabilitiesArchiveSha256: I,
    expectedApplicationWasmSha256: W,
    expectedAgentVersion: "1.1.1",
    expectedBoundaryVersion: "1.3.2",
    expectedWorldVersion: "3.1.1",
    expectedWorldHostVersion: "1.0.0",
    expectedCapabilitiesVersion: "2.1.1"
  };
}

function validReceipt() {
  return {
    format: "agent-actuality-receipt-v1",
    mode: "live",
    components: {
      agent: { version: "1.1.1", archiveSha256: H },
      boundary: { version: "1.3.2", archiveSha256: H, machineAbi: 2 },
      world: { version: "3.1.1", archiveSha256: H, applicationAbi: 1, frameVersion: 1 },
      worldHost: { version: "1.0.0", archiveSha256: H, runtimeChanged: false },
      worldCapabilities: { version: "2.1.1", archiveSha256: I }
    },
    application: {
      applicationId: H,
      wasmSha256: W,
      wasmBytes: 42,
      wasmImportCount: 0,
      manifestSha256: H,
      initialArgsSha256: H,
      decisionContractDigest: H
    },
    provider: {
      provider: "openai",
      endpoint: "responses",
      requestedModel: "gpt-5.6-sol",
      returnedModels: ["gpt-5.6-sol"],
      store: false,
      toolsCount: 0,
      calls: 1,
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      failures: 0,
      responseIdDigests: [H]
    },
    workspace: {
      controlledFixtureOnly: true,
      changedPaths: ["src/range.mjs"],
      testsChanged: false,
      packageChanged: false,
      failingTestObserved: true,
      passingTestObserved: true,
      hiddenVerifierPassed: true,
      oldSourceSha256: H,
      newSourceSha256: I
    },
    approval: {
      mode: "interactive",
      effectRequestId: H,
      proposalDigest: I,
      approved: true,
      approvalBeforeMutation: true,
      mutationCount: 1
    },
    run: {
      genesisFrameId: H,
      terminalFrameId: I,
      typedFinalResult: true,
      interfaces: [
        "model.decide.v1", "repo.list.v1", "model.decide.v1", "repo.read.v1",
        "model.decide.v1", "repo.read.v1", "model.decide.v1", "repo.test.v1",
        "model.decide.v1", "repo.replace.approved.v1", "model.decide.v1",
        "repo.test.v1", "model.decide.v1"
      ]
    },
    attempts: [{ ordinal: 1, outcome: "succeeded" }],
    lifecycle: {
      freshInstanceResume: true,
      retryChildFrameByteIdentical: true,
      retryFreshMutationCount: 0,
      replayFreshEffects: 0,
      branching: true,
      migration: true,
      migrationReceiverPreflight: true
    },
    redaction: {
      apiKeyRecorded: false,
      rawPromptsPublished: false,
      rawRepositoryBytesPublished: false,
      rawModelOutputsPublished: false,
      privateEvidenceSha256: H
    }
  };
}
