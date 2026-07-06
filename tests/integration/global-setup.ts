import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { TEST_DATABASE_URL } from "./db-url";

// Runs once before the integration project: ensure the test database exists and
// apply all migrations (idempotent — drizzle tracks what's been run). Fails with
// an actionable message if Postgres isn't reachable.
export default async function setup(): Promise<void> {
  await ensureDatabaseExists();

  const sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "src/db/migrations" });
  } finally {
    await sql.end();
  }
}

async function ensureDatabaseExists(): Promise<void> {
  const dbName = new URL(TEST_DATABASE_URL).pathname.slice(1);
  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = "/postgres";

  let admin: ReturnType<typeof postgres>;
  try {
    admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
    const rows = await admin`select 1 from pg_database where datname = ${dbName}`;
    if (rows.length === 0) await admin.unsafe(`create database "${dbName}"`);
    await admin.end();
  } catch (error) {
    throw new Error(
      `Cannot reach Postgres at ${adminUrl.host}. Start it with \`docker compose up -d\` ` +
        `or set TEST_DATABASE_URL. Original error: ${(error as Error).message}`,
    );
  }
}
