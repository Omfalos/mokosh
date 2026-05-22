import type { Graph, MokoshConfig, ScanOptions } from "../../index";

/** Shared context passed to every command handler. */
export interface CommandContext {
  graph: Graph;
  rootDir: string;
  scanOptions: ScanOptions;
  rawConfig: MokoshConfig;
  featureThreshold: number | undefined;
  queryStr: string | undefined;
  mermaidOutput: boolean;
  plain: boolean;
  excludeTests: boolean;
  file: string | undefined;
}
