export const enum Flag {
  Root = "--root",
  Cache = "--cache",
  Config = "--config",
  Query = "--query",
  FeatureThreshold = "--feature-threshold",
  Mermaid = "--mermaid",
  ProposeTags = "--propose-tags",
  Plain = "--plain",
  AffectedTests = "--affected-tests",
  DetectFeatures = "--detect-features",
  FindUnused = "--find-unused",
  ExcludeTests = "--exclude-tests",
  CheckCycles = "--check-cycles",
  FindUncovered = "--find-uncovered",
  Callers = "--callers",
  File = "--file",
  Silent = "--silent",
  QueryHelp = "--query-help",
  Help = "--help",
}

export const DEFAULT_CACHE_DIR = "mokosh-cache";
export const DEFAULT_CACHE_FILE = "graph.json";