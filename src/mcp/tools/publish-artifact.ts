import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchSourceBytes, publishArtifact } from "@/core/artifacts";
import { getEnv } from "@/lib/env";
import { artifactKindSchema, publishMetadataSchema } from "@/lib/validation";
import { assertAuthed, type ToolContext } from "../auth";
import { toToolError } from "../tool-error";

// Inline/base64 cutoff: Vercel caps a function request body at 4.5 MB, and base64
// inflates ~1.37×, so ~3 MB of decoded bytes is the safe ceiling for content that
// rides in the tool-call body. Larger binaries must use `sourceUrl` (server-fetched).
const INLINE_MAX_BYTES = 3 * 1024 * 1024;

const DESCRIPTION =
  "Publish a new artifact to Artifact Hub so it can be browsed, shared, and reviewed. Use this " +
  "when the user has produced content they want to save, show to others, or collect feedback on " +
  "('save this landing page', 'publish this report'). Provide the content exactly one way: " +
  "`content` for inline text formats (HTML, SVG, Markdown, JSON, CSV, plain text or code), " +
  "`contentBase64` for a small binary (image, PDF) up to ~3 MB, or `sourceUrl` (a public https " +
  "URL) for larger binaries up to 25 MB, which the server fetches. The true file type is " +
  "detected from the bytes — you do not set it. `title`, `description`, and `tags` are optional; " +
  "for anything you omit, the server generates a suggestion from the content, and the returned " +
  "`aiFilled` array lists which of those fields were AI-generated (so you can flag them for the " +
  "user to confirm). Supplying a value always overrides the suggestion. Returns the new " +
  "artifact's `id` (use it with create_share_link, get_artifact, add_comment), its detected " +
  "`kind`, stored size, and a gallery URL. Requires the team bearer token. After publishing, " +
  "confirm the saved title and tags with the user — especially any AI-filled fields.";

const inputSchema = {
  content: z
    .string()
    .optional()
    .describe("Inline text for text formats (HTML, SVG, Markdown, JSON, CSV, plain text/code)."),
  contentBase64: z
    .string()
    .optional()
    .describe("Base64-encoded bytes for a small binary (image, PDF), up to ~3 MB decoded."),
  sourceUrl: z
    .string()
    .optional()
    .describe("Public https URL the server fetches for larger binaries, up to 25 MB."),
  filename: z
    .string()
    .optional()
    .describe("Original filename; sharpens type detection and the default title."),
  ...publishMetadataSchema.shape,
};

const outputSchema = {
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  kind: artifactKindSchema,
  tags: z.array(z.string()),
  sizeBytes: z.number().int(),
  createdAt: z.string().describe("ISO 8601 timestamp."),
  url: z.string().describe("Gallery URL for the artifact."),
  aiFilled: z
    .array(z.string())
    .describe(
      "Metadata fields the server generated because you omitted them (subset of " +
        "title/description/tags). Confirm these with the user.",
    ),
};

export function registerPublishArtifact(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "publish_artifact",
    {
      title: "Publish artifact",
      description: DESCRIPTION,
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        assertAuthed(ctx);

        const sources = [args.content, args.contentBase64, args.sourceUrl].filter(
          (v) => v !== undefined,
        );
        if (sources.length !== 1) {
          return textError(
            "Provide exactly one of `content` (inline text), `contentBase64` (small binary), or " +
              "`sourceUrl` (larger binary the server fetches).",
          );
        }

        let bytes: Uint8Array;
        let filename = args.filename;
        let declaredContentType: string | undefined;

        if (args.content !== undefined) {
          bytes = new TextEncoder().encode(args.content);
        } else if (args.contentBase64 !== undefined) {
          bytes = new Uint8Array(Buffer.from(args.contentBase64, "base64"));
          if (bytes.length > INLINE_MAX_BYTES) {
            return textError(
              `contentBase64 is ${bytes.length} bytes decoded; the inline limit is ${INLINE_MAX_BYTES} ` +
                "bytes (~3 MB). For larger files, host them at a public https URL and pass `sourceUrl` " +
                "instead (up to 25 MB).",
            );
          }
        } else {
          const fetched = await fetchSourceBytes(args.sourceUrl as string);
          bytes = fetched.bytes;
          declaredContentType = fetched.contentType;
          filename = filename ?? fetched.filename;
        }

        const metadata = publishMetadataSchema.parse({
          title: args.title,
          description: args.description,
          tags: args.tags,
        });

        const { artifact, aiFilled } = await publishArtifact({
          bytes,
          filename,
          declaredContentType,
          source: "mcp",
          metadata,
        });

        const base = getEnv().APP_BASE_URL.replace(/\/$/, "");
        const structuredContent = {
          id: artifact.id,
          title: artifact.title,
          description: artifact.description,
          kind: artifact.kind,
          tags: artifact.tags,
          sizeBytes: artifact.sizeBytes,
          createdAt: artifact.createdAt.toISOString(),
          url: `${base}/a/${artifact.id}`,
          aiFilled,
        };
        return {
          content: [
            {
              type: "text",
              text:
                `Published "${artifact.title}" (${artifact.kind}, id ${artifact.id}).` +
                (aiFilled.length > 0
                  ? ` AI-generated for you: ${aiFilled.join(", ")}. Confirm these with the user.`
                  : " Confirm the title and tags with the user."),
            },
          ],
          structuredContent,
        };
      } catch (error) {
        return toToolError(error);
      }
    },
  );
}

function textError(text: string) {
  return { isError: true as const, content: [{ type: "text" as const, text }] };
}
