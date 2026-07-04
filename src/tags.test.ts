import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { createImportMap, Graph, proposeAffectedTests, proposeTags } from "./index";
import { parseFile } from "./parser";
import type { FileNode } from "./types/node";

function stubNode(p: string, category: FileNode["category"] = "logic"): FileNode {
  return {
    path: p,
    type: "typescript",
    category,
    imports: [],
    exports: [],
    tags: [],
    mtime: 0,
    size: 0,
  };
}

describe("tags", {
  tags: [
    "FileNode",
    "Graph",
    "createImportMap",
    "node",
    "parseFile",
    "parser",
    "proposeAffectedTests",
    "proposeTags",
  ],
}, () => {
  test("parseFile - extracts tags from function names", async () => {
    const content = `
      function login() {}
      const logout = () => {};
    `;
    const result = await parseFile("test.ts", content);

    expect(result.tags.map((t) => t.name)).toContain("login");
    expect(result.tags.map((t) => t.name)).toContain("logout");
  });

  test("parseFile - extracts tags from @ notation in strings", async () => {
    const content = `
      test('should login @smoke @regression', () => {});
    `;
    const result = await parseFile("test.ts", content);

    expect(result.tags.map((t) => t.name)).toContain("smoke");
    expect(result.tags.map((t) => t.name)).toContain("regression");
  });

  test("parseFile - identifies test files", async () => {
    const result = await parseFile("app.test.ts", "const x = 1;");
    expect(result.tags.map((t) => t.name)).toContain("test");

    const result2 = await parseFile("app.spec.ts", "const x = 1;");
    expect(result2.tags.map((t) => t.name)).toContain("test");

    const result3 = await parseFile("app.ts", "const x = 1;");
    expect(result3.tags.some((t) => t.name === "test")).toBe(false);
  });

  test("proposeTags - identifies affected test tags based on changes", async () => {
    const rootDir = path.join(process.cwd(), "test-propose-tags-temp");
    if (!fs.existsSync(rootDir)) fs.mkdirSync(rootDir);

    try {
      fs.writeFileSync(
        path.join(rootDir, "auth.js"),
        "export function login() { console.log('logging in'); }",
      );
      fs.writeFileSync(
        path.join(rootDir, "app.js"),
        "import { login } from './auth.js'; function dashboard() {}",
      );
      fs.writeFileSync(
        path.join(rootDir, "app.test.js"),
        "import './app.js'; test('smoke @smoke', () => {});",
      );
      fs.writeFileSync(
        path.join(rootDir, "auth.test.js"),
        "import './auth.js'; test('auth test', () => {});",
      );

      const entryPoints = ["app.test.js", "auth.test.js"];
      const graph = await createImportMap(rootDir, entryPoints);

      // Change in auth.js should affect both app.test.js (@smoke) and auth.test.js (test)
      const tags1 = proposeTags(graph, ["auth.js"]);
      expect(tags1).toContain("smoke");
      expect(tags1).toContain("test");

      // Change in app.js should affect only app.test.js (@smoke)
      const tags2 = proposeTags(graph, ["app.js"]);
      expect(tags2).toContain("smoke");
      expect(tags2).not.toContain("auth test"); // auth.test.js doesn't import app.js
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test("proposeTags - emits feature tag when changed file is a feature", () => {
    // utils.ts imports 5 internal modules → high out-degree → feature
    const nodes = new Map<string, FileNode>();
    const deps = Array.from({ length: 5 }, (_, i) => `dep${i}.ts`);
    nodes.set("utils.ts", {
      ...stubNode("utils.ts"),
      imports: deps.map((d) => ({
        fromPath: "utils.ts",
        toPath: d,
        rawSpecifier: `./${d}`,
        type: "static" as const,
        isStyle: false,
        isExternal: false,
      })),
    });
    for (const d of deps) {
      nodes.set(d, stubNode(d));
    }
    const testFile = "app.test.ts";
    nodes.set(testFile, {
      ...stubNode(testFile, "test"),
      tags: [{ name: "smoke", kind: "comment-marker" as const }],
      imports: [
        {
          fromPath: testFile,
          toPath: "utils.ts",
          rawSpecifier: "./utils",
          type: "static",
          isStyle: false,
          isExternal: false,
        },
      ],
    });

    const graph = new Graph(nodes);
    const tags = proposeTags(graph, ["utils.ts"], { featureDetection: { minOutDegree: 5 } });
    expect(tags).toContain("feature:utils");
  });

  test("proposeTags - featureDetection:false disables feature tag emission", () => {
    // utils.ts imports 5 internal modules → would be a feature if detection is on
    const nodes = new Map<string, FileNode>();
    const deps = Array.from({ length: 5 }, (_, i) => `dep${i}.ts`);
    nodes.set("utils.ts", {
      ...stubNode("utils.ts"),
      imports: deps.map((d) => ({
        fromPath: "utils.ts",
        toPath: d,
        rawSpecifier: `./${d}`,
        type: "static" as const,
        isStyle: false,
        isExternal: false,
      })),
    });
    for (const d of deps) {
      nodes.set(d, stubNode(d));
    }
    const testFile = "app.test.ts";
    nodes.set(testFile, {
      ...stubNode(testFile, "test"),
      tags: [{ name: "smoke", kind: "comment-marker" as const }],
      imports: [
        {
          fromPath: testFile,
          toPath: "utils.ts",
          rawSpecifier: "./utils",
          type: "static",
          isStyle: false,
          isExternal: false,
        },
      ],
    });

    const graph = new Graph(nodes);
    const tags = proposeTags(graph, ["utils.ts"], { featureDetection: false });
    // Without feature detection, traversal reaches test files and collects their tags
    expect(tags).toContain("smoke");
    expect(tags).not.toContain("feature:utils");
  });

  test("proposeTags - non-hub changed file still traverses to test files", () => {
    const nodes = new Map<string, FileNode>();
    nodes.set("auth.ts", stubNode("auth.ts"));
    const testFile = "auth.test.ts";
    nodes.set(testFile, {
      ...stubNode(testFile, "test"),
      tags: [{ name: "auth", kind: "comment-marker" as const }],
      imports: [
        {
          fromPath: testFile,
          toPath: "auth.ts",
          rawSpecifier: "./auth",
          type: "static",
          isStyle: false,
          isExternal: false,
        },
      ],
    });

    const graph = new Graph(nodes);
    // auth.ts imports nothing — out-degree 0 — not a feature, so full traversal to test
    const tags = proposeTags(graph, ["auth.ts"], { featureDetection: { minOutDegree: 5 } });
    expect(tags).toContain("auth");
    expect(tags).not.toContain("feature:auth");
  });
});

function makeEdge(fromPath: string, toPath: string) {
  return {
    fromPath,
    toPath,
    rawSpecifier: `./${toPath}`,
    type: "static" as const,
    isStyle: false,
    isExternal: false,
  };
}

describe("proposeAffectedTests", {
  tags: [
    "FileNode",
    "Graph",
    "createImportMap",
    "node",
    "parseFile",
    "parser",
    "proposeAffectedTests",
    "proposeTags",
  ],
}, () => {
  test("returns the path of a test that directly imports a changed file", () => {
    const nodes = new Map<string, FileNode>();
    nodes.set("auth.ts", stubNode("auth.ts"));
    nodes.set("auth.test.ts", {
      ...stubNode("auth.test.ts", "test"),
      imports: [makeEdge("auth.test.ts", "auth.ts")],
    });

    const graph = new Graph(nodes);
    const result = proposeAffectedTests(graph, ["auth.ts"]);
    expect(result).toEqual(["auth.test.ts"]);
  });

  test("returns test paths transitively through intermediate files", () => {
    const nodes = new Map<string, FileNode>();
    nodes.set("auth.ts", stubNode("auth.ts"));
    nodes.set("app.ts", { ...stubNode("app.ts"), imports: [makeEdge("app.ts", "auth.ts")] });
    nodes.set("app.test.ts", {
      ...stubNode("app.test.ts", "test"),
      imports: [makeEdge("app.test.ts", "app.ts")],
    });

    const graph = new Graph(nodes);
    const result = proposeAffectedTests(graph, ["auth.ts"]);
    expect(result).toContain("app.test.ts");
  });

  test("excludes test files beyond a feature hub boundary", () => {
    // hub.ts imports 5 deps → qualifies as a feature hub at minOutDegree:5
    const nodes = new Map<string, FileNode>();
    const deps = Array.from({ length: 5 }, (_, i) => `dep${i}.ts`);
    nodes.set("hub.ts", {
      ...stubNode("hub.ts"),
      imports: deps.map((d) => makeEdge("hub.ts", d)),
    });
    for (const d of deps) nodes.set(d, stubNode(d));

    // test imports hub → hub is the traversal boundary, so test should NOT appear
    nodes.set("hub.test.ts", {
      ...stubNode("hub.test.ts", "test"),
      imports: [makeEdge("hub.test.ts", "hub.ts")],
    });
    // changed.ts → hub.ts → (boundary) → hub.test.ts is pruned
    nodes.set("changed.ts", {
      ...stubNode("changed.ts"),
      imports: [makeEdge("changed.ts", "hub.ts")],
    });
    // but we're traversing *incoming* from changed.ts, so:
    // changed.ts ← hub.ts? No — hub.ts imports changed.ts? Let's set that up properly:
    // We want: changed.ts is changed; hub.ts imports changed.ts; hub.test.ts imports hub.ts
    nodes.set("hub.ts", {
      ...stubNode("hub.ts"),
      imports: [makeEdge("hub.ts", "changed.ts"), ...deps.map((d) => makeEdge("hub.ts", d))],
    });

    const graph = new Graph(nodes);
    const result = proposeAffectedTests(graph, ["changed.ts"], {
      featureDetection: { minOutDegree: 5 },
    });
    expect(result).not.toContain("hub.test.ts");
  });

  test("deduplicates when multiple changed files affect the same test", () => {
    const nodes = new Map<string, FileNode>();
    nodes.set("a.ts", stubNode("a.ts"));
    nodes.set("b.ts", stubNode("b.ts"));
    nodes.set("shared.test.ts", {
      ...stubNode("shared.test.ts", "test"),
      imports: [makeEdge("shared.test.ts", "a.ts"), makeEdge("shared.test.ts", "b.ts")],
    });

    const graph = new Graph(nodes);
    const result = proposeAffectedTests(graph, ["a.ts", "b.ts"]);
    expect(result.filter((p) => p === "shared.test.ts")).toHaveLength(1);
  });

  test("skips changed files not present in the graph", () => {
    const nodes = new Map<string, FileNode>();
    nodes.set("auth.ts", stubNode("auth.ts"));
    nodes.set("auth.test.ts", {
      ...stubNode("auth.test.ts", "test"),
      imports: [makeEdge("auth.test.ts", "auth.ts")],
    });

    const graph = new Graph(nodes);
    const result = proposeAffectedTests(graph, ["auth.ts", "missing.ts"]);
    expect(result).toEqual(["auth.test.ts"]);
  });

  test("returns empty list when no test files are reachable", () => {
    const nodes = new Map<string, FileNode>();
    nodes.set("util.ts", stubNode("util.ts"));
    nodes.set("other.ts", { ...stubNode("other.ts"), imports: [makeEdge("other.ts", "util.ts")] });

    const graph = new Graph(nodes);
    const result = proposeAffectedTests(graph, ["util.ts"]);
    expect(result).toEqual([]);
  });

  test("integration - real files: changed module surfaces both dependent test files", async () => {
    const rootDir = path.join(process.cwd(), "test-affected-tests-temp");
    if (!fs.existsSync(rootDir)) fs.mkdirSync(rootDir);

    try {
      fs.writeFileSync(path.join(rootDir, "auth.js"), "export function login() {}");
      fs.writeFileSync(path.join(rootDir, "app.js"), "import { login } from './auth.js';");
      fs.writeFileSync(path.join(rootDir, "auth.test.js"), "import './auth.js';");
      fs.writeFileSync(path.join(rootDir, "app.test.js"), "import './app.js';");

      const graph = await createImportMap(rootDir, ["auth.test.js", "app.test.js"]);

      // auth.js is imported by both test files (directly and transitively via app.js)
      const result = proposeAffectedTests(graph, ["auth.js"]);
      expect(result).toContain("auth.test.js");
      expect(result).toContain("app.test.js");

      // app.js is only imported by app.test.js
      const result2 = proposeAffectedTests(graph, ["app.js"]);
      expect(result2).toContain("app.test.js");
      expect(result2).not.toContain("auth.test.js");
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
