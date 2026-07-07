// Anchored feedback (PLAN Phase 6.4/6.9): the anchor must round-trip through
// core → MCP → share action, while every pre-anchor call shape keeps working
// (additive-only contract). Mirrors share.flow.test.ts's mocking of the
// request-scoped Next glue.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }),
}));

import { describe, expect, it, vi } from "vitest";
import { submitShareComment } from "@/app/share/[token]/actions";
import { createArtifact } from "@/core/artifacts";
import { addComment, listComments } from "@/core/feedback";
import { createShareLink } from "@/core/sharing";
import { connect } from "./mcp-harness";

const enc = (s: string) => new TextEncoder().encode(s);

async function seedArtifact(): Promise<string> {
  const a = await createArtifact({
    bytes: enc("# Notes\n\nThe header is too small.\n"),
    filename: "notes.md",
    source: "web",
    metadata: { title: "Anchor target" },
  });
  return a.id;
}

const QUOTE = {
  type: "text-quote",
  quote: "The header is too small.",
  prefix: "Notes\n\n",
} as const;
const PIN = { type: "image-point", xPct: 42.5, yPct: 61 } as const;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("core addComment anchors", () => {
  it("stores and returns a text-quote anchor", async () => {
    const id = await seedArtifact();
    await addComment({ artifactId: id, authorName: "R", body: "Bump it up", anchor: QUOTE });
    const [comment] = await listComments(id);
    expect(comment?.anchor).toEqual(QUOTE);
  });

  it("plain comments keep a null anchor (back-compat: pre-6.4 call shape)", async () => {
    const id = await seedArtifact();
    await addComment({ artifactId: id, authorName: "R", body: "Nice overall" });
    const [comment] = await listComments(id);
    expect(comment?.anchor).toBeNull();
  });
});

describe("MCP add_comment / get_feedback anchors (additive)", () => {
  it("round-trips a text-quote anchor through both tools", async () => {
    const id = await seedArtifact();
    const { client } = await connect();

    const add = await client.callTool({
      name: "add_comment",
      arguments: { id, authorName: "Reviewer", body: "Font too small here", anchor: QUOTE },
    });
    expect(add.isError ?? false).toBe(false);

    const feedback = await client.callTool({ name: "get_feedback", arguments: { id } });
    const structured = feedback.structuredContent as {
      comments: { body: string; anchor: unknown }[];
    };
    expect(structured.comments[0]?.anchor).toEqual(QUOTE);
  });

  it("accepts an image-point anchor", async () => {
    const id = await seedArtifact();
    const { client } = await connect();
    const add = await client.callTool({
      name: "add_comment",
      arguments: { id, authorName: "Reviewer", body: "This corner", anchor: PIN },
    });
    expect(add.isError ?? false).toBe(false);
    const [comment] = await listComments(id);
    expect(comment?.anchor).toEqual(PIN);
  });

  it("old call shape (no anchor) still works and stores null", async () => {
    const id = await seedArtifact();
    const { client } = await connect();
    const add = await client.callTool({
      name: "add_comment",
      arguments: { id, authorName: "Reviewer", body: "Plain old comment" },
    });
    expect(add.isError ?? false).toBe(false);
    const [comment] = await listComments(id);
    expect(comment?.anchor).toBeNull();
  });

  it("rejects a malformed anchor with a tool error (comment not written)", async () => {
    const id = await seedArtifact();
    const { client } = await connect();
    const add = await client.callTool({
      name: "add_comment",
      arguments: {
        id,
        authorName: "Reviewer",
        body: "bad anchor",
        anchor: { type: "region", x: 1 },
      },
    });
    expect(add.isError).toBe(true);
    expect(await listComments(id)).toHaveLength(0);
  });
});

describe("share-view action anchors", () => {
  it("stores a valid anchor sent as the JSON hidden field", async () => {
    const id = await seedArtifact();
    const link = await createShareLink(id, "24h");
    const res = await submitShareComment(
      form({
        token: link.token,
        authorName: "External",
        body: "make it bigger",
        anchor: JSON.stringify(QUOTE),
      }),
    );
    expect(res.ok).toBe(true);
    const [comment] = await listComments(id);
    expect(comment?.anchor).toEqual(QUOTE);
  });

  it("drops a malformed anchor but keeps the comment (never blocks on the anchor)", async () => {
    const id = await seedArtifact();
    const link = await createShareLink(id, "24h");
    const res = await submitShareComment(
      form({
        token: link.token,
        authorName: "External",
        body: "still valuable",
        anchor: "{not json",
      }),
    );
    expect(res.ok).toBe(true);
    const [comment] = await listComments(id);
    expect(comment?.body).toBe("still valuable");
    expect(comment?.anchor).toBeNull();
  });

  it("drops a schema-invalid anchor but keeps the comment", async () => {
    const id = await seedArtifact();
    const link = await createShareLink(id, "24h");
    const res = await submitShareComment(
      form({
        token: link.token,
        authorName: "External",
        body: "over-long quote",
        anchor: JSON.stringify({ type: "text-quote", quote: "x".repeat(500) }),
      }),
    );
    expect(res.ok).toBe(true);
    const [comment] = await listComments(id);
    expect(comment?.anchor).toBeNull();
  });
});
