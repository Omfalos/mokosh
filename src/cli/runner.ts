/** CLI entry point: parses arguments, loads configuration and the graph, then dispatches to the appropriate command. */
import { applyConfig, configToGraphOptions, createWorkspaceGraph, Graph } from "../index";
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
import { run as runDependencies } from "./commands/dependencies";
import { run as runDependents } from "./commands/dependents";
import { run as runDetectFeatures } from "./commands/detect-features";
import { run as runFeatureGraph } from "./commands/feature-graph";
import { run as runFindComplexFunctions } from "./commands/find-complex-functions";
import { run as runFindUncovered } from "./commands/find-uncovered";
import { run as runFindUnused } from "./commands/find-unused";
import { run as runGraphOutput } from "./commands/graph-output";
import { runInitConfig } from "./commands/init-config";
import { runInitSkill } from "./commands/init-skill";
import { run as runModuleResponsibility } from "./commands/module-responsibility";
import { run as runProposeTags } from "./commands/propose-tags";
import { run as runTypeGraph } from "./commands/type-graph";
import type { CommandContext, CommandHandler } from "./commands/types";
import { runWorkspaceAffected } from "./commands/workspace-affected";
import { runWorkspacePackages } from "./commands/workspace-packages";
import { resolveConfig } from "./config";
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
  runCheckCycles,
  runCheckDocDrift,
]);

/**
 * @description Parses CLI arguments, loads configuration, builds or restores the
 *   dependency graph, then dispatches to the appropriate sub-command handler.
 */
export async function run(): Promise<void> {
  const argv = process.argv.slice(2);
  const parsed = parseArgs(argv);

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

  const config = resolveConfig(parsed);
  applyConfig(config.rawConfig);
  const { rootDir, resolvedEntryPoints, resolvedCachePath, scanOptions } = config;
  const {
    proposeTags,
    plain,
    affectedTests,
    detectFeatures,
    findUnused,
    findUncovered,
    excludeTests,
    checkCycles,
    checkDocDrift,
    callers,
    dependencies,
    dependents,
    affected,
    file,
    silent,
    featureThreshold,
    query: queryStr,
    mermaid: mermaidOutput,
    typeGraph,
    typeFilter,
    moduleResponsibility,
    filterPaths,
    minOutDegree,
    featureGraph,
    callGraph,
    functionName,
    apiSurface,
    applyTags,
    dryRun,
    depth,
    cached,
    changedSymbols,
    withEdgeDetail,
    findComplexFunctions,
    metric,
    complexityThreshold,
    limit,
    workspacePackages,
    workspaceAffected,
    slim,
    testsOnly,
    watch,
  } = parsed;

  if (workspacePackages || workspaceAffected) {
    if (watch) {
      console.error(
        "Error: --watch is not supported with --workspace-packages/--workspace-affected",
      );
      process.exit(1);
    }
    const workspaceGraph = await createWorkspaceGraph(
      rootDir,
      configToGraphOptions(config.rawConfig),
    );
    if (workspacePackages) {
      runWorkspacePackages(workspaceGraph);
    } else {
      if (!file) {
        console.error("Error: --workspace-affected requires --file <path>");
        process.exit(1);
      }
      runWorkspaceAffected(workspaceGraph, file);
    }
    return;
  }

  const autoScan =
    proposeTags ||
    affectedTests ||
    applyTags ||
    callers ||
    dependencies ||
    dependents ||
    affected ||
    findUncovered ||
    findComplexFunctions ||
    typeGraph ||
    moduleResponsibility ||
    callGraph ||
    apiSurface;

  let graph: Graph = loadGraphFromCache(resolvedCachePath) ?? new Graph(new Map());

  if (resolvedEntryPoints.length > 0 || !autoScan) {
    if (
      resolvedEntryPoints.length === 0 &&
      !autoScan &&
      !findUnused &&
      !detectFeatures &&
      !checkCycles &&
      !checkDocDrift
    ) {
      console.error("Error: No entry points provided");
      process.exit(1);
    }
    graph = await buildGraph(rootDir, resolvedEntryPoints, graph, {
      silent,
      ...configToGraphOptions(config.rawConfig),
    });

    saveGraphToCache(graph, resolvedCachePath);
  }

  const ctx: CommandContext = {
    graph,
    rootDir,
    entryPoints: resolvedEntryPoints.map((entryPath) => entryPath.replace(rootDir + "/", "")),
    scanOptions,
    rawConfig: config.rawConfig,
    featureThreshold,
    queryStr,
    mermaidOutput,
    plain,
    excludeTests,
    file,
    typeFilter,
    filterPaths,
    minOutDegree,
    functionName,
    dryRun,
    depth,
    cached,
    changedSymbols,
    withEdgeDetail,
    metric,
    complexityThreshold,
    limit,
    slim,
    testsOnly,
  };

  const commands: Array<[boolean, CommandHandler]> = [
    [proposeTags, runProposeTags],
    [applyTags, runApplyTags],
    [affectedTests, runAffectedTests],
    [detectFeatures, runDetectFeatures],
    [findUnused, runFindUnused],
    [checkCycles, runCheckCycles],
    [checkDocDrift, runCheckDocDrift],
    [findUncovered, runFindUncovered],
    [callers, runCallers],
    [dependencies, runDependencies],
    [dependents, runDependents],
    [affected, runAffected],
    [findComplexFunctions, runFindComplexFunctions],
    [typeGraph, runTypeGraph],
    [moduleResponsibility, runModuleResponsibility],
    [featureGraph, runFeatureGraph],
    [callGraph, runCallGraph],
    [apiSurface, runApiSurface],
  ];

  const handler = commands.find(([flag]) => flag)?.[1] ?? runGraphOutput;

  if (watch) {
    if (!WATCHABLE_COMMANDS.has(handler)) {
      console.error(
        "Error: --watch is only supported with the default output, --query, --callers, --dependencies, --dependents, --affected, --find-uncovered, --find-complex-functions, --check-cycles, and --check-doc-drift",
      );
      process.exit(1);
    }
    watchAndRun(rootDir, 300, async () => {
      const freshGraph = await buildGraph(rootDir, resolvedEntryPoints, ctx.graph, {
        silent,
        ...configToGraphOptions(config.rawConfig),
      });
      saveGraphToCache(freshGraph, resolvedCachePath);
      console.log(`--- rebuilt at ${new Date().toISOString()} ---`);
      await handler({ ...ctx, graph: freshGraph });
    });
    return;
  }

  await handler(ctx);
}
