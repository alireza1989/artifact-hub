import { defineConfig } from "drizzle-kit";

// `db:generate` runs offline and does not need a live DB. The URL fallback keeps
// migration generation working without a configured environment; `db:migrate`
// and `db:studio` require a real DATABASE_URL.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  casing: "snake_case",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/artifact_hub",
  },
});
