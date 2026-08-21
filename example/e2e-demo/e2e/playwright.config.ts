import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: __dirname,
  fullyParallel: true,
  reporter: [["list"]],
});
