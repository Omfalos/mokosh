/** CLI entry point: parses arguments, loads configuration and the graph, then dispatches to the appropriate command. */
import {
  applyConfig,
  configToGraphOptions,
  createWorkspaceGraph,
  Graph,
  type MokoshConfig,
} from "../index";
import type { ParsedArgs } from "./args";
import { parseArgs } from "./args";
import { run as runAffected } from "./commands/affected";
import { run as runAffectedTests } from "./commands/affected-tests";
import { run as runApiSurface } from "./commands/api-surface";
import { run as runApplyTags } from "./commands/apply-tags";
import { run as runCallGraph } from "./commands/call-graph";
import { run as runCallers } from "./commands/callers";
import { run as runCheckCycles } from "./commands/check-cycles";
import { run as runCheckDocDrift } from "./commands/check-doc-drift";
import { runClearCache } from "./commands/clear-cache";
import { run as runCompareBranches } from "./commands/compare-branches";
import { run as runDependencies } from "./commands/dependencies";
import { run as runDependents } from "./commands/dependents";
import { run as runDetectFeatures } from "./commands/detect-features";
import { run as runFeatureGraph } from "./commands/feature-graph";
import { run as runFindComplexFunctions } from "./commands/find-complex-functions";
import { run as runFindDuplicates } from "./commands/find-duplicates";
import { run as runFindRiskHotspots } from "./commands/find-risk-hotspots";
import { run as runFindSymbol } from "./commands/find-symbol";
import { run as runFindUncovered } from "./commands/find-uncovered";
import { run as runFindUnused } from "./commands/find-unused";
import { run as runGraphOutput } from "./commands/graph-output";
import { runInitConfig } from "./commands/init-config";
import { runInitSkill } from "./commands/init-skill";
import { run as runListTags } from "./commands/list-tags";
import { run as runModuleResponsibility } from "./commands/module-responsibility";
import { run as runProposeTags } from "./commands/propose-tags";
import { run as runTypeGraph } from "./commands/type-graph";
import type { CommandContext, CommandHandler } from "./commands/types";
import { runWorkspaceAffected } from "./commands/workspace-affected";
import { runWorkspacePackages } from "./commands/workspace-packages";
import { type ResolvedConfig, resolveConfig } from "./config";
import { buildGraph, loadGraphFromCache, saveGraphToCache } from "./graph-loader";
import { HELP_TEXT, QUERY_HELP_TEXT } from "./help";
import { watchAndRun } from "./watch";

/** Commands that only read a snapshot and print — safe to re-run in a loop under `--watch`. */
const WATCHABLE_COMMANDS = new Set<CommandHandler>([
  runGraphOutput,
  runCallers,
  runDependencies,
  runDependents,
  runAffected,
  runFindUncovered,
  runFindComplexFunctions,
  runFindDuplicates,
  runFindRiskHotspots,
  runCheckCycles,
  runCheckDocDrift,
  runListTags,
]);

/**
 * @description Handles the CLI's one-shot, no-graph-needed flags (help text, skill/config
 *   scaffolding, cache clearing). Exits the process directly when one applies; does nothing
 *   otherwise, letting `run()` continue to graph-building commands.
 * @param {ParsedArgs} parsed - The fully parsed CLI arguments.
 */
function handleEarlyExitFlags(parsed: ParsedArgs): void {
  if (parsed.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }
  if (parsed.queryHelp) {
    console.log(QUERY_HELP_TEXT);
    process.exit(0);
  }
  if (parsed.initSkill) {
    runInitSkill(parsed.force);
    process.exit(0);
  }
  if (parsed.initConfig) {
    runInitConfig(parsed.force);
    process.exit(0);
  }
  if (parsed.clearCache) {
    runClearCache(parsed.cachePath);
    process.exit(0);
  }
}

/**
 * @description Handles `--workspace-packages`/`--workspace-affected`, which build a
 *   `WorkspaceGraph` instead of the single-package `Graph` the rest of `run()` uses.
 * @param {ParsedArgs} parsed - The fully parsed CLI arguments.
 * @param {ResolvedConfig} config - Resolved config, used for graph-build options.
 * @param {string} rootDir - Absolute project root.
 * @returns {Promise<boolean>} `true` if a workspace command was handled (caller should return immediately).
 */
async function runWorkspaceMode(
  parsed: ParsedArgs,
  config: ResolvedConfig,
  rootDir: string,
): Promise<boolean> {
  if (!parsed.workspacePackages && !parsed.workspaceAffected) return false;

  if (parsed.watch) {
    console.error("Error: --watch is not supported with --workspace-packages/--workspace-affected");
    process.exit(1);
  }

  const workspaceGraph = await createWorkspaceGraph(
    rootDir,
    configToGraphOptions(config.rawConfig),
  );

  if (parsed.workspacePackages) {
    runWorkspacePackages(workspaceGraph);
  } else {
    if (!parsed.file) {
      console.error("Error: --workspace-affected requires --file <path>");
      process.exit(1);
    }
    runWorkspaceAffected(workspaceGraph, parsed.file);
  }
  return true;
}

