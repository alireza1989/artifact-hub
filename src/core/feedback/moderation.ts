import { desc, eq, sql } from "drizzle-orm";
import { DomainError } from "@/core/errors";
import { getDb } from "@/db";
import type { Comment } from "@/db/schema";
import { artifacts, comments } from "@/db/schema";

// Comment moderation for the admin console (PLAN Phase 6.5): a platform-wide
// newest-first comment feed (joined with the artifact for context) and a hard
// delete for spam. Deleting changes the artifact's comment count, so the Feature-B
// synthesis regenerates lazily on next read (comment_count_at_generation goes
// stale) — no extra invalidation needed.

export class CommentNotFoundError extends DomainError {
  readonly code = "comment_not_found";
  constructor(id: string) {
    super(`Comment "${id}" not found — it may already have been deleted.`);
  }
}

export type ModerationComment = Comment & { artifactTitle: string };

export type ModerationCommentPage = {
  items: ModerationComment[];
  total: number;
  limit: number;
  offset: number;
};

export async function listRecentComments(
  { limit, offset }: { limit: number; offset: number } = { limit: 50, offset: 0 },
): Promise<ModerationCommentPage> {
  const db = getDb();
  const rows = await db
    .select({ comment: comments, artifactTitle: artifacts.title })
    .from(comments)
    .innerJoin(artifacts, eq(comments.artifactId, artifacts.id))
    .orderBy(desc(comments.createdAt))
    .limit(limit)
    .offset(offset);
  const [countRow] = await db.select({ total: sql<number>`count(*)::int` }).from(comments);
  return {
    items: rows.map((r) => ({ ...r.comment, artifactTitle: r.artifactTitle })),
    total: countRow?.total ?? 0,
    limit,
    offset,
  };
}

export async function deleteComment(id: string): Promise<void> {
  const rows = await getDb().delete(comments).where(eq(comments.id, id)).returning({
    id: comments.id,
  });
  if (rows.length === 0) throw new CommentNotFoundError(id);
}
