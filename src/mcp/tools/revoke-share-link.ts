import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { revokeShareLink } from "@/core/sharing";
import { assertAuthed, type ToolContext } from "../auth";
import { toToolError } from "../tool-error";

const DESCRIPTION =
  "Immediately and permanently disable a share link by its link id, so the URL stops working for " +
  "everyone. Use when the user wants to 'revoke', 'disable', or 'kill' a link. Requires the team " +
  "bearer token. Takes the share-link `id` (returned by create_share_link, or listed under an " +
  "artifact by get_artifact). Revoking an already-revoked or expired link is a safe no-op that " +
  "reports the existing state (`alreadyInactive: true`). If you don't know the link id, call " +
  "get_artifact on the artifact to list its links.";

const inputSchema = {
  linkId: z.string().min(1).describe("Share-link id from create_share_link or get_artifact."),
};

const outputSchema = {
  linkId: z.string(),
  revokedAt: z.string().describe("ISO 8601 revocation timestamp."),
  alreadyInactive: z.boolean().describe("True if the link was already revoked or expired."),
};

export function registerRevokeShareLink(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "revoke_share_link",
    {
      title: "Revoke share link",
      description: DESCRIPTION,
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ linkId }) => {
      try {
        assertAuthed(ctx);
        const result = await revokeShareLink(linkId);
        return {
          content: [
            {
              type: "text",
              text: result.alreadyInactive
                ? `Link ${linkId} was already inactive; no change.`
                : `Link ${linkId} revoked. The share URL no longer works.`,
            },
          ],
          structuredContent: {
            linkId: result.linkId,
            revokedAt: result.revokedAt.toISOString(),
            alreadyInactive: result.alreadyInactive,
          },
        };
      } catch (error) {
        return toToolError(error);
      }
    },
  );
}
