import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { POST as publish } from "@/app/api/v1/artifacts/route";
import { suggestMetadata } from "@/core/ai";
import { publishArtifact } from "@/core/artifacts";
import { getDb } from "@/db";
import { llmCalls } from "@/db/schema";
import { type ModelCaller, setModelCallerForTesting } from "@/lib/ai";
import { connect } from "./mcp-harness";

const enc = (s: string) => new TextEncoder().encode(s);
const HTML = "<!doctype html><html><body><h1>A landing page</h1></body></html>";

// A caller that returns a fixed, valid metadata payload.
function metadataCaller(payload: {
  title: string;
  description: string;
  tags: string[];
}): ModelCaller {
  return async () => ({
    text: JSON.stringify(payload),
    inputTokens: 20,
    outputTokens: 10,
    stopReason: "end_turn",
  });
}

const GOOD = { title: "AI Title", description: "AI description", tags: ["ai", "auto"] };

function publishJson(body: unknown): Request {
  return new Request("http://localhost/api/v1/artifacts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.ADMIN_API_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
}

describe("Feature A — auto-metadata (core publishArtifact)", () => {
  it("fills all omitted fields and records the audit + aiFilled", async () => {
    setModelCallerForTesting(metadataCaller(GOOD));
    const { artifact, aiFilled } = await publishArtifact({
      bytes: enc(HTML),
      filename: "x.html",
      source: "web",
    });
    expect(aiFilled.sort()).toEqual(["description", "tags", "title"]);
    expect(artifact.title).toBe("AI Title");
    expect(artifact.tags).toEqual(["ai", "auto"]);
    expect(artifact.aiGeneratedMeta).toMatchObject({ title: "AI Title", tags: ["ai", "auto"] });
  });

  it("only fills the fields the caller omitted", async () => {
    setModelCallerForTesting(metadataCaller(GOOD));
    const { artifact, aiFilled } = await publishArtifact({
      bytes: enc(HTML),
      filename: "x.html",
      source: "web",
      metadata: { title: "Human Title" },
    });
    expect(aiFilled.sort()).toEqual(["description", "tags"]);
    expect(artifact.title).toBe("Human Title");
    expect(artifact.aiGeneratedMeta?.title).toBeUndefined();
  });

  it("never blocks publish when the model fails (deterministic fallback)", async () => {
    setModelCallerForTesting(async () => ({
      text: "not json",
      inputTokens: 0,
      outputTokens: 0,
      stopReason: "end_turn",
    }));
    const { artifact, aiFilled } = await publishArtifact({
      bytes: enc(HTML),
      filename: "my-page.html",
      source: "web",
    });
    expect(aiFilled).toEqual([]);
    expect(artifact.title).toBe("my-page"); // filename-derived fallback
    expect(artifact.aiGeneratedMeta).toBeNull();
    const rows = await getDb().select().from(llmCalls).where(eq(llmCalls.feature, "metadata-gen"));
    expect(rows.at(-1)?.outcome).toBe("fallback");
  });

  it("constrains hostile model output (hygiene guardrail)", async () => {
    setModelCallerForTesting(
      metadataCaller({
        title: "# PWNED <script>alert(1)</script> Title",
        description: "**bold** <b>x</b>",
        tags: ["HACK", "hack", "SoLongItExceedsTheThirtyCharacterCap!!", "a", "b", "c", "d", "e"],
      }),
    );
    const { artifact } = await publishArtifact({
      bytes: enc(HTML),
      filename: "x.html",
      source: "web",
    });
    expect(artifact.title).not.toContain("<");
    expect(artifact.title).not.toContain("#");
    expect(artifact.title.length).toBeLessThanOrEqual(80);
    expect(artifact.tags.length).toBeLessThanOrEqual(5);
    expect(artifact.tags).toContain("hack");
    // de-duped: only one "hack"
    expect(artifact.tags.filter((t) => t === "hack")).toHaveLength(1);
  });

  it("caps oversized input before the model call", async () => {
    let seenChars = 0;
    setModelCallerForTesting(async (input) => {
      const block = input.content.find((b) => b.type === "text");
      seenChars = block && "text" in block ? block.text.length : 0;
      return {
        text: JSON.stringify(GOOD),
        inputTokens: 1,
        outputTokens: 1,
        stopReason: "end_turn",
      };
    });
    await suggestMetadata({
      bytes: enc("x".repeat(50_000)),
      kind: "text",
      contentType: "text/plain",
      filename: "big.txt",
    });
    // Head + tail cap is 16k chars; the prompt wrapper adds a small fixed prefix.
    expect(seenChars).toBeLessThan(17_000);
  });
});

describe("Feature A — REST + MCP surfaces", () => {
  it("REST publish returns aiFilled and AI-filled title", async () => {
    setModelCallerForTesting(metadataCaller(GOOD));
    const res = await publish(publishJson({ content: HTML, filename: "p.html" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.title).toBe("AI Title");
    expect(body.aiFilled.sort()).toEqual(["description", "tags", "title"]);
  });

  it("MCP publish_artifact reports aiFilled", async () => {
    setModelCallerForTesting(metadataCaller(GOOD));
    const { client, close } = await connect();
    try {
      const res = await client.callTool({
        name: "publish_artifact",
        arguments: { content: HTML, filename: "p.html" },
      });
      const sc = res.structuredContent as { title: string; aiFilled: string[] };
      expect(sc.title).toBe("AI Title");
      expect(sc.aiFilled.sort()).toEqual(["description", "tags", "title"]);
    } finally {
      await close();
    }
  });
});
