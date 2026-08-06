import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "./args";
import { run as runCallGraph } from "./commands/call-graph";
import { run as runCallers } from "./commands/callers";
import { run as runGraphOutput } from "./commands/graph-output";
import { resolveCommandHandler } from "./runner";

function makeParsedArgs(overrides: Partial<ParsedArgs> = {}): ParsedArgs {
  return {
    rootDir: "/tmp/project",
    cachePath: "/tmp/project/mokosh-cache/graph.json",
    configPath: undefined,
    mermaid: false,
    proposeTags: false,
    plain: false,
    affectedTests: false,
    detectFeatures: false,
    featureThreshold: undefined,
    findUnused: false,
    excludeTests: false,
    checkCycles: false,
    checkDocDrift: false,
    findUncovered: false,
    listTags: false,
    callers: false,
    file: undefined,
    silent: false,
    query: undefined,
    queryHelp: false,
    entryPoints: [],
    help: false,
    typeGraph: false,
    typeFilter: undefined,
    moduleResponsibility: false,
    filterPaths: undefined,
    minOutDegree: undefined,
    featureGraph: false,
    callGraph: false,
    findSymbol: false,
    functionName: undefined,
    apiSurface: false,
    applyTags: false,
    dryRun: false,
    initSkill: false,
    initConfig: false,
    force: false,
    dependencies: false,
    dependents: false,
    affected: false,
    testsOnly: false,
    changedSymbols: undefined,
    cached: false,
    depth: undefined,
    withMeta: false,
    withEdgeDetail: false,
    findComplexFunctions: false,
    metric: undefined,
    complexityThreshold: undefined,
    limit: undefined,
    workspacePackages: false,
    workspaceAffected: false,
    clearCache: false,
    slim: false,
    watch: false,
    ...overrides,
  };
}

describe("resolveCommandHandler", { tags: ["resolveCommandHandler", "runner"] }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to the default graph-output handler when no command flag is set", () => {
    expect(resolveCommandHandler(makeParsedArgs())).toBe(runGraphOutput);
  });

  it("resolves the handler for a single active command flag", () => {
    expect(resolveCommandHandler(makeParsedArgs({ callers: true }))).toBe(runCallers);
    expect(resolveCommandHandler(makeParsedArgs({ callGraph: true }))).toBe(runCallGraph);
  });

  it("errors and exits when more than one command flag is set", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    resolveCommandHandler(makeParsedArgs({ callers: true, callGraph: true }));

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("conflicting flags: --callers, --call-graph"),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
