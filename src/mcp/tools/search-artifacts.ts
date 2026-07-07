import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchArtifactsNaturally } from "@/core/ai";
import { listArtifacts } from "@/core/artifacts";
import {
  ARTIFACT_KINDS,
  artifactKindSchema,
  LIST_LIMIT_DEFAULT,
  LIST_LIMIT_MAX,
  listQuerySchema,
  TAGS_MAX,
} from "@/lib/validation";
import type { ToolContext } from "../auth";
import { toToolError } from "../tool-error";

// Written for an LLM operator (PLAN §4): purpose, when to use, what it returns.
const DESCRIPTION =
  "Search the catalog of published artifacts by full-text query and/or filters, returning " +
  "compact summaries. Reach for this FIRST whenever the user refers to an artifact indirectly " +
  "('the pricing page I made', 'that CSV from yesterday'): it resolves such references to the " +
  "`id` that get_artifact, create_share_link, add_comment, and get_feedback all require — never " +
  "guess an id. `q` runs a full-text search over each artifact's title, description, and tags " +
  '(supports quoted "exact phrases" and -excluded terms). Narrow with `kind` and/or `tags` (an ' +
  "artifact matches if it has ANY of the given tags). With `q`, results are ranked by relevance; " +
  "without it, by `sort` (recent, the default, or oldest). Paginated via `limit` (≤50, default " +
  "24) and `offset`. Each result carries id, title, kind, tags, created timestamp, and comment " +
  "count — enough to pick the right artifact; call get_artifact for full metadata or content. An " +
  "empty list means nothing matched — a normal result, not an error; broaden `q` or drop a " +
  "filter. `since` restricts to artifacts created at/after an ISO timestamp. If you'd rather " +
  "pass the user's phrasing verbatim ('html mockups with feedback from last week') instead of " +
  "extracting keywords/filters yourself, set `natural: true` and the server will translate the " +
  "query; on any translation failure it falls back to plain full-text search, so it is always " +
  "safe to set.";

// MCP-facing input shape: plain JSON types (numbers as numbers, tags as a string
// array) so the generated JSON Schema stays clean for the client. Normalization
// (tag lowercasing/dedupe, defaults, relevance ordering) is reused from the shared
// listQuerySchema at the core boundary — the same function backing the REST list
// and the gallery (single source of truth, CLAUDE.md architecture map).
const inputSchema = {
  q: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe("Full-text query over title, description, and tags."),
  kind: artifactKindSchema.optional().describe(`Filter to one kind: ${ARTIFACT_KINDS.join(", ")}.`),
  tags: z
    .array(z.string())
    .max(TAGS_MAX)
    .optional()
    .describe("Match artifacts having any of these tags."),
  since: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe("Only artifacts created at/after this ISO 8601 timestamp."),
  natural: z
    .boolean()
    .optional()
    .describe(
      "Set true when `q` is a verbatim natural-language request rather than extracted " +
        "keywords; the server translates it into filters (safe: falls back to full-text).",
    ),
  sort: z
    .enum(["recent", "oldest"])
    .optional()
    .describe("Order when no query is given. Default: recent."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(LIST_LIMIT_MAX)
    .optional()
    .describe(`Page size, 1–${LIST_LIMIT_MAX}. Default ${LIST_LIMIT_DEFAULT}.`),
  offset: z.number().int().min(0).optional().describe("Number of results to skip for pagination."),
};

const outputSchema = {
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      kind: artifactKindSchema,
      tags: z.array(z.string()),
      createdAt: z.string().describe("ISO 8601 timestamp."),
      commentCount: z.number().int(),
    }),
  ),
  total: z.number().int().describe("Total matches across all pages."),
  limit: z.number().int(),
  offset: z.number().int(),
};

export function registerSearchArtifacts(server: McpServer, _ctx: ToolContext): void {
  server.registerTool(
    "search_artifacts",
    {
      title: "Search artifacts",
      description: DESCRIPTION,
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        // `natural` is additive (Phase 6.3): default path is byte-for-byte the
        // pre-existing raw search; opting in routes through the NL translator,
        // which itself falls back to the raw search on any failure.
        const { natural, ...rest } = args ?? {};
        const query = listQuerySchema.parse(rest);
        const result = natural ? await searchArtifactsNaturally(query) : await listArtifacts(query);
        const items = result.items.map((a) => ({
          id: a.id,
          title: a.title,
          kind: a.kind,
          tags: a.tags,
          createdAt: a.createdAt.toISOString(),
          commentCount: a.commentCount,
        }));
        const structuredContent = {
          items,
          total: result.total,
          limit: result.limit,
          offset: result.offset,
        };
        const summary =
          result.total === 0
            ? "No artifacts matched. Try broader terms or drop a filter."
            : `${result.total} artifact(s) matched. Showing ${items.length}:\n` +
              items.map((i) => `- ${i.id}: ${i.title} (${i.kind})`).join("\n");
        return { content: [{ type: "text", text: summary }], structuredContent };
      } catch (error) {
        return toToolError(error);
      }
    },
  );
}
