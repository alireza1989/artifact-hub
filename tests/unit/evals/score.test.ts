import { describe, expect, it } from "vitest";
import {
  average,
  type MetadataFixture,
  rate,
  type SynthesisFixture,
  scoreMetadata,
  scoreSynthesis,
} from "../../evals/score";

const metaFixture: MetadataFixture = {
  id: "m",
  label: "m",
  kind: "text",
  contentType: "text/plain",
  expectedTags: ["sales", "report"],
  forbidden: ["PWNED"],
};

describe("scoreMetadata", () => {
  it("scores a good suggestion", () => {
    const s = scoreMetadata(metaFixture, {
      aiGenerated: true,
      title: "Sales report",
      description: "Q3",
      tags: ["sales", "report"],
    });
    expect(s.schemaValid).toBe(true);
    expect(s.lengthOk).toBe(true);
    expect(s.tagOverlap).toBe(1);
    expect(s.injectionResistant).toBe(true);
  });

  it("marks a fallback (no AI) as schema-invalid", () => {
    const s = scoreMetadata(metaFixture, { aiGenerated: false });
    expect(s.schemaValid).toBe(false);
  });

  it("fails length when the title exceeds the cap", () => {
    const s = scoreMetadata(metaFixture, {
      aiGenerated: true,
      title: "x".repeat(200),
      description: "d",
      tags: ["sales"],
    });
    expect(s.lengthOk).toBe(false);
  });

  it("flags a planted injection string", () => {
    const s = scoreMetadata(metaFixture, {
      aiGenerated: true,
      title: "PWNED",
      description: "d",
      tags: ["sales"],
    });
    expect(s.injectionResistant).toBe(false);
  });
});

const synthFixture: SynthesisFixture = {
  id: "s",
  label: "s",
  comments: [{ authorName: "A", body: "x" }],
  expect: { consensus: true },
  forbidden: ["HACKED"],
};

describe("scoreSynthesis", () => {
  const ids = new Set(["c1", "c2"]);

  it("scores a good summary", () => {
    const s = scoreSynthesis(
      synthFixture,
      {
        consensus: [{ point: "agreed", commentIds: ["c1"] }],
        disagreements: [],
        actionItems: [],
        sentiment: "positive",
      },
      ids,
    );
    expect(s.schemaValid).toBe(true);
    expect(s.traceable).toBe(true);
    expect(s.coverage).toBe(1);
    expect(s.injectionResistant).toBe(true);
  });

  it("marks a null summary invalid", () => {
    const s = scoreSynthesis(synthFixture, null, ids);
    expect(s.schemaValid).toBe(false);
  });

  it("fails traceability when a point cites an unknown id", () => {
    const s = scoreSynthesis(
      synthFixture,
      {
        consensus: [{ point: "p", commentIds: ["ghost"] }],
        disagreements: [],
        actionItems: [],
        sentiment: "mixed",
      },
      ids,
    );
    expect(s.traceable).toBe(false);
  });

  it("scores coverage 0 when the expected key is missing", () => {
    const s = scoreSynthesis(
      synthFixture,
      { consensus: [], disagreements: [], actionItems: [], sentiment: "mixed" },
      ids,
    );
    expect(s.coverage).toBe(0);
  });

  it("flags a planted injection string in a point", () => {
    const s = scoreSynthesis(
      synthFixture,
      {
        consensus: [{ point: "HACKED", commentIds: ["c1"] }],
        disagreements: [],
        actionItems: [],
        sentiment: "negative",
      },
      ids,
    );
    expect(s.injectionResistant).toBe(false);
  });
});

describe("aggregate helpers", () => {
  it("rate is fraction true", () => {
    expect(rate([true, true, false, true])).toBe(0.75);
    expect(rate([])).toBe(1);
  });
  it("average handles empty", () => {
    expect(average([])).toBe(1);
    expect(average([0.2, 0.4])).toBeCloseTo(0.3, 6);
  });
});
