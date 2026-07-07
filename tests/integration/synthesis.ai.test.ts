import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createArtifact } from "@/core/artifacts";
import { addComment, getFeedback } from "@/core/feedback";
import { getDb } from "@/db";
import { feedbackSummaries } from "@/db/schema";
import { type ModelCaller, setModelCallerForTesting } from "@/lib/ai";
import { connect } from "./mcp-harness";

// A synthesis caller that reads the real comment ids out of the fenced prompt and
// cites them, so parseSynthesis keeps the points (realistic + deterministic).
function synthesisCaller(counter?: { calls: number }, delayMs = 0): ModelCaller {
  return async (input) => {
    if (counter) counter.calls += 1;
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    const text = input.content.map((b) => ("text" in b ? b.text : "")).join("");
    const ids = [...text.matchAll(/\[id: ([^\]]+)\]/g)].map((m) => m[1] as string);
    const summary = {
      consensus: [{ point: "Reviewers agree it is strong", commentIds: ids.slice(0, 2) }],
      disagreements: [],
      actionItems: [{ point: "Tighten the copy", commentIds: [ids[0]] }],
      sentiment: "positive",
    };
    return {
      text: JSON.stringify(summary),
      inputTokens: 40,
      outputTokens: 20,
      stopReason: "end_turn",
    };
  };
}

async function seedWithComments(n: number): Promise<string> {
  const a = await createArtifact({
    bytes: new TextEncoder().encode("<!doctype html><html></html>"),
    filename: "x.html",
    source: "web",
    metadata: { title: "Reviewable" },
  });
  for (let i = 0; i < n; i++) {
    await addComment({ artifactId: a.id, authorName: `R${i}`, body: `comment ${i}` });
  }
  return a.id;
}

describe("Feature B — feedback synthesis", () => {
  it("returns no summary below 2 comments", async () => {
    setModelCallerForTesting(synthesisCaller());
    const id = await seedWithComments(1);
    const feedback = await getFeedback(id);
    expect(feedback.summary).toBeNull();
    const rows = await getDb()
      .select()
      .from(feedbackSummaries)
      .where(eq(feedbackSummaries.artifactId, id));
    expect(rows).toHaveLength(0);
  });

  it("generates a summary at 2+ comments, citing real comment ids", async () => {
    setModelCallerForTesting(synthesisCaller());
    const id = await seedWithComments(2);
    const feedback = await getFeedback(id);
    expect(feedback.summary).not.toBeNull();
    expect(feedback.summary?.sentiment).toBe("positive");
    const citedIds = feedback.summary?.consensus[0]?.commentIds ?? [];
    const realIds = new Set(feedback.comments.map((c) => c.id));
    expect(citedIds.length).toBeGreaterThan(0);
    expect(citedIds.every((cid) => realIds.has(cid))).toBe(true);

    const [row] = await getDb()
      .select()
      .from(feedbackSummaries)
      .where(eq(feedbackSummaries.artifactId, id));
    expect(row?.commentCountAtGeneration).toBe(2);
  });

  it("reuses a fresh summary without regenerating", async () => {
    const counter = { calls: 0 };
    setModelCallerForTesting(synthesisCaller(counter));
    const id = await seedWithComments(2);
    await getFeedback(id);
    await getFeedback(id);
    expect(counter.calls).toBe(1);
  });

  it("regenerates when comments have changed (staleness)", async () => {
    const counter = { calls: 0 };
    setModelCallerForTesting(synthesisCaller(counter));
    const id = await seedWithComments(2);
    await getFeedback(id);
    await addComment({ artifactId: id, authorName: "New", body: "another" });
    await getFeedback(id);
    expect(counter.calls).toBe(2);
    const [row] = await getDb()
      .select()
      .from(feedbackSummaries)
      .where(eq(feedbackSummaries.artifactId, id));
    expect(row?.commentCountAtGeneration).toBe(3);
  });

  it("single-flights concurrent readers (generates once)", async () => {
    const counter = { calls: 0 };
    setModelCallerForTesting(synthesisCaller(counter, 50));
    const id = await seedWithComments(3);
    await Promise.all([getFeedback(id), getFeedback(id), getFeedback(id), getFeedback(id)]);
    expect(counter.calls).toBe(1);
    const rows = await getDb()
      .select()
      .from(feedbackSummaries)
      .where(eq(feedbackSummaries.artifactId, id));
    expect(rows).toHaveLength(1);
  });

  it("drops points that cite non-existent comment ids (traceability guardrail)", async () => {
    setModelCallerForTesting(async () => ({
      text: JSON.stringify({
        consensus: [{ point: "cites a ghost", commentIds: ["ghost-id"] }],
        disagreements: [],
        actionItems: [],
        sentiment: "mixed",
      }),
      inputTokens: 10,
      outputTokens: 10,
      stopReason: "end_turn",
    }));
    const id = await seedWithComments(2);
    const feedback = await getFeedback(id);
    // The invalid-id point is dropped; nothing with a bogus citation survives.
    expect(feedback.summary?.consensus).toEqual([]);
  });

  it("exposes the summary through the MCP get_feedback tool", async () => {
    setModelCallerForTesting(synthesisCaller());
    const id = await seedWithComments(2);
    const { client, close } = await connect(false);
    try {
      const res = await client.callTool({ name: "get_feedback", arguments: { id } });
      const sc = res.structuredContent as {
        total: number;
        summary: { sentiment: string; consensus: { commentIds: string[] }[] } | null;
      };
      expect(sc.total).toBe(2);
      expect(sc.summary?.sentiment).toBe("positive");
      expect(sc.summary?.consensus[0]?.commentIds.length).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });
});
