import { defineConfig } from "vitest/config";

/** Unit tests: fast, no database. Integration tests live in *.itest.ts (see vitest.integration.config.ts). */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
