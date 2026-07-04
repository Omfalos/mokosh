import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { FileNode, ImportEdge } from "../types/node";
import { buildApiSurface, detectAllEntryPoints, detectEntryPoint } from "./api-surface";
import { Graph } from "./model";

function makeNode(p: string, opts: Partial<FileNode> = {}): FileNode {
  return {
    path: p,
    type: "typescript",
    category: "logic",
    imports: [],
    exports: [],
    tags: [],
    mtime: 1000,
    size: 100,
    ...opts,
  };
}

function reExportEdge(from: string, to: string, symbols?: string[]): ImportEdge {
  return {
    fromPath: from,
    toPath: to,
    rawSpecifier: `./${to}`,
    type: "re-export",
    isStyle: false,
    isExternal: false,
    ...(symbols ? { symbols } : {}),
  };
}

function staticEdge(from: string, to: string): ImportEdge {
  return {
    fromPath: from,
    toPath: to,
    rawSpecifier: `./${to}`,
    type: "static",
    isStyle: false,
    isExternal: false,
  };
}

function makeGraph(nodes: FileNode[]): Graph {
  const map = new Map<string, FileNode>();
  for (const n of nodes) map.set(n.path, n);
  return new Graph(map);
}

// ---------------------------------------------------------------------------
// buildApiSurface — entry validation
// ---------------------------------------------------------------------------

describe("buildApiSurface — entry validation", {
  tags: [
    "FileNode",
    "Graph",
    "ImportEdge",
    "api-surface",
    "buildApiSurface",
    "detectAllEntryPoints",
    "detectEntryPoint",
    "model",
    "node",
  ],
}, () => {
  test("throws when entry point is not in graph", () => {
    const graph = makeGraph([]);
    expect(() => buildApiSurface(graph, ["src/index.ts"])).toThrow("Entry point not found");
  });

  test("throws when entryPoints array is empty", () => {
    const graph = makeGraph([makeNode("src/index.ts")]);
    expect(() => buildApiSurface(graph, [])).toThrow("at least one entry point");
  });

  test("entry point itself is excluded from internalFiles, unreachableFromEntry, and testFiles", () => {
    const graph = makeGraph([makeNode("src/index.ts")]);
    const s = buildApiSurface(graph, ["src/index.ts"]);
    expect(s.internalFiles).not.toContain("src/index.ts");
    expect(s.unreachableFromEntry).not.toContain("src/index.ts");
    expect(s.testFiles).not.toContain("src/index.ts");
  });
});

// ---------------------------------------------------------------------------
// buildApiSurface — publicExports via re-export chain expansion
// ---------------------------------------------------------------------------

describe("buildApiSurface — export* chain expansion", {
  tags: [
    "FileNode",
    "Graph",
    "ImportEdge",
    "api-surface",
    "buildApiSurface",
    "detectAllEntryPoints",
    "detectEntryPoint",
    "model",
    "node",
  ],
}, () => {
  test("directly declared export is included", () => {
    const graph = makeGraph([
      makeNode("src/index.ts", { exports: [{ name: "foo", signature: "() => void" }] }),
    ]);
    const s = buildApiSurface(graph, ["src/index.ts"]);
    const exp = s.publicExports.find((e) => e.name === "foo");
    expect(exp).toBeDefined();
    expect(exp?.definedIn).toBe("src/index.ts");
  });

  test("wildcard re-export expands target file exports into publicExports", () => {
    // index.ts: export * from "./util"
    const graph = makeGraph([
      makeNode("src/index.ts", {
        exports: [],
        imports: [reExportEdge("src/index.ts", "src/util.ts")],
      }),
      makeNode("src/util.ts", {
        exports: [{ name: "helper", signature: "() => string" }],
      }),
    ]);
    const s = buildApiSurface(graph, ["src/index.ts"]);
    const exp = s.publicExports.find((e) => e.name === "helper");
    expect(exp).toBeDefined();
    expect(exp?.definedIn).toBe("src/util.ts");
  });

  test("named re-export exposes only the listed symbols", () => {
    // index.ts: export { foo } from "./lib"  (not bar)
    const graph = makeGraph([
      makeNode("src/index.ts", {
        exports: [],
        imports: [reExportEdge("src/index.ts", "src/lib.ts", ["foo"])],
      }),
      makeNode("src/lib.ts", {
        exports: [
          { name: "foo", signature: "() => void" },
          { name: "bar", signature: "() => void" },
        ],
      }),
    ]);
    const s = buildApiSurface(graph, ["src/index.ts"]);
    expect(s.publicExports.map((e) => e.name)).toContain("foo");
    expect(s.publicExports.map((e) => e.name)).not.toContain("bar");
  });

  test("chained wildcard re-exports resolve transitively", () => {
    // index → barrel → impl  (all export *)
    const graph = makeGraph([
      makeNode("src/index.ts", {
        exports: [],
        imports: [reExportEdge("src/index.ts", "src/barrel.ts")],
      }),
      makeNode("src/barrel.ts", {
        category: "barrel",
        exports: [],
        imports: [reExportEdge("src/barrel.ts", "src/impl.ts")],
      }),
      makeNode("src/impl.ts", {
        exports: [{ name: "Widget", signature: "class Widget" }],
      }),
    ]);
    const s = buildApiSurface(graph, ["src/index.ts"]);
    const exp = s.publicExports.find((e) => e.name === "Widget");
    expect(exp?.definedIn).toBe("src/impl.ts");
  });

  test("publicExports are sorted alphabetically", () => {
    const graph = makeGraph([
      makeNode("src/index.ts", {
        exports: [{ name: "Zoo" }, { name: "Apple" }, { name: "Mango" }],
      }),
    ]);
    const s = buildApiSurface(graph, ["src/index.ts"]);
    const names = s.publicExports.map((e) => e.name);
    expect(names).toEqual([...names].sort());
  });
});

