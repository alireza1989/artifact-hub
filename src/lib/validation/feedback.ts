import { z } from "zod";
import { artifactIdSchema } from "./artifact";

// Comment bounds (PLAN §3.1: body 1..5000 chars). Single source of truth for the
// MCP add_comment tool, the REST comment route, and the Phase-3 share-view form.
export const COMMENT_BODY_MAX = 5000;
export const AUTHOR_NAME_MAX = 100;

// Anchored feedback (PLAN Phase 6.4/6.9): a comment may point at something
// specific. Additive and optional everywhere — `null`/absent = a plain comment
// (all pre-Phase-6 rows). Two variants, one jsonb column:
//   text-quote  — a selected passage in a text-kind artifact; prefix/suffix give
//                 re-location context, and a quote that no longer matches simply
//                 renders as a plain quote (graceful degradation).
//   image-point — a pinned spot on an image, in percent so it survives scaling.
// Deliberately NOT supported: region pins inside HTML/SVG — the /raw iframe is a
// security boundary (see PLAN Decision Log 2026-07-07).
export const ANCHOR_QUOTE_MAX = 300;
export const ANCHOR_AFFIX_MAX = 100;

export const textQuoteAnchorSchema = z.object({
  type: z.literal("text-quote"),
  quote: z.string().trim().min(1).max(ANCHOR_QUOTE_MAX),
  prefix: z.string().max(ANCHOR_AFFIX_MAX).optional(),
  suffix: z.string().max(ANCHOR_AFFIX_MAX).optional(),
});

export const imagePointAnchorSchema = z.object({
  type: z.literal("image-point"),
  xPct: z.number().min(0).max(100),
  yPct: z.number().min(0).max(100),
});

export const commentAnchorSchema = z.discriminatedUnion("type", [
  textQuoteAnchorSchema,
  imagePointAnchorSchema,
]);
export type CommentAnchor = z.infer<typeof commentAnchorSchema>;

export const addCommentInputSchema = z.object({
  id: artifactIdSchema,
  authorName: z.string().trim().min(1).max(AUTHOR_NAME_MAX),
  body: z.string().trim().min(1).max(COMMENT_BODY_MAX),
  anchor: commentAnchorSchema
    .optional()
    .describe(
      "Optional: anchor the comment to something specific — a quoted text passage " +
        '({type:"text-quote", quote, prefix?, suffix?}) or a point on an image ' +
        '({type:"image-point", xPct, yPct} in percent). Omit for a plain comment.',
    ),
});
export type AddCommentInput = z.infer<typeof addCommentInputSchema>;

export const COMMENT_LIST_LIMIT = 50;

// AI feedback synthesis (PLAN §5.2). Single source of truth for the shape shared
// by core/ai (producer), core/feedback + the feedback_summaries jsonb column
// (store), the MCP get_feedback outputSchema, and the synthesis card UI. Every
// bullet cites the comment ids it draws from so the UI can link back to them.
export const FEEDBACK_SENTIMENTS = ["positive", "mixed", "negative"] as const;
export type FeedbackSentiment = (typeof FEEDBACK_SENTIMENTS)[number];

const summaryPointSchema = z.object({
  point: z.string(),
  commentIds: z.array(z.string()),
});

export const feedbackSummarySchema = z.object({
  consensus: z.array(summaryPointSchema),
  disagreements: z.array(summaryPointSchema),
  actionItems: z.array(summaryPointSchema),
  sentiment: z.enum(FEEDBACK_SENTIMENTS),
});
export type FeedbackSummary = z.infer<typeof feedbackSummarySchema>;

// Most-recent comments fed to synthesis (PLAN §5.3 input cap). Mirrors
// COMMENT_LIST_LIMIT so the synthesis input matches the listed comments.
export const SYNTHESIS_COMMENT_CAP = COMMENT_LIST_LIMIT;
