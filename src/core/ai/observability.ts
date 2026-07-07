import { desc, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { llmCalls } from "@/db/schema";
import type { LlmOutcome } from "@/lib/ai";

// Read models for /admin/ai (PLAN §5.4). All aggregates come straight from the
// llm_calls telemetry table — small, honest, real.

export type AiWindowStats = {
  windowHours: number;
  totalCalls: number;
  totalCostUsd: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  outcomes: Record<LlmOutcome, number>;
};

export type AiFailure = {
  feature: string;
  outcome: string;
  error: string | null;
  latencyMs: number;
  createdAt: Date;
};

const OUTCOME_ZERO: Record<LlmOutcome, number> = {
  ok: 0,
  schema_retry_ok: 0,
  fallback: 0,
  error: 0,
};

function since(hours: number): Date {
  return new Date(Date.now() - hours * 3_600_000);
}

export async function getAiWindowStats(windowHours: number): Promise<AiWindowStats> {
  const start = since(windowHours);
  const [agg] = await getDb()
    .select({
      total: sql<number>`count(*)::int`,
      cost: sql<number>`coalesce(sum(cost_usd), 0)::float8`,
      p50: sql<number | null>`percentile_cont(0.5) within group (order by latency_ms)`,
      p95: sql<number | null>`percentile_cont(0.95) within group (order by latency_ms)`,
    })
    .from(llmCalls)
    .where(gte(llmCalls.createdAt, start));

  const rows = await getDb()
    .select({ outcome: llmCalls.outcome, n: sql<number>`count(*)::int` })
    .from(llmCalls)
    .where(gte(llmCalls.createdAt, start))
    .groupBy(llmCalls.outcome);

  const outcomes = { ...OUTCOME_ZERO };
  for (const row of rows) outcomes[row.outcome as LlmOutcome] = row.n;

  return {
    windowHours,
    totalCalls: agg?.total ?? 0,
    totalCostUsd: agg?.cost ?? 0,
    p50LatencyMs: agg?.p50 != null ? Math.round(agg.p50) : null,
    p95LatencyMs: agg?.p95 != null ? Math.round(agg.p95) : null,
    outcomes,
  };
}

export async function getRecentAiFailures(limit = 10): Promise<AiFailure[]> {
  return getDb()
    .select({
      feature: llmCalls.feature,
      outcome: llmCalls.outcome,
      error: llmCalls.error,
      latencyMs: llmCalls.latencyMs,
      createdAt: llmCalls.createdAt,
    })
    .from(llmCalls)
    .where(inArray(llmCalls.outcome, ["fallback", "error"]))
    .orderBy(desc(llmCalls.createdAt))
    .limit(limit);
}