// ---------------------------------------------------------------------------
// buildApiSurface — definedIn resolution
// ---------------------------------------------------------------------------

describe("buildApiSurface — definedIn resolution", {
  tags: [
    "FileNode",
    "Graph",
    "ImportEdge",
    "api-surface",
    "buildApiSurface",
    "detectAllEntryPoints",
    "detectEntryPoint",
    "model",
    "node",
  ],
}, () => {
  test("resolves to concrete defining file (has signature)", () => {
    const graph = makeGraph([
      makeNode("src/index.ts", {
        exports: [{ name: "FileNode" }],
        imports: [reExportEdge("src/index.ts", "src/types.ts")],
      }),
      makeNode("src/types.ts", {
        exports: [{ name: "FileNode", signature: "interface FileNode" }],
        category: "type-only",
      }),
    ]);
    const s = buildApiSurface(graph, ["src/index.ts"]);
    const exp = s.publicExports.find((e) => e.name === "FileNode");
    expect(exp?.definedIn).toBe("src/types.ts");
    expect(exp?.signature).toBe("interface FileNode");
  });

  test("prefers concrete definition over barrel re-export", () => {
    const graph = makeGraph([
      makeNode("src/index.ts", {
        exports: [],
        imports: [reExportEdge("src/index.ts", "src/barrel.ts")],
      }),
      makeNode("src/barrel.ts", {
        category: "barrel",
        exports: [{ name: "Graph" }],
        imports: [reExportEdge("src/barrel.ts", "src/model.ts")],
      }),
      makeNode("src/model.ts", {
        exports: [{ name: "Graph", signature: "class Graph", doc: "The graph class" }],
      }),
    ]);
    const s = buildApiSurface(graph, ["src/index.ts"]);
    const exp = s.publicExports.find((e) => e.name === "Graph");
    expect(exp?.definedIn).toBe("src/model.ts");
    expect(exp?.signature).toBe("class Graph");
    expect(exp?.doc).toBe("The graph class");
  });

  test("includes doc from defining file", () => {
    const graph = makeGraph([
      makeNode("src/index.ts", {
        exports: [{ name: "parseFile", doc: "Parses a source file" }],
      }),
    ]);
    const s = buildApiSurface(graph, ["src/index.ts"]);
    expect(s.publicExports.find((e) => e.name === "parseFile")?.doc).toBe("Parses a source file");
  });
});

// ---------------------------------------------------------------------------
// buildApiSurface — kind field
// ---------------------------------------------------------------------------

