import { sql } from "drizzle-orm";
import {
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

// Postgres tsvector has no first-class Drizzle column type; declare a minimal
// custom type so the generated search column and its GIN index are captured in
// migrations. See PLAN §3.2 (Postgres full-text search, no embeddings in v1).
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const artifactKind = pgEnum("artifact_kind", [
  "html",
  "image",
  "svg",
  "pdf",
  "markdown",
  "text",
  "json",
  "csv",
  "other",
]);

export const artifactSource = pgEnum("artifact_source", ["web", "mcp", "api"]);

export const llmOutcome = pgEnum("llm_outcome", ["ok", "schema_retry_ok", "fallback", "error"]);

// What the AI suggested at publish time, kept for audit (PLAN §3.1). Exported so
// core/ai (Feature A) records suggestions and the artifact page badges AI-filled
// fields against the stored values.
export type AiGeneratedMeta = {
  title?: string;
  description?: string;
  tags?: string[];
};

// Feedback synthesis payload (PLAN §5.2). Bullets are traceable to comment ids.
type FeedbackSummaryPayload = {
  consensus: { point: string; commentIds: string[] }[];
  disagreements: { point: string; commentIds: string[] }[];
  actionItems: { point: string; commentIds: string[] }[];
  sentiment: "positive" | "mixed" | "negative";
};

export const artifacts = pgTable(
  "artifacts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    title: text("title").notNull(),
    description: text("description"),
    contentType: text("content_type").notNull(),
    kind: artifactKind("kind").notNull(),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    blobUrl: text("blob_url").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    source: artifactSource("source").notNull(),
    aiGeneratedMeta: jsonb("ai_generated_meta").$type<AiGeneratedMeta>(),
    // Generated STORED columns require a strictly IMMUTABLE expression. Building
    // the tsvector inline fails ("generation expression is not immutable"):
    // `to_tsvector('english', ...)` and `array_to_string()` are only STABLE, and
    // — subtly — the presence of enum columns in this table taints an otherwise
    // immutable inline expression. The robust idiom is an IMMUTABLE wrapper
    // function that Postgres trusts by declaration. `artifact_search_document` is
    // defined in migration 0000 (Drizzle does not model functions); if migrations
    // are ever regenerated from scratch, that CREATE FUNCTION must be preserved.
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`artifact_search_document(title, description, tags)`,
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("artifacts_created_at_idx").on(table.createdAt.desc()),
    index("artifacts_tags_gin").using("gin", table.tags),
    index("artifacts_search_gin").using("gin", table.searchVector),
  ],
);

export const comments = pgTable(
  "comments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    artifactId: text("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    authorName: text("author_name").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("comments_artifact_created_idx").on(table.artifactId, table.createdAt)],
);

export const feedbackSummaries = pgTable("feedback_summaries", {
  artifactId: text("artifact_id")
    .primaryKey()
    .references(() => artifacts.id, { onDelete: "cascade" }),
  summary: jsonb("summary").$type<FeedbackSummaryPayload>().notNull(),
  commentCountAtGeneration: integer("comment_count_at_generation").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shareLinks = pgTable(
  "share_links",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    artifactId: text("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: text("created_by"),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    accessCount: integer("access_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("share_links_artifact_idx").on(table.artifactId)],
);

export const llmCalls = pgTable(
  "llm_calls",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    feature: text("feature").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull(),
    outcome: llmOutcome("outcome").notNull(),
    artifactId: text("artifact_id").references(() => artifacts.id, { onDelete: "set null" }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("llm_calls_feature_created_idx").on(table.feature, table.createdAt)],
);

export type Artifact = typeof artifacts.$inferSelect;
export type NewArtifact = typeof artifacts.$inferInsert;
export type Comment = typeof comments.$inferSelect;
export type ShareLink = typeof shareLinks.$inferSelect;
export type LlmCall = typeof llmCalls.$inferSelect;
