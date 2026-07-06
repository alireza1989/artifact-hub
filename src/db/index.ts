import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

// Driver is chosen by target, not env flags: Neon endpoints get the Neon
// serverless driver (WebSocket — serverless-friendly, supports the sessions/
// transactions Phase 4 needs); anything else (local docker Postgres in dev and
// integration tests) gets postgres.js. The Neon driver only speaks to Neon's wss
// proxy, so it cannot be used against a plain local Postgres — hence the split.
// Both expose the identical Drizzle query API, so callers are driver-agnostic;
// the postgres.js type is treated as canonical.
type Db = PostgresJsDatabase<typeof schema>;

let db: Db | undefined;

function isNeonEndpoint(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".neon.tech");
  } catch {
    return false;
  }
}

export function getDb(): Db {
  if (!db) {
    const url = getEnv().DATABASE_URL;
    if (isNeonEndpoint(url)) {
      // Node 22+/Vercel expose a global WebSocket; wire it explicitly so we never
      // depend on the `ws` package.
      if (typeof globalThis.WebSocket !== "undefined") {
        neonConfig.webSocketConstructor = globalThis.WebSocket;
      }
      const pool = new Pool({ connectionString: url });
      db = drizzleNeon(pool, { schema, casing: "snake_case" }) as unknown as Db;
    } else {
      db = drizzlePg(postgres(url), { schema, casing: "snake_case" });
    }
  }
  return db;
}

export { schema };