describe("buildApiSurface — kind field", {
  tags: [
    "FileNode",
    "Graph",
    "ImportEdge",
    "api-surface",
    "buildApiSurface",
    "detectAllEntryPoints",
    "detectEntryPoint",
    "model",
    "node",
  ],
}, () => {
  const cases: Array<[string, string]> = [
    ["interface FileNode", "interface"],
    ["class Graph", "class"],
    ["enum NodeCategory", "enum"],
    ["type ImportType", "type"],
    ["namespace Foo", "namespace"],
    ["const MAX = 10", "const"],
    ["readonly count: number", "const"],
    ["(opts: Options) => Graph", "function"],
    ["async () => void", "function"],
    ["function build(): Graph", "function"],
  ];

  for (const [signature, expectedKind] of cases) {
    test(`signature "${signature.slice(0, 25)}…" → kind "${expectedKind}"`, () => {
      const graph = makeGraph([makeNode("src/index.ts", { exports: [{ name: "X", signature }] })]);
      const s = buildApiSurface(graph, ["src/index.ts"]);
      expect(s.publicExports.find((e) => e.name === "X")?.kind).toBe(expectedKind);
    });
  }

  test("absent signature → kind unknown", () => {
    const graph = makeGraph([makeNode("src/index.ts", { exports: [{ name: "X" }] })]);
    const s = buildApiSurface(graph, ["src/index.ts"]);
    expect(s.publicExports.find((e) => e.name === "X")?.kind).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// buildApiSurface — file partitioning
// ---------------------------------------------------------------------------

describe("buildApiSurface — file partitioning", {
  tags: [
    "FileNode",
    "Graph",
    "ImportEdge",
    "api-surface",
    "buildApiSurface",
    "detectAllEntryPoints",
    "detectEntryPoint",
    "model",
    "node",
  ],
}, () => {
  test("internalFiles contains reachable non-test files excluding entry points", () => {
    const graph = makeGraph([
      makeNode("src/index.ts", { imports: [staticEdge("src/index.ts", "src/a.ts")] }),
      makeNode("src/a.ts"),
      makeNode("src/orphan.ts"),
    ]);
    const s = buildApiSurface(graph, ["src/index.ts"]);
    expect(s.internalFiles).toContain("src/a.ts");
    expect(s.internalFiles).not.toContain("src/index.ts");
    expect(s.internalFiles).not.toContain("src/orphan.ts");
  });

  test("unreachableFromEntry contains non-reachable non-test files", () => {
    const graph = makeGraph([makeNode("src/index.ts"), makeNode("src/cli.ts")]);
    const s = buildApiSurface(graph, ["src/index.ts"]);
    expect(s.unreachableFromEntry).toContain("src/cli.ts");
  });

  test("testFiles contains unreachable test nodes, not unreachableFromEntry", () => {
    const graph = makeGraph([
      makeNode("src/index.ts"),
      makeNode("src/a.test.ts", { category: "test" }),
    ]);
    const s = buildApiSurface(graph, ["src/index.ts"]);
    expect(s.testFiles).toContain("src/a.test.ts");
    expect(s.unreachableFromEntry).not.toContain("src/a.test.ts");
  });

  test("all graph nodes appear in exactly one bucket", () => {
    const graph = makeGraph([
      makeNode("src/index.ts", { imports: [staticEdge("src/index.ts", "src/impl.ts")] }),
      makeNode("src/impl.ts"),
      makeNode("src/orphan.ts"),
      makeNode("src/impl.test.ts", { category: "test" }),
    ]);
    const s = buildApiSurface(graph, ["src/index.ts"]);
    const all = new Set([
      ...s.entryPoints,
      ...s.internalFiles,
      ...s.unreachableFromEntry,
      ...s.testFiles,
    ]);
    for (const [p] of graph.nodes) {
      expect(all.has(p), `${p} should be in exactly one bucket`).toBe(true);
    }
    expect(all.size).toBe(graph.nodes.size);
  });

  test("transitive internalFiles are all included", () => {
    // index → a → b
    const graph = makeGraph([
      makeNode("src/index.ts", { imports: [staticEdge("src/index.ts", "src/a.ts")] }),
      makeNode("src/a.ts", { imports: [staticEdge("src/a.ts", "src/b.ts")] }),
      makeNode("src/b.ts"),
    ]);
    const s = buildApiSurface(graph, ["src/index.ts"]);
    expect(s.internalFiles).toContain("src/a.ts");
    expect(s.internalFiles).toContain("src/b.ts");
    expect(s.unreachableFromEntry).toHaveLength(0);
    expect(s.testFiles).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildApiSurface — multi-entry support
// ---------------------------------------------------------------------------

describe("buildApiSurface — multi-entry", {
  tags: [
    "FileNode",
    "Graph",
    "ImportEdge",
    "api-surface",
    "buildApiSurface",
    "detectAllEntryPoints",
    "detectEntryPoint",
    "model",
    "node",
  ],
}, () => {
  test("unions exports from multiple entry points", () => {
    const graph = makeGraph([
      makeNode("src/index.ts", { exports: [{ name: "createGraph" }] }),
      makeNode("src/utils.ts", { exports: [{ name: "formatPath" }] }),
    ]);
    const s = buildApiSurface(graph, ["src/index.ts", "src/utils.ts"]);
    expect(s.publicExports.map((e) => e.name)).toContain("createGraph");
    expect(s.publicExports.map((e) => e.name)).toContain("formatPath");
  });

  test("file reachable from either entry point goes to internalFiles", () => {
    const graph = makeGraph([
      makeNode("src/a.ts", { imports: [staticEdge("src/a.ts", "src/shared.ts")] }),
      makeNode("src/b.ts", { imports: [staticEdge("src/b.ts", "src/shared.ts")] }),
      makeNode("src/shared.ts"),
    ]);
    const s = buildApiSurface(graph, ["src/a.ts", "src/b.ts"]);
    expect(s.internalFiles).toContain("src/shared.ts");
  });
});

// ---------------------------------------------------------------------------
// detectEntryPoint
// ---------------------------------------------------------------------------

describe("detectEntryPoint", {
  tags: [
    "FileNode",
    "Graph",
    "ImportEdge",
    "api-surface",
    "buildApiSurface",
    "detectAllEntryPoints",
    "detectEntryPoint",
    "model",
    "node",
  ],
}, () => {
  test("returns null for empty graph with no package.json", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-surface-test-"));
    try {
      expect(detectEntryPoint(makeGraph([]), tmpDir)).toBeNull();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("resolves package.json main dist path to src equivalent", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-surface-test-"));
    try {
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ main: "./dist/index.js" }),
      );
      expect(detectEntryPoint(makeGraph([makeNode("src/index.ts")]), tmpDir)).toBe("src/index.ts");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("handles conditional exports object { import, require }", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-surface-test-"));
    try {
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({
          exports: { ".": { import: "./dist/index.mjs", require: "./dist/index.cjs" } },
        }),
      );
      expect(detectEntryPoint(makeGraph([makeNode("src/index.ts")]), tmpDir)).toBe("src/index.ts");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("falls back to src/index.ts when package.json main is not in graph", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-surface-test-"));
    try {
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ main: "./dist/cli.js" }),
      );
      // dist/cli.js → src/cli.ts not in graph; falls back to src/index.ts
      expect(detectEntryPoint(makeGraph([makeNode("src/index.ts")]), tmpDir)).toBe("src/index.ts");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("returns null when no candidates match", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-surface-test-"));
    try {
      expect(detectEntryPoint(makeGraph([makeNode("lib/main.ts")]), tmpDir)).toBeNull();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// detectAllEntryPoints
// ---------------------------------------------------------------------------

describe("detectAllEntryPoints", {
  tags: [
    "FileNode",
    "Graph",
    "ImportEdge",
    "api-surface",
    "buildApiSurface",
    "detectAllEntryPoints",
    "detectEntryPoint",
    "model",
    "node",
  ],
}, () => {
  test("returns all sub-path exports from package.json exports map", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-surface-test-"));
    try {
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({
          exports: {
            ".": "./dist/index.js",
            "./utils": "./dist/utils.js",
          },
        }),
      );
      const graph = makeGraph([makeNode("src/index.ts"), makeNode("src/utils.ts")]);
      const eps = detectAllEntryPoints(graph, tmpDir);
      expect(eps).toContain("src/index.ts");
      expect(eps).toContain("src/utils.ts");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("deduplicates identical paths", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-surface-test-"));
    try {
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({
          exports: { ".": "./dist/index.js" },
          main: "./dist/index.js",
        }),
      );
      const graph = makeGraph([makeNode("src/index.ts")]);
      const eps = detectAllEntryPoints(graph, tmpDir);
      expect(eps.filter((e) => e === "src/index.ts")).toHaveLength(1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("returns empty array when nothing matches", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-surface-test-"));
    try {
      const graph = makeGraph([makeNode("lib/main.ts")]);
      expect(detectAllEntryPoints(graph, tmpDir)).toHaveLength(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
