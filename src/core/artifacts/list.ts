import { and, arrayOverlaps, asc, desc, eq, gte, type SQL, sql } from "drizzle-orm";
import { getDb } from "@/db";
import type { Artifact } from "@/db/schema";
import { artifacts, comments } from "@/db/schema";
import type { ListQuery } from "@/lib/validation";

export type ArtifactListItem = Artifact & { commentCount: number };
export type ArtifactListResult = {
  items: ArtifactListItem[];
  total: number;
  limit: number;
  offset: number;
};

// Full-text + filter + paginate over the generated search_vector (PLAN §3.2).
// The same function backs the gallery, REST list, and MCP search_artifacts.
export async function listArtifacts(query: ListQuery): Promise<ArtifactListResult> {
  const db = getDb();
  const conditions: SQL[] = [];

  if (query.q) {
    conditions.push(sql`${artifacts.searchVector} @@ websearch_to_tsquery('english', ${query.q})`);
  }
  if (query.kind) conditions.push(eq(artifacts.kind, query.kind));
  if (query.tags && query.tags.length > 0) {
    conditions.push(arrayOverlaps(artifacts.tags, query.tags));
  }
  if (query.since) conditions.push(gte(artifacts.createdAt, query.since));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Relevance-first when searching, otherwise chronological.
  const orderBy = query.q
    ? [
        desc(sql`ts_rank(${artifacts.searchVector}, websearch_to_tsquery('english', ${query.q}))`),
        desc(artifacts.createdAt),
      ]
    : [query.sort === "oldest" ? asc(artifacts.createdAt) : desc(artifacts.createdAt)];

  const commentCount = sql<number>`(
    select count(*)::int from ${comments} where ${comments.artifactId} = ${artifacts.id}
  )`;

  const rows = await db
    .select({ artifact: artifacts, commentCount })
    .from(artifacts)
    .where(where)
    .orderBy(...orderBy)
    .limit(query.limit)
    .offset(query.offset);

  const totalRows = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(artifacts)
    .where(where);

  return {
    items: rows.map((r) => ({ ...r.artifact, commentCount: r.commentCount })),
    total: totalRows[0]?.total ?? 0,
    limit: query.limit,
    offset: query.offset,
  };
}
