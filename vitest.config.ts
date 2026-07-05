import { defineConfig } from "vitest/config";

// Coverage is scoped to core/ (the only code with a meaningful line-coverage gate,
// per PLAN §6). Thresholds are enforced only when running with --coverage; the
// default `pnpm test` run does not gate on them so early phases with little core/
// logic stay green.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/core/**/*.ts"],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 85,
        statements: 85,
      },
    },
  },
});
