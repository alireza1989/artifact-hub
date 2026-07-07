import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { artifacts, comments, shareLinks } from "@/db/schema";
import { seed } from "@/db/seed";
import { InMemoryStorage } from "@/lib/storage";

// The seed reuses the real storage adapter; inject an in-memory fake so the test
// never touches Vercel Blob.
const storage = new InMemoryStorage();
const runSeed = (reset = false) => seed({ reset, storage });

describe("db seed (PLAN §7)", () => {
  it("populates all preview kinds with tags, comments, and a share link", async () => {
    const result = await runSeed();

    const rows = await getDb().select().from(artifacts);
    expect(rows).toHaveLength(result.artifactCount);

    // Every artifact carries at least one tag and a description (product-feel).
    for (const row of rows) {
      expect(row.tags.length).toBeGreaterThan(0);
      expect(row.description).toBeTruthy();
    }

    // Covers the distinct preview strategies (§2).
    const kinds = new Set(rows.map((r) => r.kind));
    for (const kind of ["html", "image", "svg", "pdf", "markdown", "text", "json", "csv"]) {
      expect(kinds).toContain(kind);
    }

    // At least two artifacts have ≥3 comments so the synthesis card shows.
    const byArtifact = await getDb().select({ id: comments.artifactId }).from(comments);
    const counts = new Map<string, number>();
    for (const { id } of byArtifact) counts.set(id, (counts.get(id) ?? 0) + 1);
    const withSynthesis = [...counts.values()].filter((n) => n >= 3);
    expect(withSynthesis.length).toBeGreaterThanOrEqual(2);

    // One active (unexpired, unrevoked) share link.
    const links = await getDb().select().from(shareLinks);
    expect(links).toHaveLength(1);
    expect(links[0]?.revokedAt).toBeNull();
    expect(links[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(result.shareUrl).toContain("/share/");
  });

  it("is idempotent — re-running yields the same demo set, not duplicates", async () => {
    const first = await runSeed();
    const second = await runSeed();

    const rows = await getDb().select().from(artifacts);
    expect(rows).toHaveLength(first.artifactCount);
    expect(second.artifactCount).toBe(first.artifactCount);
    // Re-run replaces the single link rather than accumulating.
    const links = await getDb().select().from(shareLinks);
    expect(links).toHaveLength(1);
  });

  it("--reset clears smoke-test noise but leaves hand-published artifacts", async () => {
    // A smoke leftover and a genuine hand-published artifact.
    await getDb()
      .insert(artifacts)
      .values([
        {
          id: "smoke-xyz",
          title: "Smoke test 2026-07-07T00:00:00Z",
          contentType: "text/html",
          kind: "html",
          tags: ["smoke-test"],
          blobUrl: "mem://smoke",
          sizeBytes: 10,
          source: "api",
        },
        {
          id: "real-keeper",
          title: "Real quarterly plan",
          contentType: "text/markdown",
          kind: "markdown",
          tags: ["planning"],
          blobUrl: "mem://keeper",
          sizeBytes: 10,
          source: "web",
        },
      ]);

    const result = await runSeed(true);
    expect(result.smokeRemoved).toBe(1);

    const ids = new Set(
      (await getDb().select({ id: artifacts.id }).from(artifacts)).map((r) => r.id),
    );
    expect(ids.has("smoke-xyz")).toBe(false);
    expect(ids.has("real-keeper")).toBe(true);
    expect(ids.has("seed-html-landing")).toBe(true);
  });
});

// Isolate from the shared truncate in setup.ts (which runs beforeEach anyway);
// re-truncate here for clarity when this file runs standalone.
beforeEach(async () => {
  await getDb().execute(
    sql`truncate table artifacts, comments, feedback_summaries, share_links, llm_calls restart identity cascade`,
  );
});
