import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { llmCalls } from "@/db/schema";
import {
  BUDGET_EXCEEDED_ERROR,
  type ModelCaller,
  runFeature,
  setModelCallerForTesting,
} from "@/lib/ai";
import { getEnv } from "@/lib/env";

// runFeature guardrails (PLAN §5.3/§5.4): schema-validate → one retry → deterministic
// fallback, budget ceiling, and one telemetry row per logical call with the right
// outcome. The low-level model call is stubbed so the wrapper logic runs for real.

type Resp = string | Error;

function scriptedCaller(responses: Resp[]): { caller: ModelCaller; count: () => number } {
  let i = 0;
  const caller: ModelCaller = async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (r instanceof Error) throw r;
    return { text: r as string, inputTokens: 10, outputTokens: 4, stopReason: "end_turn" };
  };
  return { caller, count: () => i };
}

const parse = (text: string): { v: string } | null => {
  try {
    const o = JSON.parse(text) as { v?: unknown };
    return typeof o.v === "string" ? { v: o.v } : null;
  } catch {
    return null;
  }
};

function run(caller: ModelCaller) {
  setModelCallerForTesting(caller);
  return runFeature<{ v: string }>({
    feature: "metadata-gen",
    promptVersion: "test@1",
    system: "s",
    content: [{ type: "text", text: "hi" }],
    jsonSchema: { type: "object" },
    parse,
    fallback: { v: "FALLBACK" },
    maxTokens: 100,
  });
}

async function rowsFor(feature: string) {
  return getDb().select().from(llmCalls).where(eq(llmCalls.feature, feature));
}

describe("runFeature", () => {
  it("records ok on a first-try valid response", async () => {
    const res = await run(scriptedCaller([JSON.stringify({ v: "hello" })]).caller);
    expect(res).toMatchObject({ value: { v: "hello" }, outcome: "ok", usedAi: true });
    const rows = await rowsFor("metadata-gen");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("ok");
    expect(rows[0]?.inputTokens).toBe(10);
  });

  it("retries once then records schema_retry_ok", async () => {
    const s = scriptedCaller(["garbage", JSON.stringify({ v: "second" })]);
    const res = await run(s.caller);
    expect(res).toMatchObject({ value: { v: "second" }, outcome: "schema_retry_ok", usedAi: true });
    expect(s.count()).toBe(2);
    const rows = await rowsFor("metadata-gen");
    expect(rows[0]?.outcome).toBe("schema_retry_ok");
    expect(rows[0]?.inputTokens).toBe(20); // summed across both attempts
  });

  it("falls back deterministically after two invalid responses", async () => {
    const s = scriptedCaller(["nope", "still nope"]);
    const res = await run(s.caller);
    expect(res).toMatchObject({ value: { v: "FALLBACK" }, outcome: "fallback", usedAi: false });
    expect(s.count()).toBe(2);
    expect((await rowsFor("metadata-gen"))[0]?.outcome).toBe("fallback");
  });

  it("records error and falls back when the model call throws", async () => {
    const res = await run(scriptedCaller([new Error("boom")]).caller);
    expect(res).toMatchObject({ outcome: "error", usedAi: false });
    const rows = await rowsFor("metadata-gen");
    expect(rows[0]?.outcome).toBe("error");
    expect(rows[0]?.error).toContain("boom");
  });

  it("short-circuits to fallback when the daily budget is exhausted", async () => {
    const budget = getEnv().AI_DAILY_CALL_BUDGET;
    await getDb()
      .insert(llmCalls)
      .values(
        Array.from({ length: budget }, () => ({
          feature: "metadata-gen",
          model: "m",
          promptVersion: "seed",
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: 0,
          costUsd: "0.000000",
          outcome: "ok" as const,
        })),
      );

    const s = scriptedCaller([JSON.stringify({ v: "should not be reached" })]);
    const res = await run(s.caller);
    expect(res.outcome).toBe("fallback");
    expect(res.usedAi).toBe(false);
    expect(s.count()).toBe(0); // model never called
    const budgetRow = (await rowsFor("metadata-gen")).find(
      (r) => r.error === BUDGET_EXCEEDED_ERROR,
    );
    expect(budgetRow).toBeDefined();
  });
});
