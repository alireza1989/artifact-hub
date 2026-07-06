import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { hubStats } from "@/core/stats";
import type { ToolContext } from "../auth";
import { toToolError } from "../tool-error";

const DESCRIPTION =
  "Get a lightweight overview of the whole catalog: total artifact count, a breakdown by kind, " +
  "the most-used tags, and recent activity (artifacts and comments in the last 7 days). Use for " +
  "situational-awareness questions like 'what's in the hub?', 'what's new this week?', or to " +
  "orient yourself before searching. Takes no arguments and is cheap to call.";

const outputSchema = {
  totalArtifacts: z.number().int(),
  byKind: z.record(z.string(), z.number().int()).describe("Artifact count per kind."),
  topTags: z.array(z.object({ tag: z.string(), count: z.number().int() })),
  last7d: z.object({ artifacts: z.number().int(), comments: z.number().int() }),
};

export function registerHubStats(server: McpServer, _ctx: ToolContext): void {
  server.registerTool(
    "hub_stats",
    {
      title: "Hub stats",
      description: DESCRIPTION,
      inputSchema: {},
      outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const stats = await hubStats();
        return {
          content: [
            {
              type: "text",
              text: `${stats.totalArtifacts} artifact(s); last 7 days: ${stats.last7d.artifacts} new, ${stats.last7d.comments} comment(s).`,
            },
          ],
          structuredContent: stats,
        };
      } catch (error) {
        return toToolError(error);
      }
    },
  );
}
