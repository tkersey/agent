import { describe, expect, test } from "bun:test";

import {
  admitSuccessfulProviderClaims,
  failedAttemptReceipt
} from "../tools/actuality/live.mjs";

const EffectStatus = Object.freeze({ ok: 0, rejected: 1, failed: 2, deferred: 3, cancelled: 4 });

describe("live actuality failure receipts", () => {
  test("rejects failed effects before decoding success-only host claims", () => {
    expect(() => admitSuccessfulProviderClaims({
      status: EffectStatus.failed,
      hostClaims: new Uint8Array(0)
    }, EffectStatus)).toThrow("model_effect_failed");
  });

  test("admits bounded successful provider claims", () => {
    const claims = admitSuccessfulProviderClaims({
      status: EffectStatus.ok,
      hostClaims: Buffer.from(JSON.stringify({
        returnedModel: "gpt-5.6-sol",
        responseIdSha256: "a".repeat(64),
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120
      }))
    }, EffectStatus);
    expect(claims.returnedModel).toBe("gpt-5.6-sol");
  });

  test("emits a redacted failed-attempt receipt", () => {
    const receipt = failedAttemptReceipt({
      model: "gpt-5.6-sol",
      context: { modelCalls: 1, providerFailures: 1 },
      genesisFrameId: "a".repeat(64),
      terminalFrameId: null,
      interfaces: ["model.decide.v1"],
      failureCode: "model_effect_failed"
    });
    expect(receipt.live_attempt_count).toBe(1);
    expect(receipt.live_success_count).toBe(0);
    expect(receipt.provider_failure_count).toBe(1);
    expect(receipt.failure_code).toBe("model_effect_failed");
    expect(receipt.openai_api_key_recorded).toBe(false);
    expect(receipt.public_receipt_contains_raw_prompt).toBe(false);
    expect(receipt.public_receipt_contains_raw_repository_bytes).toBe(false);
    expect(receipt.public_receipt_contains_raw_model_output).toBe(false);
  });
});
