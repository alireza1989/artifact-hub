// Re-run AI on an existing artifact (PLAN Phase 6.6): regenerateMetadata applies
// the full fresh suggestion + audit record (all badges reappear); a fallback
// outcome changes nothing. invalidateSynthesis drops the stored summary so the
// next getFeedback regenerates. Actions are session-gated.
const sessionState = { valid: true };
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("@/lib/auth/session", () => ({
  hasValidSession: async () => sessionState.valid,
}));

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { refreshSynthesisAction, regenerateMetadataAction } from "@/app/(gallery)/actions";
import { invalidateSynthesis } from "@/core/ai";
import { getArtifact, publishArtifact, regenerateMetadata } from "@/core/artifacts";
import { addComment, getFeedback } from "@/core/feedback";
import { getDb } from "@/db";
import { feedbackSummaries } from "@/db/schema";
import { type ModelCaller, setModelCallerForTesting } from "@/lib/ai";

const enc = (s: string) => new TextEncoder().encode(s);

const metadataCaller = (payload: {
  title: string;
  description: string;
  tags: string[];
}): ModelCaller => {
  return async () => ({
    text: JSON.stringify(payload),
    inputTokens: 10,
    outputTokens: 5,
    stopReason: "end_turn",
  });
};

const synthesisCaller = (point: string): ModelCaller => {
  return async (input) => {
    // The instruction lists comment ids; cite the first one it mentions.
    const text = input.content.find((c) => c.type === "text");
    const id = /\[id: ([^\]]+)\]/.exec(text && "text" in text ? text.text : "")?.[1] ?? "c1";
    return {
      text: JSON.stringify({
        consensus: [{ point, commentIds: [id] }],
        disagreements: [],
        actionItems: [],
        sentiment: "positive",
      }),
      inputTokens: 10,
      outputTokens: 5,
      stopReason: "end_turn",
    };
  };
};

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  sessionState.valid = true;
});

describe("regenerateMetadata (core)", () => {
  it("applies the full fresh suggestion and records it for the badges", async () => {
    const { artifact } = await publishArtifact({
      bytes: enc("# Old doc"),
      filename: "old.md",
      source: "api",
      metadata: { title: "Manual title", description: "manual", tags: ["manual"] },
    });
    setModelCallerForTesting(
      metadataCaller({ title: "Fresh Title", description: "Fresh desc", tags: ["fresh"] }),
    );

    const result = await regenerateMetadata(artifact.id);
    expect(result.regenerated).toBe(true);
    const updated = await getArtifact(artifact.id);
    expect(updated.title).toBe("Fresh Title");
    expect(updated.tags).toEqual(["fresh"]);
    // Full audit record → every field badges as "suggested" until edited.
    expect(updated.aiGeneratedMeta).toEqual({
      title: "Fresh Title",
      description: "Fresh desc",
      tags: ["fresh"],
    });
  });

  it("changes nothing when the model falls back", async () => {
    const { artifact } = await publishArtifact({
      bytes: enc("# Keep me"),
      filename: "keep.md",
      source: "api",
      metadata: { title: "Keep title", tags: ["keep"] },
    });
    // Default test stub returns non-JSON → fallback.
    const result = await regenerateMetadata(artifact.id);
    expect(result.regenerated).toBe(false);
    const unchanged = await getArtifact(artifact.id);
    expect(unchanged.title).toBe("Keep title");
    expect(unchanged.tags).toEqual(["keep"]);
  });
});

describe("invalidateSynthesis (core)", () => {
  it("drops the stored summary; next read regenerates from current comments", async () => {
    const { artifact } = await publishArtifact({
      bytes: enc("# Reviewed"),
      filename: "r.md",
      source: "api",
      metadata: { title: "Reviewed", tags: ["t"] },
    });
    await addComment({ artifactId: artifact.id, authorName: "A", body: "great" });
    await addComment({ artifactId: artifact.id, authorName: "B", body: "love it" });

    setModelCallerForTesting(synthesisCaller("v1 summary"));
    const first = await getFeedback(artifact.id);
    expect(first.summary?.consensus[0]?.point).toBe("v1 summary");

    await invalidateSynthesis(artifact.id);
    const [stored] = await getDb()
      .select()
      .from(feedbackSummaries)
      .where(eq(feedbackSummaries.artifactId, artifact.id));
    expect(stored).toBeUndefined();

    setModelCallerForTesting(synthesisCaller("v2 summary"));
    const second = await getFeedback(artifact.id);
    expect(second.summary?.consensus[0]?.point).toBe("v2 summary");
  });
});

