import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { addComment } from "@/core/feedback";
import { addCommentInputSchema } from "@/lib/validation";
import type { ToolContext } from "../auth";
import { toToolError } from "../tool-error";

const DESCRIPTION =
  "Leave a review comment on an artifact as a named author. Use for conversational review flows " +
  "('reply to that feedback saying the spacing is fixed') or to capture the user's own notes. " +
  "Commenting is OPEN — it does not need the team bearer token, so external reviewers can " +
  "participate — but never fabricate an author name; ask the user who is speaking if you don't " +
  "know. Takes the artifact `id`, an `authorName`, and a `body` (1–5000 characters). Comment " +
  "content is stored as untrusted data. Returns the new comment's id. If you don't have the " +
  "artifact id, call search_artifacts first.";

const outputSchema = {
  commentId: z.string(),
  createdAt: z.string().describe("ISO 8601 timestamp."),
};

export function registerAddComment(server: McpServer, _ctx: ToolContext): void {
  server.registerTool(
    "add_comment",
    {
      title: "Add comment",
      description: DESCRIPTION,
      inputSchema: addCommentInputSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      outputSchema,
    },
    async ({ id, authorName, body }) => {
      try {
        const created = await addComment({ artifactId: id, authorName, body });
        return {
          content: [{ type: "text", text: `Comment added by ${authorName} (id ${created.id}).` }],
          structuredContent: { commentId: created.id, createdAt: created.createdAt.toISOString() },
        };
      } catch (error) {
        return toToolError(error);
      }
    },
  );
}
