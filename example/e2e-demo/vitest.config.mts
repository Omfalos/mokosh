import { defineConfig } from "vitest/config";

// Scoped config so the example's tests don't join the main `npm test` run —
// they're exercised separately by the `example:*` scripts / CI smoke job.
export default defineConfig({
  test: {
    root: import.meta.dirname,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
