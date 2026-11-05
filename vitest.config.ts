import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for JobDedo's unit tests.
 *
 * - `@/` mirrors the tsconfig path alias.
 * - `server-only` is stubbed: it only throws when imported into a browser
 *   bundle, and unit tests run in Node where the real module is a no-op.
 * - Tests run in a plain Node environment (no DOM) — everything under test
 *   is pure logic (scoring, validation, storage) or server-side code.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "src/test/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      include: ["src/features/**/*.ts", "src/lib/**/*.ts"],
      exclude: ["src/lib/db/supabase-store.ts", "src/lib/supabase/**"],
    },
  },
});
