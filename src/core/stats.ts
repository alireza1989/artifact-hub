import { gte, sql } from "drizzle-orm";
import { getDb, rowsOf } from "@/db";
import { artifacts, comments } from "@/db/schema";

export type HubStats = {
  totalArtifacts: number;
  byKind: Record<string, number>;
  topTags: { tag: string; count: number }[];
  last7d: { artifacts: number; comments: number };
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Cheap catalog overview for situational-awareness queries (PLAN §4.1 hub_stats).
// A handful of aggregates; no user input, so nothing to validate.
export async function hubStats(): Promise<HubStats> {
  const db = getDb();
  const since = new Date(Date.now() - SEVEN_DAYS_MS);

  const [totalRow] = await db.select({ n: sql<number>`count(*)::int` }).from(artifacts);
  const kindRows = await db
    .select({ kind: artifacts.kind, n: sql<number>`count(*)::int` })
    .from(artifacts)
    .groupBy(artifacts.kind);
  const tagRows = rowsOf<{ tag: string; n: number }>(
    await db.execute(sql`
      select unnest(${artifacts.tags}) as tag, count(*)::int as n
      from ${artifacts}
      group by tag
      order by n desc, tag asc
      limit 10
    `),
  );
  const [artifacts7d] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(artifacts)
    .where(gte(artifacts.createdAt, since));
  const [comments7d] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(comments)
    .where(gte(comments.createdAt, since));

  const byKind: Record<string, number> = {};
  for (const row of kindRows) byKind[row.kind] = row.n;

  return {
    totalArtifacts: totalRow?.n ?? 0,
    byKind,
    topTags: tagRows.map((r) => ({ tag: r.tag, count: r.n })),
    last7d: { artifacts: artifacts7d?.n ?? 0, comments: comments7d?.n ?? 0 },
  };
}
