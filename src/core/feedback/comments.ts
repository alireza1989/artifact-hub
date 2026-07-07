import { desc, eq } from "drizzle-orm";
import { getArtifact } from "@/core/artifacts";
import { getDb } from "@/db";
import type { Comment } from "@/db/schema";
import { comments } from "@/db/schema";
import { COMMENT_LIST_LIMIT, type CommentAnchor } from "@/lib/validation";

export type AddCommentArgs = {
  artifactId: string;
  authorName: string;
  body: string;
  // Optional anchored feedback (PLAN Phase 6.4/6.9); absent = plain comment.
  anchor?: CommentAnchor;
};
export type CreatedComment = { id: string; createdAt: Date };

// Leave a comment as a named author (PLAN §3.1). Asserts the artifact exists so an
// unknown id surfaces ArtifactNotFoundError's recovery text rather than an FK error.
export async function addComment({
  artifactId,
  authorName,
  body,
  anchor,
}: AddCommentArgs): Promise<CreatedComment> {
  await getArtifact(artifactId);
  const [row] = await getDb()
    .insert(comments)
    .values({ artifactId, authorName, body, anchor: anchor ?? null })
    .returning({ id: comments.id, createdAt: comments.createdAt });
  if (!row) throw new Error("Insert returned no row");
  return row;
}

// Newest-first, capped at the most-recent COMMENT_LIST_LIMIT (mirrors §5.3's batch
// cap for the Phase-4 synthesis input).
export async function listComments(
  artifactId: string,
  limit = COMMENT_LIST_LIMIT,
): Promise<Comment[]> {
  return getDb()
    .select()
    .from(comments)
    .where(eq(comments.artifactId, artifactId))
    .orderBy(desc(comments.createdAt))
    .limit(limit);
}
