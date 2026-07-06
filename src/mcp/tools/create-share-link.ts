import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createShareLink } from "@/core/sharing";
import { createShareLinkInputSchema } from "@/lib/validation";
import { assertAuthed, type ToolContext } from "../auth";
import { toToolError } from "../tool-error";

const DESCRIPTION =
  "Create a revocable, time-limited public link for an artifact so people outside the platform " +
  "can view it without an account. Use when the user wants to 'share', 'send', or 'get a link " +
  "to' an artifact. Requires the team bearer token. Takes the artifact `id` and a `duration` " +
  "(1h, 24h, 72h, 7d, or 30d). Returns the full share URL to hand to the user, the link id " +
  "(needed for revoke_share_link), and a human-readable expiry ('3 days'). The link works " +
  "immediately and stops working at expiry or when revoked. If you don't have the artifact's id, " +
  "call search_artifacts first.";

const outputSchema = {
  linkId: z.string().describe("Pass this to revoke_share_link to disable the link."),
  url: z.string().describe("The public share URL to give the user."),
  expiresAt: z.string().describe("ISO 8601 expiry timestamp."),
  expiresInHuman: z.string().describe("Human-readable expiry, e.g. '3 days'."),
};

export function registerCreateShareLink(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "create_share_link",
    {
      title: "Create share link",
      description: DESCRIPTION,
      inputSchema: createShareLinkInputSchema.shape,
      outputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ id, duration }) => {
      try {
        assertAuthed(ctx);
        const link = await createShareLink(id, duration);
        return {
          content: [
            {
              type: "text",
              text: `Share link created (expires in ${link.expiresInHuman}). Link id ${link.linkId}. Give the user: ${link.url}`,
            },
          ],
          structuredContent: {
            linkId: link.linkId,
            url: link.url,
            expiresAt: link.expiresAt.toISOString(),
            expiresInHuman: link.expiresInHuman,
          },
        };
      } catch (error) {
        return toToolError(error);
      }
    },
  );
}
