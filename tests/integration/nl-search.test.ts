import { desc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { searchArtifactsNaturally } from "@/core/ai";
import { createArtifact } from "@/core/artifacts";
import { getDb } from "@/db";
import { llmCalls } from "@/db/schema";
import { type ModelCaller, setModelCallerForTesting } from "@/lib/ai";
import { listQuerySchema } from "@/lib/validation";
import { connect } from "./mcp-harness";

// Feature C end-to-end (PLAN Phase 6.3) against the test DB with the model
// stubbed at the lib/ai boundary — same pattern as Features A/B.

const enc = (s: string) => new TextEncoder().encode(s);

function nlCaller(payload: {
  terms: string;
  kind: string | null;
  tags: string[];
  since_days: number | null;
}): ModelCaller {
  return async () => ({
    text: JSON.stringify(payload),
    inputTokens: 15,
    outputTokens: 8,
    stopReason: "end_turn",
  });
}

const parse = (input: Record<string, unknown>) => listQuerySchema.parse(input);

async function seedCatalog() {
  const html = await createArtifact({
    bytes: enc("<!doctype html><title>Pricing mockup</title>"),
    filename: "pricing.html",
    source: "api",
    metadata: { title: "Pricing page mockup", tags: ["design"] },
  });
  const doc = await createArtifact({
    bytes: enc("# Quarterly report\nNumbers went up."),
    filename: "report.md",
    source: "api",
    metadata: { title: "Quarterly report", tags: ["report"] },
  });
  return { html, doc };
}

describe("searchArtifactsNaturally", () => {
  it("keyword queries bypass the LLM entirely (no llm_calls row)", async () => {
    await seedCatalog();
    const result = await searchArtifactsNaturally(parse({ q: "pricing" }));
    expect(result.items.map((i) => i.title)).toContain("Pricing page mockup");
    const calls = await getDb().select().from(llmCalls).where(eq(llmCalls.feature, "nl-search"));
    expect(calls).toHaveLength(0);
  });

  it("translates a natural query into filters and records telemetry", async () => {
    const { html } = await seedCatalog();
    setModelCallerForTesting(nlCaller({ terms: "", kind: "html", tags: [], since_days: null }));

    const result = await searchArtifactsNaturally(parse({ q: "all the web page mockups we made" }));
    expect(result.items.map((i) => i.id)).toEqual([html.id]);

    const [call] = await getDb()
      .select()
      .from(llmCalls)
      .where(eq(llmCalls.feature, "nl-search"))
      .orderBy(desc(llmCalls.createdAt))
      .limit(1);
    expect(call?.outcome).toBe("ok");
    expect(call?.promptVersion).toBe("nl-search@1");
  });

  it("applies a translated since_days window", async () => {
    const { html } = await seedCatalog();
    // Backdate the markdown artifact beyond the window.
    const { artifacts } = await import("@/db/schema");
    await getDb()
      .update(artifacts)
      .set({ createdAt: new Date(Date.now() - 30 * 86_400_000) })
      .where(eq(artifacts.title, "Quarterly report"));
    setModelCallerForTesting(nlCaller({ terms: "", kind: null, tags: [], since_days: 7 }));

    const result = await searchArtifactsNaturally(parse({ q: "everything from this last week" }));
    expect(result.items.map((i) => i.id)).toEqual([html.id]);
  });

  it("falls back to raw FTS when the model output is unusable", async () => {
    await seedCatalog();
    // Default stub from setup.ts returns non-JSON → translation fails → raw FTS
    // with the original words (which must therefore all appear in the doc).
    const result = await searchArtifactsNaturally(parse({ q: "pricing page mockup design" }));
    expect(result.items.map((i) => i.title)).toContain("Pricing page mockup");
    const [call] = await getDb().select().from(llmCalls).where(eq(llmCalls.feature, "nl-search"));
    expect(call?.outcome).toBe("fallback");
  });

  it("re-runs the original query when a translation over-narrows to zero results", async () => {
    await seedCatalog();
    setModelCallerForTesting(
      nlCaller({ terms: "pricing", kind: "pdf", tags: [], since_days: null }),
    );
    const result = await searchArtifactsNaturally(parse({ q: "pricing page mockup design" }));
    // Translated (kind=pdf) matches nothing → falls back to the words the user typed.
    expect(result.items.map((i) => i.title)).toContain("Pricing page mockup");
  });

  it("never overrides an explicit kind filter", async () => {
    await seedCatalog();
    setModelCallerForTesting(
      nlCaller({ terms: "report", kind: "html", tags: [], since_days: null }),
    );
    const result = await searchArtifactsNaturally(
      parse({ q: "the quarterly report we published", kind: "markdown" }),
    );
    expect(result.items.map((i) => i.title)).toEqual(["Quarterly report"]);
  });
});

describe("MCP search_artifacts natural mode (additive)", () => {
  it("default path is unchanged raw search even for long queries", async () => {
    await seedCatalog();
    const { client } = await connect();
    const res = await client.callTool({
      name: "search_artifacts",
      arguments: { q: "pricing mockup for the new site" },
    });
    expect(res.isError ?? false).toBe(false);
    // No natural flag → no LLM call recorded.
    const calls = await getDb().select().from(llmCalls).where(eq(llmCalls.feature, "nl-search"));
    expect(calls).toHaveLength(0);
  });

  it("natural: true routes through the translator", async () => {
    const { html } = await seedCatalog();
    setModelCallerForTesting(nlCaller({ terms: "", kind: "html", tags: [], since_days: null }));
    const { client } = await connect();
    const res = await client.callTool({
      name: "search_artifacts",
      arguments: { q: "all the web page mockups we made", natural: true },
    });
    expect(res.isError ?? false).toBe(false);
    const structured = res.structuredContent as { items: { id: string }[] };
    expect(structured.items.map((i) => i.id)).toEqual([html.id]);
  });

  it("accepts the additive since filter", async () => {
    const { html, doc } = await seedCatalog();
    const { artifacts } = await import("@/db/schema");
    await getDb()
      .update(artifacts)
      .set({ createdAt: new Date(Date.now() - 30 * 86_400_000) })
      .where(eq(artifacts.id, doc.id));
    const { client } = await connect();
    const res = await client.callTool({
      name: "search_artifacts",
      arguments: { since: new Date(Date.now() - 7 * 86_400_000).toISOString() },
    });
    const structured = res.structuredContent as { items: { id: string }[] };
    expect(structured.items.map((i) => i.id)).toEqual([html.id]);
  });
});
