/**
 * Integration-style tests for `run()` — the CLI entry point's top-level orchestration
 * (early-exit flags, workspace mode, auto-scan gating, graph load/build/cache, and dispatch to
 * the resolved command handler, including `--watch`). `resolveCommandHandler` itself is a pure
 * function and already covered by runner.test.ts; this file mocks every collaborator `run()`
 * calls so each branch can be exercised without a real graph build or filesystem cache.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Graph } from "../index";
import type { ParsedArgs } from "./args";
import { run as runCallers } from "./commands/callers";
import { run as runFindUnused } from "./commands/find-unused";
import { run as runGraphOutput } from "./commands/graph-output";

const { parseArgsMock } = vi.hoisted(() => ({ parseArgsMock: vi.fn() }));
vi.mock("./args", () => ({ parseArgs: parseArgsMock }));

const { resolveConfigMock } = vi.hoisted(() => ({ resolveConfigMock: vi.fn() }));
vi.mock("./config", () => ({ resolveConfig: resolveConfigMock }));

const { loadGraphFromCacheMock, saveGraphToCacheMock, buildGraphMock } = vi.hoisted(() => ({
  loadGraphFromCacheMock: vi.fn(),
  saveGraphToCacheMock: vi.fn(),
  buildGraphMock: vi.fn(),
}));
vi.mock("./graph-loader", () => ({
  loadGraphFromCache: loadGraphFromCacheMock,
  saveGraphToCache: saveGraphToCacheMock,
  buildGraph: buildGraphMock,
}));

const { applyConfigMock, configToGraphOptionsMock, createWorkspaceGraphMock } = vi.hoisted(() => ({
  applyConfigMock: vi.fn(),
  configToGraphOptionsMock: vi.fn(() => ({})),
  createWorkspaceGraphMock: vi.fn(),
}));
vi.mock("../index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../index")>();
  return {
    ...actual,
    applyConfig: applyConfigMock,
    configToGraphOptions: configToGraphOptionsMock,
    createWorkspaceGraph: createWorkspaceGraphMock,
  };
});

const { watchAndRunMock } = vi.hoisted(() => ({ watchAndRunMock: vi.fn() }));
vi.mock("./watch", () => ({ watchAndRun: watchAndRunMock }));

vi.mock("./help", () => ({ HELP_TEXT: "HELP_TEXT", QUERY_HELP_TEXT: "QUERY_HELP_TEXT" }));

const { runInitSkillMock, runInitConfigMock, runClearCacheMock } = vi.hoisted(() => ({
  runInitSkillMock: vi.fn(),
  runInitConfigMock: vi.fn(),
  runClearCacheMock: vi.fn(),
}));
vi.mock("./commands/init-skill", () => ({ runInitSkill: runInitSkillMock }));
vi.mock("./commands/init-config", () => ({ runInitConfig: runInitConfigMock }));
vi.mock("./commands/clear-cache", () => ({ runClearCache: runClearCacheMock }));

const { runWorkspacePackagesMock, runWorkspaceAffectedMock } = vi.hoisted(() => ({
  runWorkspacePackagesMock: vi.fn(),
  runWorkspaceAffectedMock: vi.fn(),
}));
vi.mock("./commands/workspace-packages", () => ({
  runWorkspacePackages: runWorkspacePackagesMock,
}));
vi.mock("./commands/workspace-affected", () => ({
  runWorkspaceAffected: runWorkspaceAffectedMock,
}));

// Every remaining command module exports `run` as its handler; mock them all identically so
// `resolveCommandHandler`'s dispatch table resolves to a distinguishable, inert mock per flag.
vi.mock("./commands/affected", () => ({ run: vi.fn() }));
vi.mock("./commands/affected-tests", () => ({ run: vi.fn() }));
vi.mock("./commands/api-surface", () => ({ run: vi.fn() }));
vi.mock("./commands/apply-tags", () => ({ run: vi.fn() }));
vi.mock("./commands/call-graph", () => ({ run: vi.fn() }));
vi.mock("./commands/callers", () => ({ run: vi.fn() }));
vi.mock("./commands/check-cycles", () => ({ run: vi.fn() }));
vi.mock("./commands/check-doc-drift", () => ({ run: vi.fn() }));
vi.mock("./commands/compare-branches", () => ({ run: vi.fn() }));
vi.mock("./commands/dependencies", () => ({ run: vi.fn() }));
vi.mock("./commands/dependents", () => ({ run: vi.fn() }));
vi.mock("./commands/detect-features", () => ({ run: vi.fn() }));
vi.mock("./commands/feature-graph", () => ({ run: vi.fn() }));
vi.mock("./commands/find-complex-functions", () => ({ run: vi.fn() }));
vi.mock("./commands/find-duplicates", () => ({ run: vi.fn() }));
vi.mock("./commands/find-risk-hotspots", () => ({ run: vi.fn() }));
vi.mock("./commands/find-symbol", () => ({ run: vi.fn() }));
vi.mock("./commands/find-uncovered", () => ({ run: vi.fn() }));
vi.mock("./commands/find-unused", () => ({ run: vi.fn() }));
vi.mock("./commands/graph-output", () => ({ run: vi.fn() }));
vi.mock("./commands/list-tags", () => ({ run: vi.fn() }));
vi.mock("./commands/module-responsibility", () => ({ run: vi.fn() }));
vi.mock("./commands/propose-tags", () => ({ run: vi.fn() }));
vi.mock("./commands/type-graph", () => ({ run: vi.fn() }));

// vi.mock calls above are hoisted above these imports, so `run` and the command handlers
// imported here — and anything runner.ts itself imports — already resolve to the mocks.
import { run } from "./runner";

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
    packageName: undefined,
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
    findDuplicates: false,
    minDuplicateLines: undefined,
    includeGenerated: false,
    includeSameFile: false,
    includeSvgMarkup: false,
    duplicateScope: undefined,
    findRiskHotspots: false,
    maxCoveragePct: undefined,
    minChurn: undefined,
    workspacePackages: false,
    workspaceAffected: false,
    clearCache: false,
    slim: false,
    watch: false,
    base: undefined,
    compareBranches: undefined,
    compareFull: false,
    compareMaxItems: undefined,
    ...overrides,
  };
}

const defaultResolvedConfig = {
  rootDir: "/tmp/project",
  resolvedEntryPoints: [] as string[],
  resolvedCachePath: "/tmp/project/mokosh-cache/graph.json",
  scanOptions: {},
  rawConfig: {},
};

/** Mocks `process.exit` to actually halt execution (throwing, like a real exit) rather than
 *  returning `undefined` and letting `run()` fall through into code that assumes it's unreachable. */
