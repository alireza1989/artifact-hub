import { z } from "zod";

// Single source of truth for artifact-related shapes, shared across REST, MCP,
// and core (CLAUDE.md architecture map). Keep these tight: enums, min/max, and
// normalizing transforms live here so every adapter validates identically.

export const ARTIFACT_KINDS = [
  "html",
  "image",
  "svg",
  "pdf",
  "markdown",
  "text",
  "json",
  "csv",
  "other",
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export const artifactKindSchema = z.enum(ARTIFACT_KINDS);

export const ARTIFACT_SOURCES = ["web", "mcp", "api"] as const;
export type ArtifactSource = (typeof ARTIFACT_SOURCES)[number];
export const artifactSourceSchema = z.enum(ARTIFACT_SOURCES);

// Server-enforced upload ceiling (PLAN §2). Bytes, not MB, so the check is exact.
export const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;

export const TITLE_MAX = 80;
export const DESCRIPTION_MAX = 280;
export const TAG_MAX_LENGTH = 30;
export const TAGS_MAX = 5;

// Tags are lowercased, trimmed, de-duped, empties dropped, capped at TAGS_MAX.
// Applied everywhere tags enter the system so storage + search stay consistent
// (PLAN §5.3 output hygiene mirrors this for AI-generated tags in Phase 4).
export const tagsSchema = z
  .array(z.string())
  .transform((tags) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of tags) {
      const tag = raw.trim().toLowerCase();
      if (tag.length === 0 || tag.length > TAG_MAX_LENGTH || seen.has(tag)) continue;
      seen.add(tag);
      out.push(tag);
    }
    return out;
  })
  .pipe(z.array(z.string()).max(TAGS_MAX, `At most ${TAGS_MAX} tags`));

// Metadata a caller may supply at publish time. All optional: missing fields are
// filled deterministically in Phase 1 (filename-derived title) and by AI in Phase 4.
export const publishMetadataSchema = z.object({
  title: z.string().trim().min(1).max(TITLE_MAX).optional(),
  description: z.string().trim().max(DESCRIPTION_MAX).optional(),
  tags: tagsSchema.optional(),
});
export type PublishMetadata = z.infer<typeof publishMetadataSchema>;

export const LIST_LIMIT_DEFAULT = 24;
export const LIST_LIMIT_MAX = 50;

// Query for gallery + REST list + MCP search_artifacts. Coercions accept raw URL
// query strings; `tags` accepts a comma-separated string or repeated params.
export const listQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  kind: artifactKindSchema.optional(),
  tags: z
    .union([z.string(), z.array(z.string())])
    .transform((value) => (Array.isArray(value) ? value : value.split(",")))
    .pipe(tagsSchema)
    .optional(),
  sort: z.enum(["recent", "oldest"]).default("recent"),
  limit: z.coerce.number().int().min(1).max(LIST_LIMIT_MAX).default(LIST_LIMIT_DEFAULT),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

// nanoid() default alphabet is A-Za-z0-9_- ; length 21. Keep a permissive but
// bounded check so malformed ids fail fast at the boundary before a DB round-trip.
export const artifactIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid artifact id");
