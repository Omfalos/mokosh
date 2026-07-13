/** CLI entry point: parses arguments, loads configuration and the graph, then dispatches to the appropriate command. */
import { applyConfig, Graph } from "../index";
import { parseArgs } from "./args";
import { run as runAffectedTests } from "./commands/affected-tests";
import { run as runApiSurface } from "./commands/api-surface";
import { run as runApplyTags } from "./commands/apply-tags";
import { run as runCallGraph } from "./commands/call-graph";
import { run as runCallers } from "./commands/callers";
import { run as runCheckCycles } from "./commands/check-cycles";
import { run as runDetectFeatures } from "./commands/detect-features";
import { run as runFeatureGraph } from "./commands/feature-graph";
import { run as runFindUncovered } from "./commands/find-uncovered";
import { run as runFindUnused } from "./commands/find-unused";
import { run as runGraphOutput } from "./commands/graph-output";
import { runInitConfig } from "./commands/init-config";
import { runInitSkill } from "./commands/init-skill";
import { run as runModuleResponsibility } from "./commands/module-responsibility";
import { run as runProposeTags } from "./commands/propose-tags";
import { run as runTypeGraph } from "./commands/type-graph";
import type { CommandHandler } from "./commands/types";
import { resolveConfig } from "./config";
import { buildGraph, loadGraphFromCache, saveGraphToCache } from "./graph-loader";
import { HELP_TEXT, QUERY_HELP_TEXT } from "./help";

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
    callers,
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
  } = parsed;

  const autoScan =
    proposeTags ||
    affectedTests ||
    applyTags ||
    callers ||
    findUncovered ||
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
      !checkCycles
    ) {
      console.error("Error: No entry points provided");
      process.exit(1);
    }
    graph = await buildGraph(
      rootDir,
      resolvedEntryPoints,
      graph,
      silent,
      config.rawConfig.gitStats ?? false,
    );

    saveGraphToCache(graph, resolvedCachePath);
  }

  const ctx = {
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
  };

  const commands: Array<[boolean, CommandHandler]> = [
    [proposeTags, runProposeTags],
    [applyTags, runApplyTags],
    [affectedTests, runAffectedTests],
    [detectFeatures, runDetectFeatures],
    [findUnused, runFindUnused],
    [checkCycles, runCheckCycles],
    [findUncovered, runFindUncovered],
    [callers, runCallers],
    [typeGraph, runTypeGraph],
    [moduleResponsibility, runModuleResponsibility],
    [featureGraph, runFeatureGraph],
    [callGraph, runCallGraph],
    [apiSurface, runApiSurface],
  ];

  const handler = commands.find(([flag]) => flag)?.[1] ?? runGraphOutput;
  await handler(ctx);
}
