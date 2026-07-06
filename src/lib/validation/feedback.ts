import { z } from "zod";
import { artifactIdSchema } from "./artifact";

// Comment bounds (PLAN §3.1: body 1..5000 chars). Single source of truth for the
// MCP add_comment tool, the REST comment route, and the Phase-3 share-view form.
export const COMMENT_BODY_MAX = 5000;
export const AUTHOR_NAME_MAX = 100;

export const addCommentInputSchema = z.object({
  id: artifactIdSchema,
  authorName: z.string().trim().min(1).max(AUTHOR_NAME_MAX),
  body: z.string().trim().min(1).max(COMMENT_BODY_MAX),
});
export type AddCommentInput = z.infer<typeof addCommentInputSchema>;

export const COMMENT_LIST_LIMIT = 50;
