import type { Graph, MokoshConfig, ScanOptions } from "../../index";

export type CommandHandler = (ctx: CommandContext) => Promise<void>;

/** Shared context passed to every command handler. */
export interface CommandContext {
  graph: Graph;
  rootDir: string;
  /** Resolved path to the disk graph cache file (`--cache` or the default); commands that
   *  maintain their own disk cache (e.g. `find-duplicates`'s token cache) derive their cache
   *  path from this one's directory so `--cache` relocates every cache file together. */
  cachePath: string;
  entryPoints: string[];
  scanOptions: ScanOptions;
  rawConfig: MokoshConfig;
  featureThreshold: number | undefined;
  queryStr: string | undefined;
  mermaidOutput: boolean;
  plain: boolean;
  excludeTests: boolean;
  file: string | undefined;
  typeFilter: string | undefined;
  filterPaths: string[] | undefined;
  minOutDegree: number | undefined;
  functionName: string | undefined;
  dryRun: boolean;
  depth: number | undefined;
  cached: boolean;
  changedSymbols: string[] | undefined;
  withMeta: boolean;
  withEdgeDetail: boolean;
  metric: "cognitiveComplexity" | "complexity" | undefined;
  complexityThreshold: number | undefined;
  limit: number | undefined;
  slim: boolean;
  testsOnly: boolean;
  minDuplicateLines: number | undefined;
  includeGenerated: boolean;
  maxCoveragePct: number | undefined;
  minChurn: number | undefined;
  base: string | undefined;
  compareBranches: string | undefined;
  compareFull: boolean;
  compareMaxItems: number | undefined;
}