describe("regenerateSynthesis (core — safe refresh, review 2026-07-07)", () => {
  it("replaces the summary on success, keeps the old one on model failure", async () => {
    const { artifact } = await publishArtifact({
      bytes: enc("# Safe refresh"),
      filename: "s.md",
      source: "api",
      metadata: { title: "Safe refresh", tags: ["t"] },
    });
    await addComment({ artifactId: artifact.id, authorName: "A", body: "great" });
    await addComment({ artifactId: artifact.id, authorName: "B", body: "love it" });

    setModelCallerForTesting(synthesisCaller("original"));
    expect((await getFeedback(artifact.id)).summary?.consensus[0]?.point).toBe("original");

    // Failure path: default-invalid model output → regenerate reports false and
    // the ORIGINAL summary survives (the old delete-then-lazy flow destroyed it).
    const { regenerateSynthesis } = await import("@/core/ai");
    const { resetModelCaller } = await import("@/lib/ai");
    resetModelCaller();
    const { setModelCallerForTesting: set } = await import("@/lib/ai");
    set(async () => ({
      text: "not json",
      inputTokens: 1,
      outputTokens: 1,
      stopReason: "end_turn",
    }));
    expect(await regenerateSynthesis(artifact.id)).toBe(false);
    expect((await getFeedback(artifact.id)).summary?.consensus[0]?.point).toBe("original");

    // Success path: fresh summary replaces the stored one.
    setModelCallerForTesting(synthesisCaller("refreshed"));
    expect(await regenerateSynthesis(artifact.id)).toBe(true);
    expect((await getFeedback(artifact.id)).summary?.consensus[0]?.point).toBe("refreshed");
  });

  it("passes anchored-comment quotes through to the model prompt (was silently dropped)", async () => {
    const { artifact } = await publishArtifact({
      bytes: enc("# Anchored"),
      filename: "an.md",
      source: "api",
      metadata: { title: "Anchored", tags: ["t"] },
    });
    await addComment({
      artifactId: artifact.id,
      authorName: "A",
      body: "too small",
      anchor: { type: "text-quote", quote: "The header is tiny" },
    });
    await addComment({ artifactId: artifact.id, authorName: "B", body: "agree" });

    let seenInstruction = "";
    setModelCallerForTesting(async (input) => {
      const text = input.content.find((c) => c.type === "text");
      seenInstruction = text && "text" in text ? text.text : "";
      const id = /\[id: ([^\]]+)\]/.exec(seenInstruction)?.[1] ?? "c1";
      return {
        text: JSON.stringify({
          consensus: [{ point: "p", commentIds: [id] }],
          disagreements: [],
          actionItems: [],
          sentiment: "positive",
        }),
        inputTokens: 1,
        outputTokens: 1,
        stopReason: "end_turn",
      };
    });
    await getFeedback(artifact.id);
    expect(seenInstruction).toContain('(about the passage: "The header is tiny")');
  });
});

describe("re-run actions (session gates)", () => {
  it("regenerate action reports failure without a session", async () => {
    sessionState.valid = false;
    const state = await regenerateMetadataAction({}, form({ id: "a_whatever123" }));
    expect(state.error).toContain("Unlock");
  });

  it("refresh action redirects without a session", async () => {
    sessionState.valid = false;
    await expect(refreshSynthesisAction(form({ id: "a_whatever123" }))).rejects.toThrow(
      "REDIRECT:/unlock",
    );
  });

  it("regenerate action applies suggestions when authed", async () => {
    const { artifact } = await publishArtifact({
      bytes: enc("# Action doc"),
      filename: "a.md",
      source: "api",
      metadata: { title: "Before", tags: ["b"] },
    });
    setModelCallerForTesting(metadataCaller({ title: "After", description: "d", tags: ["after"] }));
    const state = await regenerateMetadataAction({}, form({ id: artifact.id }));
    expect(state.ok).toBe(true);
    expect((await getArtifact(artifact.id)).title).toBe("After");
  });
});
