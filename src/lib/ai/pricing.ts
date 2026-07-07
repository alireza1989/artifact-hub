import { AI_MODEL } from "./config";

// USD per 1M tokens (input, output). Kept here so a price change is one edit and
// the telemetry cost column (PLAN §5.4) stays honest. Haiku 4.5 rates.
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0 },
};

// Cost of one call in USD. Falls back to the configured model's rate for an
// unknown id so a model bump never silently records $0.
export function computeCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const rate = PRICING[model] ?? PRICING[AI_MODEL];
  if (!rate) return 0;
  return (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
}
