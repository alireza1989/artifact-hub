// Env bootstrap for the eval harness. ANTHROPIC_API_KEY is required (real Haiku
// calls); the other env vars only exist to satisfy getEnv()'s boot validation —
// telemetry is best-effort, so a missing/unreachable DB just means the eval's
// llm_calls rows aren't recorded, never that the eval fails. Never prints secrets.
try {
  // Loads .env locally (real DATABASE_URL + key); no-op in CI where the file is
  // absent and env comes from secrets.
  process.loadEnvFile(".env");
} catch {
  // .env not present — rely on the process environment (CI secrets).
}

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is required to run the eval harness (pnpm eval).");
}

process.env.DATABASE_URL ??= "postgres://eval:eval@127.0.0.1:1/eval";
process.env.BLOB_READ_WRITE_TOKEN ??= "eval-blob-token";
process.env.SHARE_LINK_SECRET ??= "eval-share-link-secret-at-least-32-characters";
process.env.ADMIN_API_TOKEN ??= "eval-admin-token-0123456789";
process.env.APP_BASE_URL ??= "http://localhost:3000";
