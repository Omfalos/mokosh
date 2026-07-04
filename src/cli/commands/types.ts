import type { Graph, MokoshConfig, ScanOptions } from "../../index";

export type CommandHandler = (ctx: CommandContext) => Promise<void>;

/** Shared context passed to every command handler. */
export interface CommandContext {
  graph: Graph;
  rootDir: string;
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
}
