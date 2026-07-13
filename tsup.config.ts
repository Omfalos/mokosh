import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts", "src/mcp.ts"],
  format: ["cjs", "esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: process.env.NODE_ENV === "production",
  skipNodeModulesBundle: true,
  outDir: "dist",
  shims: true,
});
