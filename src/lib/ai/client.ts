import type Anthropic from "@anthropic-ai/sdk";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { AI_FEATURE_MODELS, type AiFeature } from "./config";
import { callModel } from "./model";
import {
  BUDGET_EXCEEDED_ERROR,
  isBudgetExceeded,
  type LlmOutcome,
  recordLlmCall,
} from "./telemetry";

// Appended to the system prompt on the single retry. Deliberately terse: the
// structured-outputs schema already constrains shape; this nudges past a transient
// non-conforming response (refusal, truncation) before the deterministic fallback.
const RETRY_HINT =
  "Your previous response could not be parsed. Respond with ONLY a single JSON object " +
  "that matches the required schema — no prose, no code fences, no explanation.";

export type RunFeatureInput<T> = {
  feature: AiFeature;
  promptVersion: string;
  system: string;
  content: Anthropic.ContentBlockParam[];
  jsonSchema: Record<string, unknown>;
  // Parse + coerce raw model text into the validated value, or null if it can't be
  // made to conform. Length caps and output hygiene (PLAN §5.3) live here.
  parse: (rawText: string) => T | null;
  fallback: T;
  maxTokens: number;
  artifactId?: string | null;
};

export type RunFeatureResult<T> = {
  value: T;
  outcome: LlmOutcome;
  // True only when the value came from the model (outcome ok | schema_retry_ok).
  // Callers use this to decide whether to store/surface an AI-generated result.
  usedAi: boolean;
};

// The single entry point for every LLM feature (PLAN §5). Enforces the daily
// budget, calls the model with schema-constrained output, validates + retries
// once, falls back deterministically, and writes exactly one telemetry row. Never
// throws: a failure always resolves to the caller's fallback so publish/read flows
// are never blocked by the AI.
export async function runFeature<T>(input: RunFeatureInput<T>): Promise<RunFeatureResult<T>> {
  const model = AI_FEATURE_MODELS[input.feature];
  const budget = getEnv().AI_DAILY_CALL_BUDGET;
  const started = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;

  const record = (outcome: LlmOutcome, error?: string) =>
    recordLlmCall({
      feature: input.feature,
      model,
      promptVersion: input.promptVersion,
      inputTokens,
      outputTokens,
      latencyMs: Date.now() - started,
      outcome,
      artifactId: input.artifactId,
      error,
    });

  if (await isBudgetExceeded(input.feature, budget)) {
    logger.warn({ feature: input.feature, budget }, "ai daily budget exceeded; using fallback");
    await record("fallback", BUDGET_EXCEEDED_ERROR);
    return { value: input.fallback, outcome: "fallback", usedAi: false };
  }

  try {
    const first = await callModel({
      model,
      system: input.system,
      content: input.content,
      jsonSchema: input.jsonSchema,
      maxTokens: input.maxTokens,
    });
    inputTokens += first.inputTokens;
    outputTokens += first.outputTokens;

    const firstValue = input.parse(first.text);
    if (firstValue !== null) {
      await record("ok");
      return { value: firstValue, outcome: "ok", usedAi: true };
    }

    const second = await callModel({
      model,
      system: `${input.system}\n\n${RETRY_HINT}`,
      content: input.content,
      jsonSchema: input.jsonSchema,
      maxTokens: input.maxTokens,
    });
    inputTokens += second.inputTokens;
    outputTokens += second.outputTokens;

    const secondValue = input.parse(second.text);
    if (secondValue !== null) {
      await record("schema_retry_ok");
      return { value: secondValue, outcome: "schema_retry_ok", usedAi: true };
    }

    await record("fallback", "schema validation failed after one retry");
    return { value: input.fallback, outcome: "fallback", usedAi: false };
  } catch (err) {
    logger.error({ err, feature: input.feature }, "ai model call failed; using fallback");
    // Message only (never the stack or any request detail) so nothing sensitive
    // lands in the llm_calls.error column.
    const message = err instanceof Error ? err.message : "unknown error";
    await record("error", message.slice(0, 500));
    return { value: input.fallback, outcome: "error", usedAi: false };
  }
}
