import { eq, sql } from "drizzle-orm";
import { getOrCreateSynthesis } from "@/core/ai";
import { getArtifact } from "@/core/artifacts";
import { getDb } from "@/db";
import type { Comment } from "@/db/schema";
import { comments } from "@/db/schema";
import type { FeedbackSummary } from "@/lib/validation";

import { listComments } from "./comments";

// Canonical synthesis shape lives in lib/validation; re-export so existing
// consumers (MCP get_feedback, the synthesis card) keep importing it from here.
export type { FeedbackSummary };

export type FeedbackResult = {
  comments: Comment[];
  total: number;
  summary: FeedbackSummary | null;
};

// All comments (capped) + the AI synthesis (PLAN §5.2). `total` is the true count
// even when the list is capped. Synthesis is generated lazily on read once an
// artifact has ≥2 comments, reusing a fresh stored summary and single-flighting
// concurrent regenerations; below the threshold there is no summary.
export async function getFeedback(artifactId: string): Promise<FeedbackResult> {
  await getArtifact(artifactId);
  const rows = await listComments(artifactId);
  const [countRow] = await getDb()
    .select({ total: sql<number>`count(*)::int` })
    .from(comments)
    .where(eq(comments.artifactId, artifactId));
  const total = countRow?.total ?? 0;
  const summary = total >= 2 ? await getOrCreateSynthesis(artifactId) : null;
  return { comments: rows, total, summary };
}
