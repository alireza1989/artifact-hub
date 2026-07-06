import { describe, expect, it } from "vitest";
import { createArtifact } from "@/core/artifacts";
import { addComment } from "@/core/feedback";
import { hubStats } from "@/core/stats";

async function seed(kind: "html" | "json", tags: string[]): Promise<string> {
  const bytes =
    kind === "json"
      ? new TextEncoder().encode('{"a":1}')
      : new TextEncoder().encode("<!doctype html><html></html>");
  const a = await createArtifact({
    bytes,
    filename: kind === "json" ? "d.json" : "p.html",
    source: "mcp",
    metadata: { title: `t-${kind}`, tags },
  });
  return a.id;
}

describe("hubStats", () => {
  it("reports totals, per-kind counts, top tags, and recent activity", async () => {
    await seed("html", ["design", "web"]);
    await seed("html", ["design"]);
    const withComment = await seed("json", ["data"]);
    await addComment({ artifactId: withComment, authorName: "Alex", body: "nice" });

    const stats = await hubStats();
    expect(stats.totalArtifacts).toBe(3);
    expect(stats.byKind.html).toBe(2);
    expect(stats.byKind.json).toBe(1);
    expect(stats.topTags[0]).toEqual({ tag: "design", count: 2 });
    expect(stats.last7d.artifacts).toBe(3);
    expect(stats.last7d.comments).toBe(1);
  });

  it("is safe on an empty catalog", async () => {
    const stats = await hubStats();
    expect(stats.totalArtifacts).toBe(0);
    expect(stats.topTags).toEqual([]);
    expect(stats.last7d).toEqual({ artifacts: 0, comments: 0 });
  });
});
