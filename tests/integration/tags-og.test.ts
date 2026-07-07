// Phase 6.7 (tag cleanup) + 6.8 (OG unfurl) integration: deterministic merge
// application, the suggest→apply pipeline with a stubbed model, and share-page
// metadata that never double-counts a view.
const sessionState = { valid: true };
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  hasValidSession: async () => sessionState.valid,
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTagMergesAction, suggestTagMergesAction } from "@/app/(gallery)/admin/actions";
import { generateMetadata } from "@/app/share/[token]/page";
import { suggestTagMerges } from "@/core/ai";
import { applyTagMerges, createArtifact, getArtifact, listTagUsage } from "@/core/artifacts";
import { createShareLink, listShareLinks } from "@/core/sharing";
import { type ModelCaller, setModelCallerForTesting } from "@/lib/ai";

const enc = (s: string) => new TextEncoder().encode(s);

async function seed(title: string, tags: string[]) {
  return createArtifact({
    bytes: enc(`# ${title}`),
    filename: `${title}.md`,
    source: "api",
    metadata: { title, tags },
  });
}

const mergesCaller = (merges: { from: string[]; to: string }[]): ModelCaller => {
  return async () => ({
    text: JSON.stringify({ merges }),
    inputTokens: 10,
    outputTokens: 5,
    stopReason: "end_turn",
  });
};

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  sessionState.valid = true;
});

describe("tag cleanup (Phase 6.7)", () => {
  it("listTagUsage aggregates counts across artifacts", async () => {
    await seed("A", ["design", "mockups"]);
    await seed("B", ["design"]);
    const usage = await listTagUsage();
    expect(usage[0]).toEqual({ tag: "design", count: 2 });
    expect(usage).toContainEqual({ tag: "mockups", count: 1 });
  });

  it("applyTagMerges rewrites, dedupes, and reports affected artifacts", async () => {
    const a = await seed("A", ["mockups", "design"]);
    const b = await seed("B", ["ui-mockup", "mockup"]);
    const untouched = await seed("C", ["report"]);

    const { artifactsUpdated } = await applyTagMerges([
      { from: ["mockups", "ui-mockup"], to: "mockup" },
    ]);
    expect(artifactsUpdated).toBe(2);
    expect((await getArtifact(a.id)).tags).toEqual(["mockup", "design"]);
    // "ui-mockup" → "mockup" collides with the existing "mockup" → deduped.
    expect((await getArtifact(b.id)).tags).toEqual(["mockup"]);
    expect((await getArtifact(untouched.id)).tags).toEqual(["report"]);
  });

  it("suggestTagMerges only proposes over the real vocabulary (stubbed model)", async () => {
    await seed("A", ["mockups"]);
    await seed("B", ["mockup"]);
    setModelCallerForTesting(
      mergesCaller([
        { from: ["mockups"], to: "mockup" },
        { from: ["invented-tag"], to: "mockup" },
      ]),
    );
    const result = await suggestTagMerges();
    expect(result.suggested).toBe(true);
    if (result.suggested) {
      expect(result.merges).toEqual([{ from: ["mockups"], to: "mockup" }]);
    }
  });

  it("falls back to no-suggestions when the model output is unusable", async () => {
    await seed("A", ["mockups"]);
    await seed("B", ["mockup"]);
    // Default stub returns non-JSON → fallback → suggested:false.
    const result = await suggestTagMerges();
    expect(result.suggested).toBe(false);
  });

  it("actions: suggest requires a session; apply validates and executes", async () => {
    const a = await seed("A", ["mockups"]);

    sessionState.valid = false;
    const denied = await suggestTagMergesAction({}, form({}));
    expect(denied.error).toContain("Unlock");

    sessionState.valid = true;
    const bad = await applyTagMergesAction({}, form({ merges: "not json" }));
    expect(bad.error).toBeDefined();

    const ok = await applyTagMergesAction(
      {},
      form({ merges: JSON.stringify([{ from: ["mockups"], to: "mockup" }]) }),
    );
    expect(ok.updated).toBe(1);
    expect((await getArtifact(a.id)).tags).toEqual(["mockup"]);
  });
});

describe("share unfurl metadata (Phase 6.8)", () => {
  it("returns artifact title/description without counting a view", async () => {
    const a = await createArtifact({
      bytes: enc("# Unfurl me"),
      filename: "u.md",
      source: "api",
      metadata: { title: "Unfurl me", description: "A test doc" },
    });
    const link = await createShareLink(a.id, "24h");

    const metadata = await generateMetadata({ params: Promise.resolve({ token: link.token }) });
    expect(metadata.title).toBe("Unfurl me — Artifact Hub");
    expect(metadata.description).toBe("A test doc");
    expect(metadata.robots).toMatchObject({ index: false });

    // The unfurl pass must NOT count as a view.
    const [row] = await listShareLinks(a.id);
    expect(row?.accessCount).toBe(0);
  });

  it("unfurls generically for an invalid token", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ token: "abcdefabcdef.deadbeefdeadbeef" }),
    });
    expect(metadata.title).toBe("Shared artifact — Artifact Hub");
    expect(metadata.description).toBeUndefined();
  });
});
