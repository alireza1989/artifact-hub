import { eq, sql } from "drizzle-orm";
import { getArtifact } from "@/core/artifacts";
import { getDb } from "@/db";
import type { Comment } from "@/db/schema";
import { comments } from "@/db/schema";
import { listComments } from "./comments";

// Feedback synthesis payload shape (PLAN §5.2). Defined here so the get_feedback
// contract is forward-compatible: Phase 4 fills `summary`, Phase 2 leaves it null.
export type FeedbackSummary = {
  consensus: { point: string; commentIds: string[] }[];
  disagreements: { point: string; commentIds: string[] }[];
  actionItems: { point: string; commentIds: string[] }[];
  sentiment: "positive" | "mixed" | "negative";
};

export type FeedbackResult = {
  comments: Comment[];
  total: number;
  summary: FeedbackSummary | null;
};

// All comments (capped) + the AI synthesis. `summary` is null until Phase 4 wires
// synthesis; `total` is the true count even when the comment list is capped.
export async function getFeedback(artifactId: string): Promise<FeedbackResult> {
  await getArtifact(artifactId);
  const rows = await listComments(artifactId);
  const [countRow] = await getDb()
    .select({ total: sql<number>`count(*)::int` })
    .from(comments)
    .where(eq(comments.artifactId, artifactId));
  return { comments: rows, total: countRow?.total ?? 0, summary: null };
}