class ProcessExitError extends Error {
  constructor(public code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

function mockProcessExit() {
  return vi.spyOn(process, "exit").mockImplementation((code?: string | number | null): never => {
    throw new ProcessExitError(typeof code === "number" ? code : undefined);
  });
}

async function runExpectingExit(code: number): Promise<void> {
  await expect(run()).rejects.toThrow(new ProcessExitError(code));
}

function setup(
  argsOverrides: Partial<ParsedArgs> = {},
  configOverrides: Partial<typeof defaultResolvedConfig> = {},
) {
  const parsed = makeParsedArgs(argsOverrides);
  parseArgsMock.mockReturnValue(parsed);
  resolveConfigMock.mockReturnValue({ ...defaultResolvedConfig, ...configOverrides });
  loadGraphFromCacheMock.mockReturnValue(null);
  buildGraphMock.mockResolvedValue(new Graph(new Map()));
  return parsed;
}

describe("run()", { tags: ["run", "runner"] }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
    parseArgsMock.mockReset();
    resolveConfigMock.mockReset();
    loadGraphFromCacheMock.mockReset();
    saveGraphToCacheMock.mockReset();
    buildGraphMock.mockReset();
    applyConfigMock.mockReset();
    createWorkspaceGraphMock.mockReset();
    watchAndRunMock.mockReset();
    runInitSkillMock.mockReset();
    runInitConfigMock.mockReset();
    runClearCacheMock.mockReset();
    runWorkspacePackagesMock.mockReset();
    runWorkspaceAffectedMock.mockReset();
    vi.mocked(runGraphOutput).mockReset();
    vi.mocked(runCallers).mockReset();
    vi.mocked(runFindUnused).mockReset();
  });

  describe("early-exit flags", () => {
    it("prints help and exits 0 without touching config or the graph", async () => {
      setup({ help: true });
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      mockProcessExit();

      await runExpectingExit(0);

      expect(logSpy).toHaveBeenCalledWith("HELP_TEXT");
      expect(resolveConfigMock).not.toHaveBeenCalled();
    });

    it("prints query help and exits 0", async () => {
      setup({ queryHelp: true });
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      mockProcessExit();

      await runExpectingExit(0);

      expect(logSpy).toHaveBeenCalledWith("QUERY_HELP_TEXT");
    });

    it("runs init-skill and exits 0", async () => {
      setup({ initSkill: true, force: true });
      mockProcessExit();

      await runExpectingExit(0);

      expect(runInitSkillMock).toHaveBeenCalledWith(true);
    });

    it("runs init-config and exits 0", async () => {
      setup({ initConfig: true, force: false });
      mockProcessExit();

      await runExpectingExit(0);

      expect(runInitConfigMock).toHaveBeenCalledWith(false);
    });

    it("runs clear-cache and exits 0", async () => {
      setup({ clearCache: true, cachePath: "/tmp/project/mokosh-cache/graph.json" });
      mockProcessExit();

      await runExpectingExit(0);

      expect(runClearCacheMock).toHaveBeenCalledWith("/tmp/project/mokosh-cache/graph.json");
    });
  });

