import path from "node:path";

export interface ParsedArgs {
  rootDir: string;
  cachePath: string | undefined;
  configPath: string | undefined;
  mermaidOutput: boolean;
  proposeTagsFlag: boolean;
  proposeTagsPlain: boolean;
  affectedTestsFlag: boolean;
  detectFeaturesFlag: boolean;
  featureThreshold: number | undefined;
  findUnusedFlag: boolean;
  excludeTests: boolean;
  checkCyclesFlag: boolean;
  silent: boolean;
  queryStr: string | undefined;
  entryPoints: string[];
  help: boolean;
}

/**
 * Parses raw CLI argv into structured flags and values.
 *
 * Uses two passes: --root must be resolved first because the default cache path
 * is derived from it, and subsequent path arguments are resolved relative to it.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const help = argv.length === 0 || argv.includes("--help");

  let rootDir = process.cwd();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root" && i + 1 < argv.length) {
      const next = argv[i + 1];
      if (next) {
        rootDir = path.resolve(next);
        i++;
      }
    }
  }

  const defaultCacheDir = path.resolve(rootDir, "mokosh-cache");
  const defaultCachePath = path.join(defaultCacheDir, "graph.json");

  let cachePath: string | undefined;
  let configPath: string | undefined;
  let mermaidOutput = false;
  let proposeTagsFlag = false;
  let proposeTagsPlain = false;
  let affectedTestsFlag = false;
  let detectFeaturesFlag = false;
  let featureThreshold: number | undefined;
  let findUnusedFlag = false;
  let excludeTests = false;
  let checkCyclesFlag = false;
  let silent = false;
  let queryStr: string | undefined;
  const entryPoints: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cache") {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        cachePath = path.resolve(rootDir, next);
        i++;
      } else {
        cachePath = defaultCachePath;
      }
    } else if (arg === "--config" && i + 1 < argv.length) {
      const next = argv[i + 1];
      if (next) {
        configPath = path.resolve(rootDir, next);
        i++;
      }
    } else if (arg === "--root") {
      i++;
    } else if (arg === "--mermaid") {
      mermaidOutput = true;
    } else if (arg === "--propose-tags") {
      proposeTagsFlag = true;
    } else if (arg === "--plain") {
      proposeTagsPlain = true;
    } else if (arg === "--affected-tests") {
      affectedTestsFlag = true;
    } else if (arg === "--detect-features") {
      detectFeaturesFlag = true;
    } else if (arg === "--feature-threshold" && i + 1 < argv.length) {
      featureThreshold = parseInt(argv[i + 1] ?? "", 10);
      i++;
    } else if (arg === "--find-unused") {
      findUnusedFlag = true;
    } else if (arg === "--exclude-tests") {
      excludeTests = true;
    } else if (arg === "--check-cycles") {
      checkCyclesFlag = true;
    } else if (arg === "--silent") {
      silent = true;
    } else if (arg === "--query" && i + 1 < argv.length) {
      queryStr = argv[i + 1];
      i++;
    } else if (arg && !arg.startsWith("--")) {
      entryPoints.push(arg);
    }
  }

  if (!cachePath) {
    cachePath = defaultCachePath;
  }

  return {
    rootDir,
    cachePath,
    configPath,
    mermaidOutput,
    proposeTagsFlag,
    proposeTagsPlain,
    affectedTestsFlag,
    detectFeaturesFlag,
    featureThreshold,
    findUnusedFlag,
    excludeTests,
    checkCyclesFlag,
    silent,
    queryStr,
    entryPoints,
    help,
  };
}
