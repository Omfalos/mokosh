import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "example/full-house/*.test.ts"],
    strictTags: false,
    alias: {
      // Vitest handles .js imports in .ts files better, but we might need this if we have issues
      // '^(\\.\\.?/.+)\\.js$': '$1',
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
    },
  },
});