/**
 * @description Whether any flag requires building/loading a graph without explicit entry
 *   points (e.g. `--call-graph`, `--callers`), reusing whatever's cached from a prior run.
 * @param {ParsedArgs} parsed - The fully parsed CLI arguments.
 * @returns {boolean} `true` if entry points may be omitted because a command flag implies scanning.
 */
function computeAutoScan(parsed: ParsedArgs): boolean {
  return (
    parsed.proposeTags ||
    parsed.affectedTests ||
    parsed.applyTags ||
    parsed.callers ||
    parsed.dependencies ||
    parsed.dependents ||
    parsed.affected ||
    parsed.findUncovered ||
    parsed.listTags ||
    parsed.findComplexFunctions ||
    parsed.findDuplicates ||
    parsed.findRiskHotspots ||
    parsed.typeGraph ||
    parsed.moduleResponsibility ||
    parsed.callGraph ||
    parsed.findSymbol ||
    parsed.apiSurface ||
    !!parsed.compareBranches
  );
}

interface CommandEntry {
  name: string;
  flag: boolean;
  handler: CommandHandler;
}

/**
 * @description Resolves which command flag was passed to a handler. Errors out if more than
 *   one command flag is set at once, rather than silently picking whichever comes first.
 * @param {ParsedArgs} parsed - The fully parsed CLI arguments.
 * @returns {CommandHandler} The handler for the single active command flag, or the default
 *   graph-output handler if none are set.
 */
export function resolveCommandHandler(parsed: ParsedArgs): CommandHandler {
  const commands: CommandEntry[] = [
    { name: "--propose-tags", flag: parsed.proposeTags, handler: runProposeTags },
    { name: "--apply-tags", flag: parsed.applyTags, handler: runApplyTags },
    { name: "--affected-tests", flag: parsed.affectedTests, handler: runAffectedTests },
    { name: "--detect-features", flag: parsed.detectFeatures, handler: runDetectFeatures },
    { name: "--find-unused", flag: parsed.findUnused, handler: runFindUnused },
    { name: "--check-cycles", flag: parsed.checkCycles, handler: runCheckCycles },
    { name: "--check-doc-drift", flag: parsed.checkDocDrift, handler: runCheckDocDrift },
    { name: "--find-uncovered", flag: parsed.findUncovered, handler: runFindUncovered },
    { name: "--list-tags", flag: parsed.listTags, handler: runListTags },
    { name: "--callers", flag: parsed.callers, handler: runCallers },
    { name: "--dependencies", flag: parsed.dependencies, handler: runDependencies },
    { name: "--dependents", flag: parsed.dependents, handler: runDependents },
    { name: "--affected", flag: parsed.affected, handler: runAffected },
    {
      name: "--find-complex-functions",
      flag: parsed.findComplexFunctions,
      handler: runFindComplexFunctions,
    },
    { name: "--find-duplicates", flag: parsed.findDuplicates, handler: runFindDuplicates },
    { name: "--find-risk-hotspots", flag: parsed.findRiskHotspots, handler: runFindRiskHotspots },
    { name: "--type-graph", flag: parsed.typeGraph, handler: runTypeGraph },
    {
      name: "--module-responsibility",
      flag: parsed.moduleResponsibility,
      handler: runModuleResponsibility,
    },
    { name: "--feature-graph", flag: parsed.featureGraph, handler: runFeatureGraph },
    { name: "--call-graph", flag: parsed.callGraph, handler: runCallGraph },
    { name: "--find-symbol", flag: parsed.findSymbol, handler: runFindSymbol },
    { name: "--api-surface", flag: parsed.apiSurface, handler: runApiSurface },
    {
      name: "--compare-branches",
      flag: !!parsed.compareBranches,
      handler: runCompareBranches,
    },
  ];

  const active = commands.filter((command) => command.flag);
  if (active.length > 1) {
    console.error(
      `Error: conflicting flags: ${active.map((command) => command.name).join(", ")} (pass only one command flag)`,
    );
    process.exit(1);
  }

  return active[0]?.handler ?? runGraphOutput;
}

