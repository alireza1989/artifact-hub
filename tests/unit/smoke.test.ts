import { describe, expect, it } from "vitest";
import { AI_FEATURE_MODELS, AI_MODEL } from "../../src/lib/ai/config";

// Phase 0 smoke test: proves the Vitest harness runs and the model id is centralized
// (CLAUDE.md: never hardcode a model id elsewhere). Real suites arrive with core/ in Phase 1.
describe("ai config", () => {
  it("centralizes the Haiku model id across every feature", () => {
    expect(AI_MODEL).toMatch(/^claude-haiku/);
    for (const model of Object.values(AI_FEATURE_MODELS)) {
      expect(model).toBe(AI_MODEL);
    }
  });
});
