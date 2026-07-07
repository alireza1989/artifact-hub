import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// The LLM eval harness (PLAN §5.4) — deliberately separate from vitest.config.ts
// so `pnpm test` never spends tokens. `pnpm eval` runs this against real Haiku,
// prints a scorecard, writes evals/report.json, and exits non-zero below the
// thresholds in tests/evals/score.ts. Vitest resolves the `@` alias + .ts/index
// that the src tree relies on, which a plain `node` script cannot.
export default defineConfig({
  resolve: {
    alias: { "@": resolve(import.meta.dirname, "src") },
  },
  test: {
    name: "eval",
    include: ["tests/evals/**/*.eval.ts"],
    setupFiles: ["tests/evals/setup.ts"],
    globals: true,
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
