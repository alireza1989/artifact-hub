import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { llmCalls } from "@/db/schema";
import { logger } from "@/lib/logger";
import type { AiFeature } from "./config";
import { computeCostUsd } from "./pricing";

// Outcome taxonomy (PLAN §5.4): a first-try schema-valid response is `ok`; a valid
// response only after the corrective retry is `schema_retry_ok`; schema-invalid
// twice OR a tripped daily budget yields `fallback`; an API/exception failure
// yields `error`. Every non-`ok` path still returns a deterministic fallback.
export type LlmOutcome = "ok" | "schema_retry_ok" | "fallback" | "error";

// Marker error text for budget-tripped rows. Kept distinct so it shows in the
// /admin/ai failures feed but is excluded from the budget count itself (otherwise
// a tripped budget would inflate its own counter on every subsequent read).
export const BUDGET_EXCEEDED_ERROR = "daily call budget exceeded";

function startOfUtcDay(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// True once a feature has made its configured number of real attempts today.
// DB failure fails open (allow the call) — the budget is a spend guardrail, not a
// correctness gate, and telemetry outages must not block the product.
export async function isBudgetExceeded(feature: AiFeature, budget: number): Promise<boolean> {
  try {
    const [row] = await getDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(llmCalls)
      .where(
        and(
          eq(llmCalls.feature, feature),
          gte(llmCalls.createdAt, startOfUtcDay()),
          // Exclude prior budget-tripped rows so they don't count toward the cap.
          // IS DISTINCT FROM (not <>) so the null-error rows — the normal calls —
          // are still counted (`null <> 'x'` is null, which would drop them).
          sql`${llmCalls.error} is distinct from ${BUDGET_EXCEEDED_ERROR}`,
        ),
      );
    return (row?.n ?? 0) >= budget;
  } catch (err) {
    logger.error({ err, feature }, "ai budget check failed; allowing call");
    return false;
  }
}

export type LlmCallRecord = {
  feature: AiFeature;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  outcome: LlmOutcome;
  artifactId?: string | null;
  error?: string | null;
};

// One row per logical feature call (PLAN §5.4). Cost is derived from the pricing
// map. Telemetry is best-effort: a write failure is logged and swallowed so the
// feature it measures never fails because its measurement did.
export async function recordLlmCall(record: LlmCallRecord): Promise<void> {
  const costUsd = computeCostUsd(record.model, record.inputTokens, record.outputTokens);
  try {
    await getDb()
      .insert(llmCalls)
      .values({
        feature: record.feature,
        model: record.model,
        promptVersion: record.promptVersion,
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
        latencyMs: record.latencyMs,
        costUsd: costUsd.toFixed(6),
        outcome: record.outcome,
        artifactId: record.artifactId ?? null,
        error: record.error ?? null,
      });
  } catch (err) {
    logger.error({ err, feature: record.feature }, "failed to record llm_call telemetry");
  }
}
