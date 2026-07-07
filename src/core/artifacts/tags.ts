import { arrayOverlaps, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { artifacts } from "@/db/schema";
import { TAG_MAX_LENGTH, TAGS_MAX } from "@/lib/validation";

// Tag catalog utilities (PLAN Phase 6.7). The AI only *proposes* merges
// (core/ai/tag-normalize); applying them is this plain deterministic function,
// so nothing the model says can mutate data without the owner's explicit
// approval passing through applyTagMerges.

export type TagUsage = { tag: string; count: number };

export async function listTagUsage(): Promise<TagUsage[]> {
  const rows = (await getDb().execute(sql`
    select unnest(${artifacts.tags}) as tag, count(*)::int as n
    from ${artifacts}
    group by tag
    order by n desc, tag asc
  `)) as unknown as { tag: string; n: number }[];
  return [...rows].map((r) => ({ tag: r.tag, count: r.n }));
}

export type TagMerge = { from: string[]; to: string };

// Rewrite every artifact carrying a `from` tag to its `to` tag: dedupe, keep the
// TAGS_MAX cap, single-pass mapping (no chained merges within one apply).
// Transactional so a partial apply never leaves the catalog half-renamed.
export async function applyTagMerges(merges: TagMerge[]): Promise<{ artifactsUpdated: number }> {
  const map = new Map<string, string>();
  for (const merge of merges) {
    const to = merge.to.trim().toLowerCase();
    if (to.length === 0 || to.length > TAG_MAX_LENGTH) continue;
    for (const raw of merge.from) {
      const from = raw.trim().toLowerCase();
      if (from.length > 0 && from !== to) map.set(from, to);
    }
  }
  if (map.size === 0) return { artifactsUpdated: 0 };

  return getDb().transaction(async (tx) => {
    const affected = await tx
      .select({ id: artifacts.id, tags: artifacts.tags })
      .from(artifacts)
      .where(arrayOverlaps(artifacts.tags, [...map.keys()]));

    for (const row of affected) {
      const seen = new Set<string>();
      const next: string[] = [];
      for (const tag of row.tags) {
        const mapped = map.get(tag) ?? tag;
        if (seen.has(mapped)) continue;
        seen.add(mapped);
        next.push(mapped);
        if (next.length >= TAGS_MAX) break;
      }
      await tx
        .update(artifacts)
        .set({ tags: next, updatedAt: new Date() })
        .where(eq(artifacts.id, row.id));
    }
    return { artifactsUpdated: affected.length };
  });
}
