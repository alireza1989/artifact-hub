import { mkdirSync, writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { suggestMetadata, synthesizeComments, translateNlQuery } from "@/core/ai";
import type { ArtifactKind } from "@/lib/validation";
import { loadFixtures } from "./loader";
import {
  average,
  type MetadataFixture,
  type MetadataScore,
  type NlSearchFixture,
  type NlSearchScore,
  rate,
  type SynthesisFixture,
  type SynthesisScore,
  scoreMetadata,
  scoreNlSearch,
  scoreSynthesis,
  THRESHOLDS,
} from "./score";

// End-to-end LLM eval (PLAN §5.4). Runs the real metadata + synthesis pipelines
// against Haiku for every golden fixture, scores them, prints a scorecard, writes
// evals/report.json, and asserts the thresholds (schema validity 100%, injection
// resistance 100%, plus loose overlap/coverage floors). Failure exits non-zero.

let metaScores: MetadataScore[] = [];
let synthScores: SynthesisScore[] = [];
let nlScores: NlSearchScore[] = [];

function bytesFor(fixture: MetadataFixture): Uint8Array {
  if (fixture.contentBase64) return new Uint8Array(Buffer.from(fixture.contentBase64, "base64"));
  return new TextEncoder().encode(fixture.content ?? "");
}

beforeAll(async () => {
  const metaFixtures = loadFixtures<MetadataFixture>("metadata-gen");
  metaScores = [];
  for (const fixture of metaFixtures) {
    const result = await suggestMetadata({
      bytes: bytesFor(fixture),
      kind: fixture.kind as ArtifactKind,
      contentType: fixture.contentType,
      filename: fixture.filename,
    });
    metaScores.push(scoreMetadata(fixture, result));
  }

  const synthFixtures = loadFixtures<SynthesisFixture>("feedback-synthesis");
  synthScores = [];
  for (const fixture of synthFixtures) {
    const batch = fixture.comments.map((c, i) => ({
      id: `c${i + 1}`,
      authorName: c.authorName,
      body: c.body,
    }));
    const validIds = new Set(batch.map((b) => b.id));
    const summary = await synthesizeComments(batch);
    synthScores.push(scoreSynthesis(fixture, summary, validIds));
  }

  const nlFixtures = loadFixtures<NlSearchFixture>("nl-search");
  nlScores = [];
  for (const fixture of nlFixtures) {
    const filters = await translateNlQuery(fixture.query);
    nlScores.push(scoreNlSearch(fixture, filters));
  }

  const overlaps = metaScores.map((s) => s.tagOverlap).filter((v): v is number => v !== null);

  const report = {
    generatedAt: new Date().toISOString(),
    metadata: {
      count: metaScores.length,
      schemaValidRate: rate(metaScores.map((s) => s.schemaValid)),
      lengthOkRate: rate(metaScores.map((s) => s.lengthOk)),
      injectionResistantRate: rate(metaScores.map((s) => s.injectionResistant)),
      avgTagOverlap: average(overlaps),
      scores: metaScores,
    },
    synthesis: {
      count: synthScores.length,
      schemaValidRate: rate(synthScores.map((s) => s.schemaValid)),
      traceableRate: rate(synthScores.map((s) => s.traceable)),
      injectionResistantRate: rate(synthScores.map((s) => s.injectionResistant)),
      avgCoverage: average(synthScores.map((s) => s.coverage)),
      scores: synthScores,
    },
    nlSearch: {
      count: nlScores.length,
      schemaValidRate: rate(nlScores.map((s) => s.schemaValid)),
      injectionResistantRate: rate(nlScores.map((s) => s.injectionResistant)),
      avgFilterAccuracy: average(nlScores.map((s) => s.filterAccuracy)),
      scores: nlScores,
    },
    thresholds: THRESHOLDS,
  };

  mkdirSync("evals", { recursive: true });
  writeFileSync("evals/report.json", `${JSON.stringify(report, null, 2)}\n`);

  printScorecard(report);
}, 300_000);

describe("metadata-gen eval", () => {
  it("schema validity is 100%", () => {
    expect(rate(metaScores.map((s) => s.schemaValid))).toBeGreaterThanOrEqual(
      THRESHOLDS.metadataSchemaValidRate,
    );
  });
  it("length constraints hold for every artifact", () => {
    expect(rate(metaScores.map((s) => s.lengthOk))).toBeGreaterThanOrEqual(
      THRESHOLDS.metadataLengthOkRate,
    );
  });
  it("resists the injection attempt (no attacker-planted strings)", () => {
    expect(rate(metaScores.map((s) => s.injectionResistant))).toBeGreaterThanOrEqual(
      THRESHOLDS.metadataInjectionResistantRate,
    );
  });
  it("average tag overlap clears the floor", () => {
    const overlaps = metaScores.map((s) => s.tagOverlap).filter((v): v is number => v !== null);
    expect(average(overlaps)).toBeGreaterThanOrEqual(THRESHOLDS.metadataAvgTagOverlap);
  });
});

describe("feedback-synthesis eval", () => {
  it("schema validity is 100%", () => {
    expect(rate(synthScores.map((s) => s.schemaValid))).toBeGreaterThanOrEqual(
      THRESHOLDS.synthesisSchemaValidRate,
    );
  });
  it("every bullet cites a valid comment id (traceability)", () => {
    expect(rate(synthScores.map((s) => s.traceable))).toBeGreaterThanOrEqual(
      THRESHOLDS.synthesisTraceableRate,
    );
  });
  it("resists the injected comment", () => {
    expect(rate(synthScores.map((s) => s.injectionResistant))).toBeGreaterThanOrEqual(
      THRESHOLDS.synthesisInjectionResistantRate,
    );
  });
  it("average expected-key coverage clears the floor", () => {
    expect(average(synthScores.map((s) => s.coverage))).toBeGreaterThanOrEqual(
      THRESHOLDS.synthesisAvgCoverage,
    );
  });
});

describe("nl-search eval", () => {
  it("every query yields a usable translation (schema validity 100%)", () => {
    expect(rate(nlScores.map((s) => s.schemaValid))).toBeGreaterThanOrEqual(
      THRESHOLDS.nlSearchSchemaValidRate,
    );
  });
  it("resists injection typed into the search box", () => {
    expect(rate(nlScores.map((s) => s.injectionResistant))).toBeGreaterThanOrEqual(
      THRESHOLDS.nlSearchInjectionResistantRate,
    );
  });
  it("average filter accuracy (kind/terms/time extraction) clears the floor", () => {
    expect(average(nlScores.map((s) => s.filterAccuracy))).toBeGreaterThanOrEqual(
      THRESHOLDS.nlSearchAvgFilterAccuracy,
    );
  });
});

function printScorecard(report: {
  metadata: {
    schemaValidRate: number;
    lengthOkRate: number;
    injectionResistantRate: number;
    avgTagOverlap: number;
    count: number;
  };
  synthesis: {
    schemaValidRate: number;
    traceableRate: number;
    injectionResistantRate: number;
    avgCoverage: number;
    count: number;
  };
  nlSearch: {
    schemaValidRate: number;
    injectionResistantRate: number;
    avgFilterAccuracy: number;
    count: number;
  };
}) {
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
  const lines = [
    "",
    "═══ LLM eval scorecard ═══",
    `metadata-gen (${report.metadata.count} fixtures)`,
    `  schema valid:        ${pct(report.metadata.schemaValidRate)}  (≥ ${pct(THRESHOLDS.metadataSchemaValidRate)})`,
    `  length ok:           ${pct(report.metadata.lengthOkRate)}  (≥ ${pct(THRESHOLDS.metadataLengthOkRate)})`,
    `  injection resistant: ${pct(report.metadata.injectionResistantRate)}  (≥ ${pct(THRESHOLDS.metadataInjectionResistantRate)})`,
    `  avg tag overlap:     ${pct(report.metadata.avgTagOverlap)}  (≥ ${pct(THRESHOLDS.metadataAvgTagOverlap)})`,
    `feedback-synthesis (${report.synthesis.count} fixtures)`,
    `  schema valid:        ${pct(report.synthesis.schemaValidRate)}  (≥ ${pct(THRESHOLDS.synthesisSchemaValidRate)})`,
    `  traceable:           ${pct(report.synthesis.traceableRate)}  (≥ ${pct(THRESHOLDS.synthesisTraceableRate)})`,
    `  injection resistant: ${pct(report.synthesis.injectionResistantRate)}  (≥ ${pct(THRESHOLDS.synthesisInjectionResistantRate)})`,
    `  avg key coverage:    ${pct(report.synthesis.avgCoverage)}  (≥ ${pct(THRESHOLDS.synthesisAvgCoverage)})`,
    `nl-search (${report.nlSearch.count} fixtures)`,
    `  schema valid:        ${pct(report.nlSearch.schemaValidRate)}  (≥ ${pct(THRESHOLDS.nlSearchSchemaValidRate)})`,
    `  injection resistant: ${pct(report.nlSearch.injectionResistantRate)}  (≥ ${pct(THRESHOLDS.nlSearchInjectionResistantRate)})`,
    `  avg filter accuracy: ${pct(report.nlSearch.avgFilterAccuracy)}  (≥ ${pct(THRESHOLDS.nlSearchAvgFilterAccuracy)})`,
    "report written to evals/report.json",
    "══════════════════════════",
    "",
  ];
  console.log(lines.join("\n"));
}
