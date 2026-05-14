import { applyConfig, Graph } from "../index";
import { parseArgs } from "./args";
import { run as runAffectedTests } from "./commands/affected-tests";
import { run as runCheckCycles } from "./commands/check-cycles";
import { run as runDetectFeatures } from "./commands/detect-features";
import { run as runFindUnused } from "./commands/find-unused";
import { run as runGraphOutput } from "./commands/graph-output";
import { run as runProposeTags } from "./commands/propose-tags";
import { resolveConfig } from "./config";
import { buildGraph, loadGraphFromCache, saveGraphToCache } from "./graph-loader";
import { HELP_TEXT, QUERY_HELP_TEXT } from "./help";

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
    excludeTests,
    checkCycles,
    silent,
    featureThreshold,
    query: queryStr,
    mermaid: mermaidOutput,
  } = parsed;

  const autoScan = proposeTags || affectedTests;

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
    featureThreshold,
    queryStr,
    mermaidOutput,
    plain,
    excludeTests,
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
  } else {
    await runGraphOutput(ctx);
  }
}
