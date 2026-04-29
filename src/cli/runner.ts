import { applyConfig, Graph } from "../index";
import { parseArgs } from "./args";
import * as affectedTests from "./commands/affected-tests";
import * as checkCycles from "./commands/check-cycles";
import * as detectFeatures from "./commands/detect-features";
import * as findUnused from "./commands/find-unused";
import * as graphOutput from "./commands/graph-output";
import * as proposeTags from "./commands/propose-tags";
import { resolveConfig } from "./config";
import { buildGraph, loadGraphFromCache, saveGraphToCache } from "./graph-loader";
import { HELP_TEXT } from "./help";

export async function run(): Promise<void> {
  const argv = process.argv.slice(2);
  const parsed = parseArgs(argv);

  if (parsed.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  const config = resolveConfig(parsed);
  applyConfig(config.rawConfig);
  const { rootDir, resolvedEntryPoints, resolvedCachePath, scanOptions } = config;
  const {
    proposeTagsFlag,
    proposeTagsPlain,
    affectedTestsFlag,
    detectFeaturesFlag,
    findUnusedFlag,
    excludeTests,
    checkCyclesFlag,
    silent,
  } = parsed;
  const { featureThreshold, queryStr, mermaidOutput } = parsed;

  const autoScanFlag = proposeTagsFlag || affectedTestsFlag;

  let graph: Graph = loadGraphFromCache(resolvedCachePath) ?? new Graph(new Map());

  if (resolvedEntryPoints.length > 0 || !autoScanFlag) {
    if (
      resolvedEntryPoints.length === 0 &&
      !autoScanFlag &&
      !findUnusedFlag &&
      !detectFeaturesFlag &&
      !checkCyclesFlag
    ) {
      console.error("Error: No entry points provided");
      process.exit(1);
    }
    graph = await buildGraph(rootDir, resolvedEntryPoints, graph, silent);

    saveGraphToCache(graph, resolvedCachePath);
  }

  const ctx = {
    graph,
    rootDir,
    scanOptions,
    featureThreshold,
    queryStr,
    mermaidOutput,
    plain: proposeTagsPlain,
    excludeTests,
  };

  if (proposeTagsFlag) {
    await proposeTags.run(ctx);
  } else if (affectedTestsFlag) {
    await affectedTests.run(ctx);
  } else if (detectFeaturesFlag) {
    await detectFeatures.run(ctx);
  } else if (findUnusedFlag) {
    await findUnused.run(ctx);
  } else if (checkCyclesFlag) {
    await checkCycles.run(ctx);
  } else {
    await graphOutput.run(ctx);
  }
}