/**
 * @description Runs `handler` once immediately, then re-runs it on every debounced file-change
 *   batch, rebuilding and re-caching the graph each time.
 * @param {CommandHandler} handler - The resolved command handler to re-invoke.
 * @param {CommandContext} ctx - Base command context; only `graph` is replaced on each re-run.
 * @param {string} rootDir - Absolute project root, watched for changes.
 * @param {string[]} resolvedEntryPoints - Entry points to rebuild the graph from.
 * @param {string} resolvedCachePath - Where to persist the rebuilt graph.
 * @param {boolean} silent - Suppresses build progress output when true.
 * @param {MokoshConfig} rawConfig - Config used to derive graph-build options on rebuild.
 */
async function runWatchLoop(
  handler: CommandHandler,
  ctx: CommandContext,
  rootDir: string,
  resolvedEntryPoints: string[],
  resolvedCachePath: string,
  silent: boolean,
  rawConfig: MokoshConfig,
): Promise<void> {
  if (!WATCHABLE_COMMANDS.has(handler)) {
    console.error(
      "Error: --watch is only supported with the default output, --query, --callers, --dependencies, --dependents, --affected, --find-uncovered, --find-complex-functions, --find-duplicates, --find-risk-hotspots, --check-cycles, --check-doc-drift, and --list-tags",
    );
    process.exit(1);
  }
  watchAndRun(rootDir, 300, async () => {
    const freshGraph = await buildGraph(rootDir, resolvedEntryPoints, ctx.graph, {
      silent,
      ...configToGraphOptions(rawConfig),
    });
    saveGraphToCache(freshGraph, resolvedCachePath);
    console.log(`--- rebuilt at ${new Date().toISOString()} ---`);
    await handler({ ...ctx, graph: freshGraph });
  });
}

/**
 * @description Parses CLI arguments, loads configuration, builds or restores the
 *   dependency graph, then dispatches to the appropriate sub-command handler.
 */
export async function run(): Promise<void> {
  const argv = process.argv.slice(2);
  const parsed = parseArgs(argv);

  handleEarlyExitFlags(parsed);

  const config = resolveConfig(parsed);
  applyConfig(config.rawConfig);
  const { rootDir, resolvedEntryPoints, resolvedCachePath, scanOptions } = config;

  if (await runWorkspaceMode(parsed, config, rootDir)) return;

  const autoScan = computeAutoScan(parsed);

  let graph: Graph = loadGraphFromCache(resolvedCachePath) ?? new Graph(new Map());

  if (resolvedEntryPoints.length > 0 || !autoScan) {
    if (
      resolvedEntryPoints.length === 0 &&
      !autoScan &&
      !parsed.findUnused &&
      !parsed.detectFeatures &&
      !parsed.checkCycles &&
      !parsed.checkDocDrift
    ) {
      console.error("Error: No entry points provided");
      process.exit(1);
    }
    graph = await buildGraph(rootDir, resolvedEntryPoints, graph, {
      silent: parsed.silent,
      ...configToGraphOptions(config.rawConfig),
    });

    saveGraphToCache(graph, resolvedCachePath);
  }

  const ctx: CommandContext = {
    graph,
    rootDir,
    cachePath: resolvedCachePath,
    entryPoints: resolvedEntryPoints.map((entryPath) => entryPath.replace(`${rootDir}/`, "")),
    scanOptions,
    rawConfig: config.rawConfig,
    featureThreshold: parsed.featureThreshold,
    queryStr: parsed.query,
    mermaidOutput: parsed.mermaid,
    plain: parsed.plain,
    excludeTests: parsed.excludeTests,
    file: parsed.file,
    typeFilter: parsed.typeFilter,
    filterPaths: parsed.filterPaths,
    minOutDegree: parsed.minOutDegree,
    functionName: parsed.functionName,
    dryRun: parsed.dryRun,
    depth: parsed.depth,
    cached: parsed.cached,
    changedSymbols: parsed.changedSymbols,
    withMeta: parsed.withMeta,
    withEdgeDetail: parsed.withEdgeDetail,
    metric: parsed.metric,
    complexityThreshold: parsed.complexityThreshold,
    limit: parsed.limit,
    slim: parsed.slim,
    testsOnly: parsed.testsOnly,
    minDuplicateLines: parsed.minDuplicateLines,
    includeGenerated: parsed.includeGenerated,
    maxCoveragePct: parsed.maxCoveragePct,
    minChurn: parsed.minChurn,
    base: parsed.base,
    compareBranches: parsed.compareBranches,
    compareFull: parsed.compareFull,
    compareMaxItems: parsed.compareMaxItems,
  };

  const handler = resolveCommandHandler(parsed);

  if (parsed.watch) {
    await runWatchLoop(
      handler,
      ctx,
      rootDir,
      resolvedEntryPoints,
      resolvedCachePath,
      parsed.silent,
      config.rawConfig,
    );
    return;
  }

  await handler(ctx);
}
