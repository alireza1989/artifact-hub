import { describe, expect, it } from "vitest";
import { parseSynthesis } from "@/lib/ai/prompts/feedback-synthesis.v1";
import { parseMetadata } from "@/lib/ai/prompts/metadata-gen.v1";

describe("parseMetadata (output hygiene guardrail)", () => {
  it("parses a valid response", () => {
    const out = parseMetadata(
      JSON.stringify({
        title: "Sales report",
        description: "Q3 numbers",
        tags: ["sales", "report"],
      }),
    );
    expect(out).toEqual({
      title: "Sales report",
      description: "Q3 numbers",
      tags: ["sales", "report"],
    });
  });

  it("returns null for non-JSON", () => {
    expect(parseMetadata("not json at all")).toBeNull();
  });

  it("returns null for the wrong shape", () => {
    expect(parseMetadata(JSON.stringify({ title: "x", description: "y" }))).toBeNull();
  });

  it("strips markdown/HTML from text fields", () => {
    const out = parseMetadata(
      JSON.stringify({ title: "# Hello <b>World</b>", description: "**bold** text", tags: ["a"] }),
    );
    expect(out?.title).toBe("Hello World");
    expect(out?.description).toBe("bold text");
  });

  it("truncates an over-long title to 80 chars", () => {
    const out = parseMetadata(
      JSON.stringify({ title: "x".repeat(200), description: "d", tags: ["t"] }),
    );
    expect(out?.title.length).toBe(80);
  });

  it("lowercases, de-dupes, and caps tags at 5", () => {
    const out = parseMetadata(
      JSON.stringify({
        title: "t",
        description: "d",
        tags: ["Sales", "sales", "A", "B", "C", "D", "E", "F"],
      }),
    );
    expect(out?.tags).toEqual(["sales", "a", "b", "c", "d"]);
  });

  it("returns null when there are no usable tags", () => {
    expect(parseMetadata(JSON.stringify({ title: "t", description: "d", tags: [] }))).toBeNull();
  });

  it("returns null when the title is empty after cleaning", () => {
    expect(
      parseMetadata(JSON.stringify({ title: "###", description: "d", tags: ["t"] })),
    ).toBeNull();
  });
});

describe("parseSynthesis (traceability + blast-radius guardrail)", () => {
  const ids = new Set(["c1", "c2"]);

  it("parses a valid summary", () => {
    const out = parseSynthesis(
      JSON.stringify({
        consensus: [{ point: "Everyone likes it", commentIds: ["c1", "c2"] }],
        disagreements: [],
        actionItems: [],
        sentiment: "positive",
      }),
      ids,
    );
    expect(out?.sentiment).toBe("positive");
    expect(out?.consensus[0]?.commentIds).toEqual(["c1", "c2"]);
  });

  it("drops cited ids that aren't in the valid set", () => {
    const out = parseSynthesis(
      JSON.stringify({
        consensus: [{ point: "p", commentIds: ["c1", "c9", "fake"] }],
        disagreements: [],
        actionItems: [],
        sentiment: "mixed",
      }),
      ids,
    );
    expect(out?.consensus[0]?.commentIds).toEqual(["c1"]);
  });

  it("drops points left with no valid citation", () => {
    const out = parseSynthesis(
      JSON.stringify({
        consensus: [{ point: "no real ids", commentIds: ["bogus"] }],
        disagreements: [],
        actionItems: [],
        sentiment: "mixed",
      }),
      ids,
    );
    expect(out?.consensus).toEqual([]);
  });

  it("returns null for non-JSON", () => {
    expect(parseSynthesis("nope", ids)).toBeNull();
  });

  it("returns null for an invalid sentiment", () => {
    const out = parseSynthesis(
      JSON.stringify({ consensus: [], disagreements: [], actionItems: [], sentiment: "furious" }),
      ids,
    );
    expect(out).toBeNull();
  });
});
