import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { comments, feedbackSummaries } from "@/db/schema";
import {
  AI_FEATURE_MODELS,
  buildSynthesisInstruction,
  parseSynthesis,
  runFeature,
  SYNTHESIS_MAX_TOKENS,
  SYNTHESIS_PROMPT_VERSION,
  SYNTHESIS_SYSTEM,
  type SynthesisComment,
  synthesisJsonSchema,
} from "@/lib/ai";
import { type FeedbackSummary, SYNTHESIS_COMMENT_CAP } from "@/lib/validation";

// Per-comment body cap for the synthesis input, on top of the most-recent-50 batch
// cap (PLAN §5.3). Bounds a single 5,000-char comment from dominating the prompt.
const SYNTHESIS_BODY_CHARS = 1_500;

const SYNTHESIS_MODEL = AI_FEATURE_MODELS["feedback-synthesis"];

async function countComments(artifactId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(comments)
    .where(eq(comments.artifactId, artifactId));
  return row?.n ?? 0;
}

async function loadStored(
  artifactId: string,
): Promise<{ summary: FeedbackSummary; commentCountAtGeneration: number } | null> {
  const [row] = await getDb()
    .select({
      summary: feedbackSummaries.summary,
      commentCountAtGeneration: feedbackSummaries.commentCountAtGeneration,
    })
    .from(feedbackSummaries)
    .where(eq(feedbackSummaries.artifactId, artifactId));
  return row ?? null;
}

// Synthesize a batch of comments via the schema-validated wrapper. DB-free (the
// eval harness calls it directly with fixture comments); returns null when the
// model didn't produce a usable summary (fallback/budget/error).
export async function synthesizeComments(
  batch: SynthesisComment[],
  artifactId: string | null = null,
): Promise<FeedbackSummary | null> {
  if (batch.length === 0) return null;
  const trimmed = batch.map((c) => ({
    id: c.id,
    authorName: c.authorName,
    body: c.body.slice(0, SYNTHESIS_BODY_CHARS),
  }));
  const validIds = new Set(trimmed.map((c) => c.id));

  const result = await runFeature<FeedbackSummary>({
    feature: "feedback-synthesis",
    promptVersion: SYNTHESIS_PROMPT_VERSION,
    system: SYNTHESIS_SYSTEM,
    content: [{ type: "text", text: buildSynthesisInstruction(trimmed) }],
    jsonSchema: synthesisJsonSchema,
    parse: (text) => parseSynthesis(text, validIds),
    fallback: { consensus: [], disagreements: [], actionItems: [], sentiment: "mixed" },
    maxTokens: SYNTHESIS_MAX_TOKENS,
    artifactId,
  });

  return result.usedAi ? result.value : null;
}

// Generate from the most-recent stored comments (PLAN §5.3 batch cap). Anchored
// comments (Phase 6.4) pass their quoted passage as grounding context.
async function generate(artifactId: string): Promise<FeedbackSummary | null> {
  const rows = await getDb()
    .select({
      id: comments.id,
      authorName: comments.authorName,
      body: comments.body,
      anchor: comments.anchor,
    })
    .from(comments)
    .where(eq(comments.artifactId, artifactId))
    .orderBy(desc(comments.createdAt))
    .limit(SYNTHESIS_COMMENT_CAP);
  const batch = rows.map(({ anchor, ...c }) => ({
    ...c,
    anchorQuote: anchor?.type === "text-quote" ? anchor.quote : undefined,
  }));
  return synthesizeComments(batch, artifactId);
}

// Feature B orchestration (PLAN §5.2). Returns the current synthesis for an
// artifact, regenerating lazily when the stored summary is stale (comment count
// changed) and single-flighting concurrent readers with a Postgres transaction
// advisory lock so only one generation runs. Below 2 comments there is no summary.
export async function getOrCreateSynthesis(artifactId: string): Promise<FeedbackSummary | null> {
  // Fast path: no lock when a fresh summary already exists.
  const total = await countComments(artifactId);
  if (total < 2) return null;
  const stored = await loadStored(artifactId);
  if (stored && stored.commentCountAtGeneration === total) return stored.summary;

  // Slow path: serialize generation for this artifact. The xact lock is held for
  // the transaction; a second reader blocks here, then finds the summary fresh on
  // re-check and returns it without regenerating.
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${artifactId}))`);

    const [countRow] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(comments)
      .where(eq(comments.artifactId, artifactId));
    const lockedTotal = countRow?.n ?? 0;

    const [current] = await tx
      .select({
        summary: feedbackSummaries.summary,
        commentCountAtGeneration: feedbackSummaries.commentCountAtGeneration,
      })
      .from(feedbackSummaries)
      .where(eq(feedbackSummaries.artifactId, artifactId));

    if (lockedTotal < 2) return current?.summary ?? null;
    if (current && current.commentCountAtGeneration === lockedTotal) return current.summary;

    const summary = await generate(artifactId);
    // Model didn't produce a summary (fallback/budget/error): keep any existing
    // (stale) summary rather than storing an empty one.
    if (summary === null) return current?.summary ?? null;

    await tx
      .insert(feedbackSummaries)
      .values({
        artifactId,
        summary,
        commentCountAtGeneration: lockedTotal,
        model: SYNTHESIS_MODEL,
        promptVersion: SYNTHESIS_PROMPT_VERSION,
      })
      .onConflictDoUpdate({
        target: feedbackSummaries.artifactId,
        set: {
          summary,
          commentCountAtGeneration: lockedTotal,
          model: SYNTHESIS_MODEL,
          promptVersion: SYNTHESIS_PROMPT_VERSION,
          generatedAt: new Date(),
        },
      });

    return summary;
  });
}
