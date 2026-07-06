import { describe, expect, it } from "vitest";
import { addComment } from "@/core/feedback";
import { connect, errorText, seedArtifact } from "./mcp-harness";

// get_artifact, get_feedback, add_comment, hub_stats — open tools (add_comment too).

describe("get_artifact", () => {
  it("returns metadata + inline preview for a text kind", async () => {
    const id = await seedArtifact("Doc", "<!doctype html><h1>Title</h1>");
    const { client, close } = await connect();
    try {
      const res = await client.callTool({ name: "get_artifact", arguments: { id } });
      const sc = res.structuredContent as {
        kind: string;
        preview: { inline?: string; truncated: boolean };
        shareLinks: unknown[];
      };
      expect(sc.kind).toBe("html");
      expect(sc.preview.inline).toContain("Title");
      expect(sc.preview.truncated).toBe(false);
      expect(sc.shareLinks).toEqual([]);
    } finally {
      await close();
    }
  });

  it("errors with a search_artifacts recovery path for an unknown id", async () => {
    const { client, close } = await connect();
    try {
      const res = await client.callTool({ name: "get_artifact", arguments: { id: "missing" } });
      expect(res.isError).toBe(true);
      expect(errorText(res)).toMatch(/search_artifacts/);
    } finally {
      await close();
    }
  });
});

describe("add_comment + get_feedback", () => {
  it("adds a comment WITHOUT a bearer token and reads it back", async () => {
    const id = await seedArtifact("Reviewable");
    const { client, close } = await connect(false); // no token — commenting is open
    try {
      const added = await client.callTool({
        name: "add_comment",
        arguments: { id, authorName: "Alex", body: "looks good" },
      });
      expect(added.isError).toBeFalsy();

      const feedback = await client.callTool({ name: "get_feedback", arguments: { id } });
      const sc = feedback.structuredContent as {
        total: number;
        summary: unknown;
        comments: { authorName: string }[];
      };
      expect(sc.total).toBe(1);
      expect(sc.summary).toBeNull(); // synthesis is Phase 4
      expect(sc.comments[0]?.authorName).toBe("Alex");
    } finally {
      await close();
    }
  });

  it("rejects an over-long comment body at the schema boundary", async () => {
    const id = await seedArtifact("Reviewable2");
    const { client, close } = await connect(false);
    try {
      const res = await client.callTool({
        name: "add_comment",
        arguments: { id, authorName: "Alex", body: "x".repeat(5001) },
      });
      expect(res.isError).toBe(true);
    } finally {
      await close();
    }
  });

  it("errors on get_feedback for an unknown artifact", async () => {
    const { client, close } = await connect();
    try {
      const res = await client.callTool({ name: "get_feedback", arguments: { id: "missing" } });
      expect(res.isError).toBe(true);
      expect(errorText(res)).toMatch(/search_artifacts/);
    } finally {
      await close();
    }
  });
});

describe("hub_stats", () => {
  it("summarizes the catalog", async () => {
    const id = await seedArtifact("Counted");
    await addComment({ artifactId: id, authorName: "Alex", body: "hi" });
    const { client, close } = await connect();
    try {
      const res = await client.callTool({ name: "hub_stats", arguments: {} });
      const sc = res.structuredContent as {
        totalArtifacts: number;
        byKind: Record<string, number>;
        last7d: { artifacts: number; comments: number };
      };
      expect(sc.totalArtifacts).toBe(1);
      expect(sc.byKind.html).toBe(1);
      expect(sc.last7d.comments).toBe(1);
    } finally {
      await close();
    }
  });
});
