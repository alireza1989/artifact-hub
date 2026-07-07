import { describe, expect, it } from "vitest";
import { computeCostUsd } from "@/lib/ai/pricing";

describe("computeCostUsd", () => {
  it("prices Haiku input + output tokens", () => {
    // 1M input @ $1 + 1M output @ $5 = $6.
    expect(computeCostUsd("claude-haiku-4-5-20251001", 1_000_000, 1_000_000)).toBeCloseTo(6, 6);
  });

  it("is zero for no tokens", () => {
    expect(computeCostUsd("claude-haiku-4-5-20251001", 0, 0)).toBe(0);
  });

  it("falls back to the configured model's rate for an unknown id", () => {
    expect(computeCostUsd("some-unknown-model", 1_000_000, 0)).toBeCloseTo(1, 6);
  });
});