  describe("workspace mode", () => {
    it("builds a workspace graph and lists packages for --workspace-packages", async () => {
      setup({ workspacePackages: true });
      const workspaceGraph = { packages: new Map() };
      createWorkspaceGraphMock.mockResolvedValue(workspaceGraph);

      await run();

      expect(createWorkspaceGraphMock).toHaveBeenCalledWith("/tmp/project", {});
      expect(runWorkspacePackagesMock).toHaveBeenCalledWith(workspaceGraph);
      expect(buildGraphMock).not.toHaveBeenCalled();
    });

    it("errors when --workspace-affected is passed without --file", async () => {
      setup({ workspaceAffected: true, file: undefined });
      createWorkspaceGraphMock.mockResolvedValue({ packages: new Map() });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      mockProcessExit();

      await runExpectingExit(1);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("--workspace-affected requires --file"),
      );
      expect(runWorkspaceAffectedMock).not.toHaveBeenCalled();
    });

    it("runs workspace-affected for a given --file", async () => {
      setup({ workspaceAffected: true, file: "packages/a/src/index.ts" });
      const workspaceGraph = { packages: new Map() };
      createWorkspaceGraphMock.mockResolvedValue(workspaceGraph);

      await run();

      expect(runWorkspaceAffectedMock).toHaveBeenCalledWith(
        workspaceGraph,
        "packages/a/src/index.ts",
      );
    });

    it("rejects --watch combined with workspace flags", async () => {
      setup({ workspacePackages: true, watch: true });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      mockProcessExit();

      await runExpectingExit(1);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("--watch is not supported with --workspace-packages"),
      );
      expect(createWorkspaceGraphMock).not.toHaveBeenCalled();
    });
  });

  describe("entry-point / auto-scan gating", () => {
    it("errors when no entry points are given and no auto-scan flag applies", async () => {
      setup({});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      mockProcessExit();

      await runExpectingExit(1);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("No entry points provided"));
      expect(buildGraphMock).not.toHaveBeenCalled();
    });

    it("skips the error and reuses the cached graph when an auto-scan flag is set (e.g. --callers)", async () => {
      setup({ callers: true });
      const cached = new Graph(new Map());
      loadGraphFromCacheMock.mockReturnValue(cached);

      await run();

      expect(buildGraphMock).not.toHaveBeenCalled();
      expect(runCallers).toHaveBeenCalledWith(expect.objectContaining({ graph: cached }));
    });

    it("does not error for --find-unused even with no entry points and no auto-scan match", async () => {
      setup({ findUnused: true });

      await run();

      expect(buildGraphMock).toHaveBeenCalledWith(
        "/tmp/project",
        [],
        expect.any(Graph),
        expect.any(Object),
      );
      expect(runFindUnused).toHaveBeenCalled();
    });

    it("builds and caches the graph when entry points are provided, then dispatches to the default handler", async () => {
      setup({}, { resolvedEntryPoints: ["/tmp/project/src/index.ts"] });
      const built = new Graph(new Map());
      buildGraphMock.mockResolvedValue(built);

      await run();

      expect(buildGraphMock).toHaveBeenCalledWith(
        "/tmp/project",
        ["/tmp/project/src/index.ts"],
        expect.any(Graph),
        expect.any(Object),
      );
      expect(saveGraphToCacheMock).toHaveBeenCalledWith(
        built,
        "/tmp/project/mokosh-cache/graph.json",
      );
      expect(runGraphOutput).toHaveBeenCalledWith(expect.objectContaining({ graph: built }));
    });
  });

  describe("--watch", () => {
    it("errors when --watch is combined with a handler that isn't watch-safe", async () => {
      setup(
        { apiSurface: true, watch: true },
        { resolvedEntryPoints: ["/tmp/project/src/index.ts"] },
      );
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      mockProcessExit();

      await runExpectingExit(1);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("--watch is only supported with"),
      );
      expect(watchAndRunMock).not.toHaveBeenCalled();
    });

    it("starts the watch loop for a watch-safe handler and rebuilds on each trigger", async () => {
      setup({ watch: true }, { resolvedEntryPoints: ["/tmp/project/src/index.ts"] });
      const rebuilt = new Graph(new Map());
      buildGraphMock.mockResolvedValueOnce(new Graph(new Map())).mockResolvedValueOnce(rebuilt);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      watchAndRunMock.mockImplementation((_root, _debounce, rerun) => {
        void rerun();
      });

      await run();

      expect(watchAndRunMock).toHaveBeenCalledWith("/tmp/project", 300, expect.any(Function));
      // initial build (before entering watch mode) + one rebuild inside the trigger callback
      expect(buildGraphMock).toHaveBeenCalledTimes(2);
      expect(saveGraphToCacheMock).toHaveBeenCalledWith(
        rebuilt,
        "/tmp/project/mokosh-cache/graph.json",
      );
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("rebuilt at"));
      expect(runGraphOutput).toHaveBeenCalledWith(expect.objectContaining({ graph: rebuilt }));
    });
  });
});
