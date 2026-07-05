CREATE TYPE "public"."artifact_kind" AS ENUM('html', 'image', 'svg', 'pdf', 'markdown', 'text', 'json', 'csv', 'other');--> statement-breakpoint
CREATE TYPE "public"."artifact_source" AS ENUM('web', 'mcp', 'api');--> statement-breakpoint
CREATE TYPE "public"."llm_outcome" AS ENUM('ok', 'schema_retry_ok', 'fallback', 'error');--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"content_type" text NOT NULL,
	"kind" "artifact_kind" NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"blob_url" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"source" "artifact_source" NOT NULL,
	"ai_generated_meta" jsonb,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || array_to_string(tags, ' '))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" text PRIMARY KEY NOT NULL,
	"artifact_id" text NOT NULL,
	"author_name" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_summaries" (
	"artifact_id" text PRIMARY KEY NOT NULL,
	"summary" jsonb NOT NULL,
	"comment_count_at_generation" integer NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"feature" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"cost_usd" numeric(12, 6) NOT NULL,
	"outcome" "llm_outcome" NOT NULL,
	"artifact_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" text PRIMARY KEY NOT NULL,
	"artifact_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_by" text,
	"last_accessed_at" timestamp with time zone,
	"access_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_summaries" ADD CONSTRAINT "feedback_summaries_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifacts_created_at_idx" ON "artifacts" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "artifacts_tags_gin" ON "artifacts" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "artifacts_search_gin" ON "artifacts" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "comments_artifact_created_idx" ON "comments" USING btree ("artifact_id","created_at");--> statement-breakpoint
CREATE INDEX "llm_calls_feature_created_idx" ON "llm_calls" USING btree ("feature","created_at");--> statement-breakpoint
CREATE INDEX "share_links_artifact_idx" ON "share_links" USING btree ("artifact_id");