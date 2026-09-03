/** Integration: `createWorkspaceGraph` walks the monorepo `.md`/`.mdx` tree once and folds
 *  each doc into its owning package's graph, instead of every package re-walking the whole
 *  monorepo (see docs/known_issues/01-monorepo-workspace-packages-timeout.md, fix 1D). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createWorkspaceGraph } from "../../index";

let root: string;

function write(rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-ws-docs-"));
  write("pnpm-workspace.yaml", "packages:\n  - 'packages/*'\n");
  write("README.md", "# Top level\nSee [core](packages/core/src/index.ts)\n");

  write("packages/core/package.json", JSON.stringify({ name: "@x/core", main: "src/index.ts" }));
  write("packages/core/src/index.ts", "export const core = 1;\n");
  write("packages/core/docs/guide.md", "# Core guide\n[impl](../src/index.ts)\n");

  write("packages/app/package.json", JSON.stringify({ name: "@x/app", main: "src/index.ts" }));
  write("packages/app/src/index.ts", "export const app = 1;\n");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("createWorkspaceGraph — workspace-scoped doc scan", { tags: ["workspace"] }, () => {
  test("assigns a package's doc to that package's graph", async () => {
    const wg = await createWorkspaceGraph(root, { silent: true, parallelParsing: false });

    const core = wg.packages.get("@x/core");
    expect(core).toBeDefined();
    expect(core?.graph.nodes.has("packages/core/docs/guide.md")).toBe(true);
  });

  test("does not pull a package's doc into a sibling package's graph", async () => {
    const wg = await createWorkspaceGraph(root, { silent: true, parallelParsing: false });

    const app = wg.packages.get("@x/app");
    expect(app?.graph.nodes.has("packages/core/docs/guide.md")).toBe(false);
  });

  test("drops a top-level doc that belongs to no package", async () => {
    const wg = await createWorkspaceGraph(root, { silent: true, parallelParsing: false });

    for (const { graph } of wg.packages.values()) {
      expect(graph.nodes.has("README.md")).toBe(false);
    }
  });
});
