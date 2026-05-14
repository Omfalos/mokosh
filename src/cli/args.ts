import path from "node:path";

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
  silent: boolean;
  query: string | undefined;
  queryHelp: boolean;
  entryPoints: string[];
  help: boolean;
}

/**
 * Extracts and resolves the `--root` argument from raw argv, falling back to
 * the current working directory when the flag is absent.
 *
 * @param argv - Raw process arguments (everything after `node <script>`)
 * @returns Absolute path to use as the project root
 */
function resolveRootDir(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root" && argv[i + 1]) {
      return path.resolve(argv[i + 1]!);
    }
  }
  return process.cwd();
}

/**
 * Parses raw CLI arguments into a structured options object, with all paths
 * resolved to absolute values.
 *
 * `--root` is resolved in a first pass because the default cache path is
 * derived from it; every subsequent path argument is then resolved relative
 * to that root.
 *
 * @param argv - Raw process arguments (everything after `node <script>`)
 * @returns A fully populated {@link ParsedArgs} with boolean flags set and
 *   path arguments converted to absolute paths
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const rootDir = resolveRootDir(argv);
  const defaultCachePath = path.join(path.resolve(rootDir, "mokosh-cache"), "graph.json");

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
    silent: false,
    query: undefined,
    queryHelp: false,
    entryPoints: [],
    help: argv.length === 0 || argv.includes("--help"),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case "--root":
        i++;
        break;
      case "--cache":
        if (next && !next.startsWith("--")) {
          result.cachePath = path.resolve(rootDir, next);
          i++;
        }
        break;
      case "--config":
        if (next) {
          result.configPath = path.resolve(rootDir, next);
          i++;
        }
        break;
      case "--query":
        if (next) {
          result.query = next;
          i++;
        }
        break;
      case "--feature-threshold":
        if (next) {
          result.featureThreshold = parseInt(next, 10);
          i++;
        }
        break;
      case "--mermaid":
        result.mermaid = true;
        break;
      case "--propose-tags":
        result.proposeTags = true;
        break;
      case "--plain":
        result.plain = true;
        break;
      case "--affected-tests":
        result.affectedTests = true;
        break;
      case "--detect-features":
        result.detectFeatures = true;
        break;
      case "--find-unused":
        result.findUnused = true;
        break;
      case "--exclude-tests":
        result.excludeTests = true;
        break;
      case "--check-cycles":
        result.checkCycles = true;
        break;
      case "--silent":
        result.silent = true;
        break;
      case "--query-help":
        result.queryHelp = true;
        break;
      default:
        if (arg && !arg.startsWith("--")) {
          result.entryPoints.push(arg);
        }
    }
  }

  return result;
}
