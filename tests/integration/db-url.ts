// Test DB connection string. Defaults to a dedicated `_test` database on the
// docker-compose Postgres so integration runs never touch dev data. CI overrides
// via TEST_DATABASE_URL.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://artifact_hub:artifact_hub@localhost:5432/artifact_hub_test";
