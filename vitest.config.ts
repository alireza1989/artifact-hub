import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Two projects: `unit` runs anywhere (pure logic, no infra); `integration` runs
// against a real Postgres (PLAN §6) and is serialized so all files share one test
// DB without cross-file races. Coverage stays scoped to core/ (the only code with
// a meaningful gate) and is enforced only under --coverage.
export default defineConfig({
  resolve: {
    alias: { "@": resolve(import.meta.dirname, "src") },
  },
  test: {
    coverage: {
      provider: "v8",
      include: ["src/core/**/*.ts"],
      thresholds: { lines: 85, functions: 85, branches: 85, statements: 85 },
    },
    projects: [
      {
        resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
        test: {
          name: "unit",
          globals: true,
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
        test: {
          name: "integration",
          globals: true,
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          setupFiles: ["tests/integration/setup.ts"],
          fileParallelism: false,
        },
      },
    ],
  },
});
