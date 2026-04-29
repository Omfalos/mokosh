import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    alias: {
      // Vitest handles .js imports in .ts files better, but we might need this if we have issues
      // '^(\\.\\.?/.+)\\.js$': '$1',
    },
  },
});
