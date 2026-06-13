/** CLI entry point: parses arguments, loads configuration and the graph, then dispatches to the appropriate command. */
import { applyConfig, Graph } from "../index";
import { parseArgs } from "./args";
import { run as runAffectedTests } from "./commands/affected-tests";
import { run as runCallers } from "./commands/callers";
import { run as runCheckCycles } from "./commands/check-cycles";
import { run as runDetectFeatures } from "./commands/detect-features";
import { run as runFindUncovered } from "./commands/find-uncovered";
import { run as runFindUnused } from "./commands/find-unused";
import { run as runGraphOutput } from "./commands/graph-output";
import { run as runProposeTags } from "./commands/propose-tags";
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
  } = parsed;

  const autoScan = proposeTags || affectedTests || callers || findUncovered;

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
    scanOptions,
    rawConfig: config.rawConfig,
    featureThreshold,
    queryStr,
    mermaidOutput,
    plain,
    excludeTests,
    file,
  };

  if (proposeTags) {
    await runProposeTags(ctx);
  } else if (affectedTests) {
    await runAffectedTests(ctx);
  } else if (detectFeatures) {
    await runDetectFeatures(ctx);
  } else if (findUnused) {
    await runFindUnused(ctx);
  } else if (checkCycles) {
    await runCheckCycles(ctx);
  } else if (findUncovered) {
    await runFindUncovered(ctx);
  } else if (callers) {
    await runCallers(ctx);
  } else {
    await runGraphOutput(ctx);
  }
}
