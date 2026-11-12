import { defineConfig } from "vitest/config";

/**
 * Integration tests against a real Postgres. They create and migrate a
 * dedicated database (see src/test/db.ts) and run serially because they
 * share it.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.itest.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
