import { describe, expect, it } from "vitest";
import { ArtifactNotFoundError, createArtifact } from "@/core/artifacts";
import { addComment, getFeedback, listComments } from "@/core/feedback";

async function seedArtifact(): Promise<string> {
  const a = await createArtifact({
    bytes: new TextEncoder().encode("<!doctype html><html></html>"),
    filename: "x.html",
    source: "mcp",
    metadata: { title: "Reviewable" },
  });
  return a.id;
}

describe("comments", () => {
  it("adds comments and lists them newest-first", async () => {
    const id = await seedArtifact();
    await addComment({ artifactId: id, authorName: "Alex", body: "first" });
    await addComment({ artifactId: id, authorName: "Sam", body: "second" });

    const rows = await listComments(id);
    expect(rows.map((c) => c.body)).toEqual(["second", "first"]);
    expect(rows[0]?.authorName).toBe("Sam");
  });

  it("rejects comments on an unknown artifact", async () => {
    await expect(
      addComment({ artifactId: "nope", authorName: "Alex", body: "hi" }),
    ).rejects.toBeInstanceOf(ArtifactNotFoundError);
  });
});

describe("getFeedback", () => {
  it("returns comments with a true total and a null summary (synthesis is Phase 4)", async () => {
    const id = await seedArtifact();
    await addComment({ artifactId: id, authorName: "Alex", body: "looks good" });

    const feedback = await getFeedback(id);
    expect(feedback.total).toBe(1);
    expect(feedback.comments).toHaveLength(1);
    expect(feedback.summary).toBeNull();
  });

  it("rejects unknown artifact ids", async () => {
    await expect(getFeedback("nope")).rejects.toBeInstanceOf(ArtifactNotFoundError);
  });
});
