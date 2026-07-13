/** Test-only helper: builds a fully-populated CommandContext with sensible defaults, override as needed. */
import { Graph } from "../../index";
import type { CommandContext } from "./types";

export function makeContext(overrides: Partial<CommandContext> & { graph: Graph }): CommandContext {
  return {
    rootDir: "/tmp/mokosh-test",
    entryPoints: [],
    scanOptions: {},
    rawConfig: {},
    featureThreshold: undefined,
    queryStr: undefined,
    mermaidOutput: false,
    plain: false,
    excludeTests: false,
    file: undefined,
    typeFilter: undefined,
    filterPaths: undefined,
    minOutDegree: undefined,
    functionName: undefined,
    dryRun: false,
    depth: undefined,
    cached: false,
    changedSymbols: undefined,
    withEdgeDetail: false,
    metric: undefined,
    complexityThreshold: undefined,
    limit: undefined,
    slim: false,
    testsOnly: false,
    ...overrides,
  };
}

export const FIXTURE = {
  nodes: [
    {
      path: "src/a.ts",
      type: "typescript" as const,
      category: "logic" as const,
      tags: [],
      imports: [],
      exports: [{ name: "foo" }],
      mtime: 0,
      size: 0,
    },
    {
      path: "src/b.ts",
      type: "typescript" as const,
      category: "logic" as const,
      tags: [],
      imports: [
        {
          fromPath: "src/b.ts",
          toPath: "src/a.ts",
          rawSpecifier: "./a",
          isStyle: false,
          type: "static" as const,
          symbols: ["foo"],
        },
      ],
      exports: [],
      mtime: 0,
      size: 0,
    },
  ],
};

export function makeFixtureGraph(): Graph {
  return Graph.deserialize(FIXTURE);
}
