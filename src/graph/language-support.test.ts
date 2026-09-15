import { describe, expect, test } from "vitest";
import type { FileNode } from "../types/node";
import type { FileType } from "../types/parse";
import {
  CALL_EDGE_TYPES,
  EXPORT_TRACKING_TYPES,
  FUNCTION_COMPLEXITY_TYPES,
  getLanguageCoverage,
  IMPORT_SYMBOL_TYPES,
  LANGUAGE_FIDELITY,
  languageCaveats,
  languageCaveatsSummary,
  languageSupportNote,
  TEST_TAG_STRATEGY_TYPES,
} from "./language-support";
import { Graph } from "./model";

function makeNode(p: string, type: FileType): FileNode {
  return {
    path: p,
    type,
    category: "logic",
    imports: [],
    exports: [],
    tags: [],
    mtime: 0,
    size: 0,
  };
}

function makeGraph(nodes: FileNode[]): Graph {
  const map = new Map<string, FileNode>();
  for (const n of nodes) map.set(n.path, n);
  return new Graph(map);
}

describe("getLanguageCoverage", { tags: ["getLanguageCoverage", "Graph", "FileNode"] }, () => {
  test("reports fileCount and tracked capabilities per language present in the graph", () => {
    const graph = makeGraph([
      makeNode("src/a.ts", "typescript"),
      makeNode("src/b.ts", "typescript"),
      makeNode("src/c.py", "python"),
      makeNode("src/d.go", "go"),
      makeNode("src/e.lua", "lua"),
    ]);

    const coverage = getLanguageCoverage(graph);

    expect(coverage).toEqual([
      {
        type: "typescript",
        fileCount: 2,
        exportsTracked: true,
        importSymbolsTracked: true,
        callEdgesTracked: true,
        fidelity: LANGUAGE_FIDELITY.typescript,
      },
      {
        type: "python",
        fileCount: 1,
        exportsTracked: true,
        importSymbolsTracked: true,
        callEdgesTracked: true,
        fidelity: LANGUAGE_FIDELITY.python,
      },
      {
        type: "go",
        fileCount: 1,
        exportsTracked: true,
        importSymbolsTracked: false,
        callEdgesTracked: true,
        fidelity: LANGUAGE_FIDELITY.go,
      },
      {
        type: "lua",
        fileCount: 1,
        exportsTracked: true,
        importSymbolsTracked: false,
        callEdgesTracked: false,
        fidelity: LANGUAGE_FIDELITY.lua,
      },
    ]);
  });

  test("reports exportsTracked for SCSS and Less (root-level variable/mixin/function exports)", () => {
    const graph = makeGraph([makeNode("src/a.scss", "scss"), makeNode("src/b.less", "less")]);

    const coverage = getLanguageCoverage(graph);

    expect(coverage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "scss", exportsTracked: true }),
        expect.objectContaining({ type: "less", exportsTracked: true }),
      ]),
    );
  });

  test("reports exportsTracked for Lua and CoffeeScript (module-table / module.exports exports)", () => {
    const graph = makeGraph([
      makeNode("src/a.lua", "lua"),
      makeNode("src/b.coffee", "coffeescript"),
    ]);

    const coverage = getLanguageCoverage(graph);

    expect(coverage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "lua", exportsTracked: true }),
        expect.objectContaining({ type: "coffeescript", exportsTracked: true }),
      ]),
    );
  });

  test("reports exportsTracked and importSymbolsTracked for JVM languages", () => {
    const graph = makeGraph([
      makeNode("src/A.java", "java"),
      makeNode("src/B.kt", "kotlin"),
      makeNode("src/C.scala", "scala"),
      makeNode("src/D.groovy", "groovy"),
    ]);

    const coverage = getLanguageCoverage(graph);

    for (const type of ["java", "kotlin", "scala", "groovy"] as const) {
      expect(coverage).toContainEqual(
        expect.objectContaining({ type, exportsTracked: true, importSymbolsTracked: true }),
      );
    }
  });

  test("Java and Kotlin track call edges; Scala/Groovy do not (no pure-JS AST yet)", () => {
    const graph = makeGraph([
      makeNode("src/A.java", "java"),
      makeNode("src/B.kt", "kotlin"),
      makeNode("src/C.scala", "scala"),
      makeNode("src/D.groovy", "groovy"),
    ]);

    const coverage = getLanguageCoverage(graph);
    const callEdgesFor = (type: string) =>
      coverage.find((entry) => entry.type === type)?.callEdgesTracked;

    expect(callEdgesFor("java")).toBe(true);
    expect(callEdgesFor("kotlin")).toBe(true);
    expect(callEdgesFor("scala")).toBe(false);
    expect(callEdgesFor("groovy")).toBe(false);
  });

  test("sorts by file count descending", () => {
    const graph = makeGraph([
      makeNode("src/a.lua", "lua"),
      makeNode("src/b.ts", "typescript"),
      makeNode("src/c.ts", "typescript"),
      makeNode("src/d.ts", "typescript"),
    ]);

    expect(getLanguageCoverage(graph).map((c) => c.type)).toEqual(["typescript", "lua"]);
  });

  test("omits languages with zero files in the graph", () => {
    const graph = makeGraph([makeNode("src/a.ts", "typescript")]);
    const types = getLanguageCoverage(graph).map((c) => c.type);
    expect(types).toEqual(["typescript"]);
    expect(types).not.toContain("python");
    expect(types).not.toContain("go");
  });

  test("returns an empty array for an empty graph", () => {
    expect(getLanguageCoverage(makeGraph([]))).toEqual([]);
  });

  test("each entry carries the language's full fidelity row", () => {
    const graph = makeGraph([makeNode("A.kt", "kotlin")]);
    expect(getLanguageCoverage(graph)[0]?.fidelity).toEqual(LANGUAGE_FIDELITY.kotlin);
  });
});

