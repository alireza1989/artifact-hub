import { sql } from "drizzle-orm";
import { beforeAll, beforeEach } from "vitest";
import { TEST_DATABASE_URL } from "./db-url";

// Runs in each worker before tests. Point the app's env at the test DB and supply
// dummy values for the other env vars getEnv() validates (no real secrets needed;
// integration tests inject an in-memory storage fake and never call the LLM).
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.BLOB_READ_WRITE_TOKEN ??= "test-blob-token";
process.env.ANTHROPIC_API_KEY ??= "test-anthropic-key";
process.env.SHARE_LINK_SECRET ??= "test-share-link-secret-at-least-32-characters";
process.env.ADMIN_API_TOKEN ??= "test-admin-token-0123456789";
process.env.APP_BASE_URL ??= "http://localhost:3000";

// Route handlers call getStorage() internally; inject the in-memory fake so no
// integration test reaches Vercel Blob.
beforeAll(async () => {
  const { setStorageForTesting, InMemoryStorage } = await import("@/lib/storage");
  setStorageForTesting(new InMemoryStorage());
});

// Clean slate before every test.
beforeEach(async () => {
  const { getDb } = await import("@/db");
  await getDb().execute(
    sql`truncate table artifacts, comments, feedback_summaries, share_links, llm_calls restart identity cascade`,
  );

  // Default LLM stub: returns non-JSON so every AI feature falls back
  // deterministically (no real API calls; existing publish/feedback tests see the
  // pre-Phase-4 behavior). AI-positive tests override this within the test.
  const { setModelCallerForTesting } = await import("@/lib/ai");
  setModelCallerForTesting(async () => ({
    text: "the model is stubbed for tests",
    inputTokens: 0,
    outputTokens: 0,
    stopReason: "end_turn",
  }));
});
