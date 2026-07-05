import { z } from "zod";

// Single source of truth for runtime configuration (PLAN §10). Parsed lazily so
// that build-time and tooling paths that never touch env do not fail; the first
// call in any server entrypoint validates and fails fast on missing/invalid vars.
const envSchema = z.object({
  DATABASE_URL: z.url(),
  BLOB_READ_WRITE_TOKEN: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  SHARE_LINK_SECRET: z.string().min(32, "SHARE_LINK_SECRET must be at least 32 characters"),
  ADMIN_API_TOKEN: z.string().min(16, "ADMIN_API_TOKEN must be at least 16 characters"),
  APP_BASE_URL: z.url(),
  AI_DAILY_CALL_BUDGET: z.coerce.number().int().positive().default(500),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid environment variables:\n${z.prettifyError(parsed.error)}`);
    }
    cached = parsed.data;
  }
  return cached;
}
