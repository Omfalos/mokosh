import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * These tests exercise the piscina worker-pool path, which needs a compiled
 * `dist/parse-worker.js` to spawn a worker thread from — running `src/*.ts` directly
 * (as the rest of the suite does) can't satisfy that. CI always builds before testing
 * (see .github/workflows/ci.yml); locally, skip gracefully if `dist/` isn't present yet.
 */
const distIndexPath = path.join(process.cwd(), "dist", "index.js");
const hasBuiltDist = fs.existsSync(distIndexPath);

describe.skipIf(!hasBuiltDist)("parallel parsing (worker pool)", () => {
  function makeFixture(name: string, fileCount: number): string {
    const root = path.join(process.cwd(), name);
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    for (let i = 0; i < fileCount; i++) {
      fs.writeFileSync(path.join(root, "src", `mod${i}.js`), `export const x${i} = ${i};`);
    }
    const indexContent = Array.from(
      { length: fileCount },
      (_, i) => `import { x${i} } from "./mod${i}.js";`,
    ).join("\n");
    fs.writeFileSync(path.join(root, "src", "index.js"), indexContent);
    return root;
  }

  test("pooled build produces the same graph as synchronous build", async () => {
    const { createImportMap } = await import(distIndexPath);
    const root = makeFixture("test-parallel-parsing-equivalence", 8);

    try {
      const sync = await createImportMap(root, ["src/index.js"], null, {
        silent: true,
        parallelParsing: false,
      });
      const pooled = await createImportMap(root, ["src/index.js"], null, {
        silent: true,
        parallelParsing: { minFiles: 0 },
      });

      const normalize = (g: typeof sync) =>
        JSON.stringify({
          ...g.serialize(),
          nodes: g
            .serialize()
            .nodes.slice()
            .sort((a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path)),
        });

      expect(normalize(pooled)).toEqual(normalize(sync));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("falls back to synchronous parsing when the worker pool fails to spawn", async () => {
    const { createImportMap } = await import(distIndexPath);
    const root = makeFixture("test-parallel-parsing-fallback", 3);

    try {
      // maxThreads: 0 makes Piscina's constructor throw synchronously; initPool's
      // try/catch should swallow it and force the sync path for the rest of the build.
      const graph = await createImportMap(root, ["src/index.js"], null, {
        silent: true,
        parallelParsing: { minFiles: 0, maxThreads: 0 },
      });

      const paths = graph.serialize().nodes.map((n: { path: string }) => n.path);
      expect(paths).toContain("src/index.js");
      expect(paths).toContain("src/mod0.js");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
