/** Parses command-line arguments into a structured ParsedArgs object. */
import path from "node:path";
import { DEFAULT_CACHE_DIR, DEFAULT_CACHE_FILE, Flag } from "./const";

export interface ParsedArgs {
  rootDir: string;
  cachePath: string;
  configPath: string | undefined;
  mermaid: boolean;
  proposeTags: boolean;
  plain: boolean;
  affectedTests: boolean;
  detectFeatures: boolean;
  featureThreshold: number | undefined;
  findUnused: boolean;
  excludeTests: boolean;
  checkCycles: boolean;
  findUncovered: boolean;
  callers: boolean;
  file: string | undefined;
  silent: boolean;
  query: string | undefined;
  queryHelp: boolean;
  entryPoints: string[];
  help: boolean;
  typeGraph: boolean;
  typeFilter: string | undefined;
  moduleResponsibility: boolean;
  filterPaths: string[] | undefined;
  minOutDegree: number | undefined;
  featureGraph: boolean;
  callGraph: boolean;
  functionName: string | undefined;
  apiSurface: boolean;
}

/**
 * @description Extracts and resolves the `--root` argument from raw argv, falling back to
 *   the current working directory when the flag is absent.
 * @param {string[]} argv - Raw process arguments (everything after `node <script>`).
 * @returns {string} Absolute path to use as the project root.
 */
function resolveRootDir(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === Flag.Root && argv[i + 1]) {
      return path.resolve(argv[i + 1] as string);
    }
  }
  return process.cwd();
}

/**
 * @description Parses raw CLI arguments into a structured options object with all paths
 *   resolved to absolute values. `--root` is resolved first because the default cache path
 *   derives from it; every subsequent path argument is resolved relative to that root.
 * @param {string[]} argv - Raw process arguments (everything after `node <script>`).
 * @returns {ParsedArgs} A fully populated `ParsedArgs` with boolean flags set and path arguments as absolute paths.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const rootDir = resolveRootDir(argv);
  const defaultCachePath = path.join(path.resolve(rootDir, DEFAULT_CACHE_DIR), DEFAULT_CACHE_FILE);

  const result: ParsedArgs = {
    rootDir,
    cachePath: defaultCachePath,
    configPath: undefined,
    mermaid: false,
    proposeTags: false,
    plain: false,
    affectedTests: false,
    detectFeatures: false,
    featureThreshold: undefined,
    findUnused: false,
    excludeTests: false,
    checkCycles: false,
    findUncovered: false,
    callers: false,
    file: undefined,
    silent: false,
    query: undefined,
    queryHelp: false,
    entryPoints: [],
    help: argv.length === 0 || argv.includes(Flag.Help),
    typeGraph: false,
    typeFilter: undefined,
    moduleResponsibility: false,
    filterPaths: undefined,
    minOutDegree: undefined,
    featureGraph: false,
    callGraph: false,
    functionName: undefined,
    apiSurface: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case Flag.Root:
        i++;
        break;
      case Flag.Cache:
        if (next && !next.startsWith("--")) {
          result.cachePath = path.resolve(rootDir, next);
          i++;
        }
        break;
      case Flag.Config:
        if (next) {
          result.configPath = path.resolve(rootDir, next);
          i++;
        }
        break;
      case Flag.Query:
        if (next) {
          result.query = next;
          i++;
        }
        break;
      case Flag.FeatureThreshold:
        if (next) {
          result.featureThreshold = parseInt(next, 10);
          i++;
        }
        break;
      case Flag.Mermaid:
        result.mermaid = true;
        break;
      case Flag.ProposeTags:
        result.proposeTags = true;
        break;
      case Flag.Plain:
        result.plain = true;
        break;
      case Flag.AffectedTests:
        result.affectedTests = true;
        break;
      case Flag.DetectFeatures:
        result.detectFeatures = true;
        break;
      case Flag.FindUnused:
        result.findUnused = true;
        break;
      case Flag.ExcludeTests:
        result.excludeTests = true;
        break;
      case Flag.CheckCycles:
        result.checkCycles = true;
        break;
      case Flag.FindUncovered:
        result.findUncovered = true;
        break;
      case Flag.Callers:
        result.callers = true;
        break;
      case Flag.File:
        if (next) {
          result.file = next;
          i++;
        }
        break;
      case Flag.Silent:
        result.silent = true;
        break;
      case Flag.QueryHelp:
        result.queryHelp = true;
        break;
      case Flag.TypeGraph:
        result.typeGraph = true;
        break;
      case Flag.TypeFilter:
        if (next) {
          result.typeFilter = next;
          i++;
        }
        break;
      case Flag.ModuleResponsibility:
        result.moduleResponsibility = true;
        break;
      case Flag.FilterPaths:
        if (next) {
          result.filterPaths = next.split(",").map((p) => p.trim());
          i++;
        }
        break;
      case Flag.MinOutDegree:
        if (next) {
          result.minOutDegree = parseInt(next, 10);
          i++;
        }
        break;
      case Flag.FeatureGraph:
        result.featureGraph = true;
        break;
      case Flag.CallGraph:
        result.callGraph = true;
        break;
      case Flag.FunctionName:
        if (next) {
          result.functionName = next;
          i++;
        }
        break;
      case Flag.ApiSurface:
        result.apiSurface = true;
        break;
      default:
        if (arg && !arg.startsWith("--")) {
          result.entryPoints.push(arg);
        }
    }
  }

  return result;
}
