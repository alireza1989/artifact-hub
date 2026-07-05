import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

// Lazy singleton so importing the schema/types never opens a connection or reads
// env. Serverless-friendly: one client per warm instance.
let client: ReturnType<typeof postgres> | undefined;
let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getDb() {
  if (!db) {
    client = postgres(getEnv().DATABASE_URL);
    db = drizzle(client, { schema, casing: "snake_case" });
  }
  return db;
}

export { schema };
