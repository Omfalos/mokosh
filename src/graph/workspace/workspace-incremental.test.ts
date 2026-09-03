/** Integration: `createWorkspaceGraph({ previousWorkspace })` feeds each package its prior
 *  graph as an incremental base, so a one-package edit doesn't force a full workspace reparse
 *  (see docs/known_issues/01-monorepo-workspace-packages-timeout.md, fix P9). */
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
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-ws-incr-"));
  write("pnpm-workspace.yaml", "packages:\n  - 'packages/*'\n");
  write("packages/core/package.json", JSON.stringify({ name: "@x/core", main: "src/index.ts" }));
  write("packages/core/src/index.ts", "export const core = 1;\n");
  write("packages/app/package.json", JSON.stringify({ name: "@x/app", main: "src/index.ts" }));
  write("packages/app/src/index.ts", "export const app = 1;\n");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("createWorkspaceGraph — incremental previousWorkspace", { tags: ["workspace"] }, () => {
  test("incremental rebuild after a one-package edit matches a cold rebuild", async () => {
    const first = await createWorkspaceGraph(root, { silent: true, parallelParsing: false });

    write("packages/app/src/index.ts", "export const app = 2;\nexport const extra = true;\n");

    const incremental = await createWorkspaceGraph(root, {
      silent: true,
      parallelParsing: false,
      previousWorkspace: first,
    });
    const cold = await createWorkspaceGraph(root, { silent: true, parallelParsing: false });

    const exportNames = (
      g: Awaited<ReturnType<typeof createWorkspaceGraph>>,
      pkg: string,
      file: string,
    ) => (g.packages.get(pkg)?.graph.nodes.get(file)?.exports ?? []).map((e) => e.name).sort();

    // Changed package picks up the edit.
    expect(exportNames(incremental, "@x/app", "packages/app/src/index.ts")).toEqual([
      "app",
      "extra",
    ]);
    // Unchanged package is byte-for-byte the same as a cold rebuild.
    expect(exportNames(incremental, "@x/core", "packages/core/src/index.ts")).toEqual(
      exportNames(cold, "@x/core", "packages/core/src/index.ts"),
    );
    expect(Object.fromEntries(incremental.getPackageDependencies())).toEqual(
      Object.fromEntries(cold.getPackageDependencies()),
    );
  });
});