describe("LANGUAGE_FIDELITY", { tags: ["LANGUAGE_FIDELITY", "FileType"] }, () => {
  const ALL_FILE_TYPES: FileType[] = [
    "javascript",
    "typescript",
    "css",
    "scss",
    "less",
    "stylus",
    "coffeescript",
    "livescript",
    "lua",
    "gherkin",
    "python",
    "go",
    "java",
    "kotlin",
    "scala",
    "groovy",
    "markdown",
    "unknown",
  ];
  const AXES = [
    "importResolution",
    "exportSymbols",
    "importSymbols",
    "callEdges",
    "complexity",
    "category",
    "duplication",
    "testTags",
  ] as const;

  test("has an entry for every FileType, and no extras", () => {
    expect(Object.keys(LANGUAGE_FIDELITY).sort()).toEqual([...ALL_FILE_TYPES].sort());
  });

  test("every cell is one of full | partial | none", () => {
    for (const type of ALL_FILE_TYPES) {
      for (const axis of AXES) {
        expect(["full", "partial", "none"]).toContain(LANGUAGE_FIDELITY[type][axis]);
      }
    }
  });

  // The four set-backed axes must agree *exactly* with their source-of-truth set — this is the
  // drift guard: add a parser capability, forget the table, and the matching test fails.
  test.each([
    ["exportSymbols", EXPORT_TRACKING_TYPES],
    ["importSymbols", IMPORT_SYMBOL_TYPES],
    ["callEdges", CALL_EDGE_TYPES],
    ["complexity", FUNCTION_COMPLEXITY_TYPES],
    ["testTags", TEST_TAG_STRATEGY_TYPES],
  ] as const)("%s is non-'none' iff the language is in its *_TYPES set", (axis, set) => {
    for (const type of ALL_FILE_TYPES) {
      const tracked = LANGUAGE_FIDELITY[type][axis] !== "none";
      expect(tracked).toBe(set.has(type));
    }
  });

  test("sentinel judgement cells (guard the hand-maintained axes)", () => {
    expect(LANGUAGE_FIDELITY.css.duplication).toBe("full"); // structural comparator
    expect(LANGUAGE_FIDELITY.scss.duplication).toBe("full");
    expect(LANGUAGE_FIDELITY.typescript.duplication).toBe("partial"); // generic token pipeline
    expect(LANGUAGE_FIDELITY.java.importResolution).toBe("partial"); // index-based, issue 3
    expect(LANGUAGE_FIDELITY.kotlin.callEdges).toBe("partial");
    expect(LANGUAGE_FIDELITY.kotlin.complexity).toBe("none");
    for (const axis of AXES) expect(LANGUAGE_FIDELITY.unknown[axis]).toBe("none");
  });

  test("matches the table in docs/language-support.md cell-for-cell", async () => {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const md = await readFile(path.join(process.cwd(), "docs", "language-support.md"), "utf8");

    // Data rows of the fidelity matrix: a `-wrapped lowercase language name in the first cell.
    const fromDoc: Record<string, Record<string, string>> = {};
    for (const line of md.split("\n")) {
      if (!/^\|\s*`[a-z]+`\s*\|/.test(line)) continue;
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim().replace(/`/g, ""));
      const lang = cells[0];
      if (!lang) continue;
      fromDoc[lang] = Object.fromEntries(
        AXES.map((axis, i) => [axis, cells[i + 1] ?? ""]),
      ) as Record<string, string>;
    }

    for (const type of ALL_FILE_TYPES) {
      expect(fromDoc[type], `docs/language-support.md is missing a row for "${type}"`).toEqual(
        LANGUAGE_FIDELITY[type] as unknown as Record<string, string>,
      );
    }
  });
});

describe("languageSupportNote", { tags: ["languageSupportNote", "Graph", "FileNode"] }, () => {
  test("returns a note naming the present languages when none support the feature", () => {
    const graph = makeGraph([makeNode("A.scala", "scala"), makeNode("B.groovy", "groovy")]);
    const note = languageSupportNote(graph, "callEdges");
    expect(note).toBeDefined();
    expect(note).toContain("groovy, scala");
    expect(note).toContain("call edges");
  });

  test("returns undefined when a supported language is present", () => {
    const graph = makeGraph([makeNode("A.kt", "kotlin"), makeNode("b.ts", "typescript")]);
    expect(languageSupportNote(graph, "callEdges")).toBeUndefined();
  });

  test("kotlin alone no longer triggers the callEdges note (Phase 1: first-party grammar)", () => {
    expect(
      languageSupportNote(makeGraph([makeNode("A.kt", "kotlin")]), "callEdges"),
    ).toBeUndefined();
  });

  test("functionComplexity: go/python/ts supported, kotlin not", () => {
    expect(
      languageSupportNote(makeGraph([makeNode("a.go", "go")]), "functionComplexity"),
    ).toBeUndefined();
    expect(
      languageSupportNote(makeGraph([makeNode("A.kt", "kotlin")]), "functionComplexity"),
    ).toContain("per-function complexity");
  });

  test("typeGraph: only ts/js supported", () => {
    expect(languageSupportNote(makeGraph([makeNode("a.py", "python")]), "typeGraph")).toContain(
      "type extraction",
    );
    expect(
      languageSupportNote(makeGraph([makeNode("a.ts", "typescript")]), "typeGraph"),
    ).toBeUndefined();
  });

  test("accepts an array of graphs (workspace) — undefined if any has a supported language", () => {
    const kt = makeGraph([makeNode("A.kt", "kotlin")]);
    const ts = makeGraph([makeNode("b.ts", "typescript")]);
    expect(languageSupportNote([kt, ts], "functionComplexity")).toBeUndefined();
    expect(
      languageSupportNote([kt, makeGraph([makeNode("B.kt", "kotlin")])], "functionComplexity"),
    ).toBeDefined();
  });

  test("empty graph -> generic subject", () => {
    expect(languageSupportNote(makeGraph([]), "callEdges")).toContain("this project");
  });
});

describe("languageCaveats", { tags: ["languageCaveats", "Graph", "FileNode"] }, () => {
  test("empty for an all-'full' (all-TS) graph", () => {
    const graph = makeGraph([makeNode("a.ts", "typescript"), makeNode("b.ts", "typescript")]);
    for (const axis of [
      "importResolution",
      "exportSymbols",
      "importSymbols",
      "callEdges",
      "complexity",
    ] as const) {
      expect(languageCaveats(graph, axis)).toEqual([]);
    }
  });

  test("callEdges: Java and Kotlin both get 'constructors/virtual dispatch' notes", () => {
    const graph = makeGraph([makeNode("A.java", "java"), makeNode("B.kt", "kotlin")]);
    const notes = languageCaveats(graph, "callEdges");
    expect(notes).toHaveLength(2);
    expect(notes.find((n) => n.startsWith("java:"))).toContain("constructors only");
    expect(notes.find((n) => n.startsWith("kotlin:"))).toContain("not virtual dispatch");
  });

  test("does not fire for a 'partial' axis that carries no concrete reason (category/duplication)", () => {
    // Every non-CSS language is `duplication: partial`; without a per-language note that would be
    // noise on nearly every repo, so the helper stays quiet.
    const graph = makeGraph([makeNode("a.ts", "typescript"), makeNode("b.py", "python")]);
    expect(languageCaveats(graph, "duplication")).toEqual([]);
    expect(languageCaveats(graph, "category")).toEqual([]);
  });

  test("stylus carries a concrete duplication note", () => {
    const graph = makeGraph([makeNode("a.styl", "stylus")]);
    expect(languageCaveats(graph, "duplication")[0]).toContain("stylus:");
  });

  test("ignores markdown and unknown files", () => {
    const graph = makeGraph([makeNode("README.md", "markdown"), makeNode("x.json", "unknown")]);
    expect(languageCaveats(graph, "importResolution")).toEqual([]);
  });

  test("accepts an array of graphs (workspace) and de-dupes across packages", () => {
    const a = makeGraph([makeNode("A.kt", "kotlin")]);
    const b = makeGraph([makeNode("B.kt", "kotlin")]);
    expect(languageCaveats([a, b], "callEdges")).toEqual(languageCaveats(a, "callEdges"));
  });

  test("output is sorted", () => {
    const graph = makeGraph([makeNode("A.java", "java"), makeNode("B.kt", "kotlin")]);
    const notes = languageCaveats(graph, "importResolution");
    expect([...notes].sort()).toEqual(notes);
  });
});

describe("languageCaveatsSummary", { tags: ["languageCaveatsSummary", "Graph"] }, () => {
  test("empty for an all-TS graph", () => {
    expect(languageCaveatsSummary(makeGraph([makeNode("a.ts", "typescript")]))).toEqual([]);
  });

  test("aggregates across precision axes, de-duplicated and sorted", () => {
    const graph = makeGraph([makeNode("A.java", "java"), makeNode("b.ts", "typescript")]);
    const summary = languageCaveatsSummary(graph);
    // Java is degraded on importResolution, exportSymbols, importSymbols and callEdges.
    expect(summary.length).toBeGreaterThanOrEqual(3);
    expect(summary.every((s) => s.startsWith("java:"))).toBe(true);
    expect([...summary].sort()).toEqual(summary);
    expect(new Set(summary).size).toBe(summary.length);
  });
});
