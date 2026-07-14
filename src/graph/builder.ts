/** GraphBuilder walks the file system from entry points, parses each reachable file, and assembles the dependency graph. */
import fs from "node:fs";
import path from "node:path";
import Piscina from "piscina";
import { getGitFileStats } from "../git.js";
import { getTestPatterns } from "../parser/classify.js";
import { type LockFileData, loadLockFile } from "../parser/lockfile.js";
import { getFileType, parseFile } from "../parser.js";
import type { DependencyGraph } from "../types/graph";
import type { CallEdge, FileNode, ImportEdge } from "../types/node";
import {
  enrichCoverage,
  enrichDocDrift,
  enrichExportUsage,
  enrichLibraryTags,
  enrichTestedBy,
  enrichTestNodeTags,
} from "./enrichment.js";
import { Graph } from "./model.js";
import { DefaultResolver, type PathResolver } from "./resolver.js";

/** Conventional top-level test-directory names probed as siblings between the entry-derived scan root and `rootDir`. */
const CONVENTIONAL_TEST_DIR_NAMES = ["tests", "test", "__tests__", "specs", "spec"];

/** Directory names skipped by `walkProject`'s discovery passes (test files, docs), independent of `DEFAULT_IGNORE_DIRS` scanning. */
const WALK_IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".cache",
  "mokosh-cache",
  "coverage",
]);

/** Below this many files, the worker-pool spin-up cost outweighs the parallelism benefit — parse in-process instead. */
const DEFAULT_MIN_FILES_FOR_POOL = 20;

/** Configures whether/how `parseFile` calls are offloaded to a `piscina` worker pool. `false` always parses in-process. */
export type ParallelParsingOption = boolean | { minFiles?: number; maxThreads?: number };

/**
 * @description Finds the deepest directory that contains every path in `absPaths`, clamped
 *   so the result is never outside `rootDir`. Used to scope the test-file discovery walk to
 *   the subtree actually reachable from the given entry points, instead of always walking the
 *   full project root (which, for a nested sub-project under a much larger `rootDir`, would
 *   sweep in unrelated files).
 * @param absPaths - Absolute file paths (typically resolved entry points).
 * @param rootDir - Absolute project root; acts as an upper bound for the result.
 * @returns The common ancestor directory, or `rootDir` if `absPaths` is empty or resolves outside it.
 */
function commonAncestorDir(absPaths: string[], rootDir: string): string {
  if (absPaths.length === 0) return rootDir;

  const segmentLists = absPaths.map((p) => path.dirname(p).split(path.sep));
  let common = segmentLists[0]!;
  for (const segments of segmentLists.slice(1)) {
    let i = 0;
    while (i < common.length && i < segments.length && common[i] === segments[i]) i++;
    common = common.slice(0, i);
  }
  const candidate = common.join(path.sep) || path.sep;

  const rel = path.relative(rootDir, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return rootDir;
  return candidate;
}

/**
 * @description Builds a dependency graph by walking the file system from a set of entry points.
 *
 * Responsibilities:
 * - Parsing each reachable source file via {@link parseFile} (optionally offloaded to a worker pool)
 * - Resolving raw import specifiers to actual file paths via a {@link PathResolver}
 * - Reusing unchanged nodes from a previous graph (incremental build)
 * - Annotating external imports with lock-file versions
 * - Applying post-build enrichment (test-node tags)
 *
 * **Traversal shape:** a file's imports are only known once it's been parsed, so discovery is
 * inherently incremental. Rather than a strict recursive depth-first walk, `build` runs a
 * queue-pumped wavefront: each round parses/resolves every currently-queued file in parallel
 * (`Promise.all`), and files discovered during that round join the next round's queue. This
 * lets `getNode` dispatch parses to a worker pool concurrently instead of one at a time. Nothing
 * downstream depends on discovery order, only on the `visited` set being consulted synchronously
 * before a file is queued (see {@link GraphBuilder.discover}), which keeps dedup race-free even
 * though many files are mid-parse at once.
 *
 * **DIP note:** Only `PathResolver` is abstracted. `fs`, parsers, and enrichment
 * functions are concrete imports — sufficient for a build-time tool where the call
 * sites are stable and swapping them out has no real use case.
 */
export class GraphBuilder {
  private graph: DependencyGraph = { nodes: new Map() };
  private visited = new Set<string>();
  private queue: string[] = [];
  private readonly previousGraph: Graph | null = null;
  private readonly resolver: PathResolver;
  private lockFile: LockFileData | null = null;
  private progressCallback?: (count: number) => void;
  private pool: Piscina | null = null;

  /**
   * @param rootDir - Absolute path to the project root; all node paths in the graph are relative to this.
   * @param previousGraph - Optional graph from a prior run. Nodes whose `mtime` and `size` match are reused as-is, making incremental builds significantly faster.
   * @param resolver - Strategy for turning raw import specifiers into absolute file paths. Defaults to {@link DefaultResolver}, which handles relative paths, tsconfig aliases, and node_modules.
   * @param progressCallback - Called every 100 files processed; useful for rendering a progress indicator in long-running CLI builds.
   * @param gitStats - When true, fetches `commitCount90d` and `lastAuthor` for each cache-missed file via git log.
   * @param coverageMap - Pre-loaded coverage map (relative path → line %). When non-empty, populates `coveragePct` on each node after the graph is built.
   * @param parallelParsing - Controls worker-pool offloading of `parseFile`. `true`/omitted enables it once a cheap pre-scan finds at least `minFiles` (default 20) files under `rootDir`; `false` always parses in-process; an object overrides `minFiles`/`maxThreads`.
   */
  constructor(
    private rootDir: string,
    previousGraph: Graph | null = null,
    resolver?: PathResolver,
    progressCallback?: (count: number) => void,
    private readonly enableGitStats = false,
    private readonly coverageMap: Map<string, number> = new Map(),
    private readonly parallelParsing: ParallelParsingOption = true,
  ) {
    this.previousGraph = previousGraph;
    this.resolver = resolver || new DefaultResolver(rootDir);
    this.lockFile = loadLockFile(rootDir);
    if (progressCallback) {
      this.progressCallback = progressCallback;
    }
  }

  /**
   * @description Starts the graph build from the given entry points and returns the completed graph.
   *
   * Each entry point seeds the queue; imports are resolved and unvisited local files join the
   * next wavefront round, continuing until the full reachable subgraph is covered. Test-node
   * tags are applied as a final post-processing step because they depend on the fully connected
   * graph (e.g. a file is "test" if something imports it with a `.test.` path, which can only be
   * known after all edges are resolved).
   * @param entryPoints - File paths to start from. Relative paths are resolved against `rootDir`.
   * @returns The completed, enriched dependency graph.
   */
  public async build(entryPoints: string[]): Promise<Graph> {
    const entryPaths = entryPoints.map((entry) =>
      path.isAbsolute(entry) ? entry : path.resolve(this.rootDir, entry),
    );

    await this.initPool();
    try {
      for (const entryPath of entryPaths) this.enqueue(entryPath);
      await this.drain();

      // Test files are never reachable from library entry points (imports flow source→test,
      // not the other way around). Scan for them explicitly so enrichTestedBy has data.
      // Scoped to the entry points' common ancestor (plus conventional sibling test dirs) rather
      // than the full rootDir, so a nested sub-project scanned from a much larger rootDir doesn't
      // pull in unrelated files elsewhere in the tree.
      await this.processTestFiles(commonAncestorDir(entryPaths, this.rootDir));

      // Docs are never reachable from library entry points either (code doesn't import markdown),
      // and they commonly live outside the entry points' subtree entirely (top-level README, docs/),
      // so this scans the full rootDir rather than reusing the test-files' common-ancestor scope.
      await this.processDocFiles();

      if (this.progressCallback && this.visited.size >= 100) {
        process.stderr.write(`\nDone. Total processed: ${this.visited.size} nodes.\n`);
      }

      enrichTestNodeTags(this.graph.nodes);
      enrichTestedBy(this.graph.nodes);
      enrichExportUsage(this.graph.nodes);
      enrichDocDrift(this.graph.nodes);
      if (this.coverageMap.size > 0) enrichCoverage(this.graph.nodes, this.coverageMap);
      return new Graph(this.graph.nodes);
    } finally {
      if (this.pool) {
        await this.pool.destroy();
        this.pool = null;
      }
    }
  }

  /**
   * @description Decides whether to spin up a worker pool for this build and constructs it if
   *   so. Skipped entirely when `parallelParsing` is `false`, or when a cheap pre-scan of
   *   `rootDir` (capped at `minFiles`, so it never walks more than necessary) finds fewer than
   *   `minFiles` files — small builds (the common unit-test case) never pay pool spin-up cost.
   *   If pool construction itself throws (e.g. a sandboxed environment without `worker_threads`
   *   permission), falls back to in-process parsing for the whole build instead of failing it.
   */
  private async initPool(): Promise<void> {
    if (this.parallelParsing === false) return;

    const opts = typeof this.parallelParsing === "object" ? this.parallelParsing : {};
    const minFiles = opts.minFiles ?? DEFAULT_MIN_FILES_FOR_POOL;
    if (minFiles > 0 && !this.hasAtLeastFiles(this.rootDir, minFiles)) return;

    try {
      const workerFilename = path.join(__dirname, "parse-worker.js");
      this.pool = new Piscina({
        filename: workerFilename,
        ...(opts.maxThreads !== undefined ? { maxThreads: opts.maxThreads } : {}),
      });
    } catch (err) {
      process.stderr.write(
        `\nWarning: failed to start parse worker pool, falling back to synchronous parsing: ${err}\n`,
      );
      this.pool = null;
    }
  }

  /**
   * @description Cheaply checks whether `dir` contains at least `threshold` files, stopping the
   *   walk as soon as the threshold is met rather than counting exhaustively.
   * @param dir - Directory to scan (recursively, skipping `WALK_IGNORE_DIRS`).
   * @param threshold - Minimum file count to confirm.
   * @returns Whether at least `threshold` files were found.
   */
  private hasAtLeastFiles(dir: string, threshold: number): boolean {
    let count = 0;
    const stack = [dir];
    while (stack.length > 0) {
      const current = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!WALK_IGNORE_DIRS.has(entry.name)) stack.push(path.join(current, entry.name));
        } else if (entry.isFile()) {
          count++;
          if (count >= threshold) return true;
        }
      }
    }
    return count >= threshold;
  }

  /**
   * @description Scans the file system for test files and processes them into the graph.
   *   Test files are never reachable from library entry points, so they must be discovered
   *   separately; without this pass `enrichTestedBy` would have no data to work with.
   * @param scanRoot - Directory to walk for test files; the entry points' common ancestor,
   *   clamped to `rootDir`. Conventional sibling test directories (`tests/`, `__tests__/`, …)
   *   found between `scanRoot` and `rootDir` are also walked, so a top-level test directory
   *   alongside a `src/` entry point is still discovered even though it falls outside `scanRoot`.
   */
  private async processTestFiles(scanRoot: string): Promise<void> {
    const patterns = getTestPatterns();
    const matchesTest = (entry: fs.Dirent) =>
      patterns.some((pattern) => entry.name.includes(pattern));

    this.walkProject(scanRoot, matchesTest);

    let dir = scanRoot;
    while (dir !== this.rootDir) {
      const parent = path.dirname(dir);
      if (parent === dir) break;
      for (const name of CONVENTIONAL_TEST_DIR_NAMES) {
        const candidate = path.join(parent, name);
        try {
          if (fs.statSync(candidate).isDirectory()) this.walkProject(candidate, matchesTest);
        } catch {
          // not present
        }
      }
      dir = parent;
    }

    await this.drain();
  }

  /**
   * @description Scans the full project root for `.md`/`.mdx` files and processes them into the
   *   graph. Docs are never reachable from library entry points (code doesn't import markdown) and,
   *   unlike test files, aren't confined to the entry points' subtree — a top-level `README.md` or
   *   `docs/` directory is common — so this walks `rootDir` directly rather than reusing
   *   `processTestFiles`'s narrower common-ancestor scope.
   */
  private async processDocFiles(): Promise<void> {
    this.walkProject(
      this.rootDir,
      (entry) => entry.name.endsWith(".md") || entry.name.endsWith(".mdx"),
    );
    await this.drain();
  }

  /**
   * @description Recursively walks a directory, enqueueing every file that satisfies `matches`
   *   for processing. Shared by `processTestFiles` and `processDocFiles`, whose discovery passes
   *   only differ in which files they're looking for and where they start. Purely synchronous
   *   directory traversal — the actual parse/resolve work happens later, in `drain`.
   * @param scanRoot - Directory to walk.
   * @param matches - Predicate tested against each file entry; matching files are enqueued.
   */
  private walkProject(scanRoot: string, matches: (entry: fs.Dirent) => boolean): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(scanRoot, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(scanRoot, entry.name);
      if (entry.isDirectory()) {
        if (!WALK_IGNORE_DIRS.has(entry.name)) this.walkProject(fullPath, matches);
      } else if (entry.isFile() && matches(entry)) {
        this.enqueue(fullPath);
      }
    }
  }

  /**
   * @description Marks `filePath` as visited and, if it wasn't already, queues it for
   *   processing in the next `drain` round.
   *
   * The `visited` guard prevents re-processing files encountered via multiple import paths
   * (diamond dependencies). It is checked-and-set synchronously, with no `await` in between,
   * so concurrent callers mid-parse in the same `drain` round cannot race each other onto the
   * same file.
   * @param filePath - Absolute path of the file to enqueue.
   */
  private enqueue(filePath: string): void {
    if (this.visited.has(filePath)) return;
    this.visited.add(filePath);
    this.showProgress();
    this.queue.push(filePath);
  }

  /**
   * @description Drains the queue in wavefront rounds: every file currently queued is parsed
   *   and resolved in parallel via `Promise.all`, and any new files discovered during that round
   *   (via `resolveImports` → `enqueue`) form the next round's queue. Repeats until empty.
   */
  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const batch = this.queue;
      this.queue = [];
      await Promise.all(batch.map((filePath) => this.finishFile(filePath)));
    }
  }

  /**
   * @description Parses a single queued file and registers it in the graph, then enqueues its
   *   local imports for the next wavefront round.
   * @param filePath - Absolute path of the file to process.
   */
  private async finishFile(filePath: string): Promise<void> {
    const stats = fs.statSync(filePath, { throwIfNoEntry: false });
    if (!stats?.isFile()) return;

    const relativePath = path.relative(this.rootDir, filePath);
    const node = await this.getNode(filePath, relativePath, stats);

    node.imports = await this.resolveImports(filePath, node.imports);
    enrichLibraryTags(node.imports, node.tags);

    this.graph.nodes.set(node.path, node);
  }

  /**
   * @description Returns the `FileNode` for a file, either from the incremental cache or by
   *   parsing it fresh. Cache hit requires both `mtime` and `size` to match — size guards
   *   against tools that restore a previous file version with an identical timestamp.
   * @param filePath - Absolute path of the file.
   * @param relativePath - Path relative to `rootDir`, used as the node key.
   * @param stats - File system stats for cache validation and node metadata.
   * @returns The parsed or cached `FileNode`.
   */
  private async getNode(
    filePath: string,
    relativePath: string,
    stats: fs.Stats,
  ): Promise<FileNode> {
    const cachedNode = this.previousGraph?.nodes.get(relativePath);
    if (cachedNode && cachedNode.mtime === stats.mtimeMs && cachedNode.size === stats.size) {
      return { ...cachedNode };
    }

    const parsed = await this.tryParse(filePath, relativePath);
    if (!parsed) return this.makeStubNode(filePath, relativePath, stats);

    const callEdges = this.resolveCallEdges(filePath, parsed.rawCallEdges);
    const node = this.buildNode(filePath, relativePath, stats, parsed, callEdges);
    this.attachGitStats(node, relativePath);
    return node;
  }

  /**
   * @description Reads and parses a file, returning `null` on failure and emitting a warning
   *   to stderr so the surrounding graph build can continue with a stub.
   * @param filePath - Absolute path of the file to parse.
   * @param relativePath - Relative path used only in the warning message.
   * @returns The parse result, or `null` if parsing threw.
   */
  private async tryParse(
    filePath: string,
    relativePath: string,
  ): Promise<Awaited<ReturnType<typeof parseFile>> | null> {
    const content = fs.readFileSync(filePath, "utf-8");
    try {
      return await this.parseContent(filePath, content);
    } catch (err) {
      process.stderr.write(`\nWarning: failed to parse ${relativePath}: ${err}\n`);
      return null;
    }
  }

  /**
   * @description Parses file content, dispatching to the worker pool when one is running for
   *   this build, or parsing in-process otherwise. A worker's thrown error surfaces as a normal
   *   rejected promise, so callers need no special handling for the pooled vs. in-process case.
   * @param filePath - Absolute path of the file, used to select the language parser.
   * @param content - Raw source content of the file.
   */
  private parseContent(filePath: string, content: string): ReturnType<typeof parseFile> {
    if (this.pool) {
      return this.pool.run({ filePath, content });
    }
    return parseFile(filePath, content);
  }

  /**
   * @description Builds a minimal stub `FileNode` for a file that could not be parsed,
   *   keeping the graph structurally intact while surfacing the failure via category `"other"`.
   * @param filePath - Absolute path, used to determine the file type.
   * @param relativePath - Used as the node's path key.
   * @param stats - Provides `mtime` and `size` for future cache comparisons.
   * @returns A `FileNode` with empty imports, exports, and tags.
   */
  private makeStubNode(filePath: string, relativePath: string, stats: fs.Stats): FileNode {
    return {
      path: relativePath,
      type: getFileType(filePath),
      category: "other",
      imports: [],
      exports: [],
      tags: [],
      mtime: stats.mtimeMs,
      size: stats.size,
    };
  }

  /**
   * @description Resolves raw call-edge specifiers to project-relative file paths,
   *   silently dropping any specifier the resolver cannot map.
   * @param filePath - Absolute path of the file that owns the call edges.
   * @param rawCallEdges - Unresolved call edges from the parser output.
   * @returns Resolved `CallEdge` array containing only internal (non-external) edges.
   */
  private resolveCallEdges(
    filePath: string,
    rawCallEdges: Awaited<ReturnType<typeof parseFile>>["rawCallEdges"],
  ): CallEdge[] {
    const callEdges: CallEdge[] = [];
    for (const rce of rawCallEdges ?? []) {
      try {
        const resolved = this.resolver.resolve(filePath, rce.toSpecifier);
        if (resolved && !resolved.isExternal) {
          callEdges.push({
            from: rce.from,
            to: rce.to,
            toFile: path.relative(this.rootDir, resolved.path),
          });
        }
      } catch {
        // unresolvable specifier — silent
      }
    }
    return callEdges;
  }

  /**
   * @description Assembles the final `FileNode` from parsed data and resolved call edges.
   * @param filePath - Absolute path, used to determine the file type.
   * @param relativePath - Used as the node's path key.
   * @param stats - Provides `mtime` and `size`.
   * @param parsed - Structured output from the parser.
   * @param callEdges - Already-resolved call edges to attach when non-empty.
   * @returns A fully populated `FileNode` ready to be inserted into the graph.
   */
  private buildNode(
    filePath: string,
    relativePath: string,
    stats: fs.Stats,
    parsed: Awaited<ReturnType<typeof parseFile>>,
    callEdges: CallEdge[],
  ): FileNode {
    const {
      imports,
      exports,
      tags,
      category,
      description,
      complexity,
      cognitiveComplexity,
      functions,
    } = parsed;
    return {
      path: relativePath,
      type: getFileType(filePath),
      category,
      imports,
      exports,
      tags,
      mtime: stats.mtimeMs,
      size: stats.size,
      ...(description !== undefined ? { description } : {}),
      ...(callEdges.length > 0 ? { callEdges } : {}),
      ...(complexity !== undefined ? { complexity } : {}),
      ...(cognitiveComplexity !== undefined ? { cognitiveComplexity } : {}),
      ...(functions !== undefined ? { functions } : {}),
    };
  }

  /**
   * @description Enriches a node with git activity metadata when `enableGitStats` is on,
   *   silently skipping files not tracked by git or when git is unavailable.
   * @param node - The node to mutate in place.
   * @param relativePath - Project-relative path passed to the git helper.
   */
  private attachGitStats(node: FileNode, relativePath: string): void {
    if (!this.enableGitStats) return;
    try {
      const git = getGitFileStats(this.rootDir, relativePath);
      node.commitCount90d = git.commitCount90d;
      if (git.lastAuthor !== undefined) node.lastAuthor = git.lastAuthor;
      if (git.lastCommitAt !== undefined) node.lastCommitAt = git.lastCommitAt;
    } catch {
      // git not available or file not tracked — silent
    }
  }

  /**
   * @description Resolves each import's raw specifier to a concrete path and, for local imports,
   * enqueues the target file for the next wavefront round.
   *
   * For external imports (node_modules), the package name is extracted from the specifier
   * and matched against the lock file to attach a resolved version string. Scoped packages
   * (`@scope/pkg/deep`) are normalised to the two-segment package name before lookup.
   *
   * Imports that the resolver cannot map to any path are silently dropped — this covers
   * dynamic specifiers, virtual modules, and unsupported module systems.
   * @param filePath - Absolute path of the file that owns these imports.
   * @param imports - Raw import edges as produced by the parser, with unresolved `toPath` values.
   * @returns The same edges with `toPath`, `isExternal`, and optionally `version` filled in.
   */
  private async resolveImports(filePath: string, imports: ImportEdge[]): Promise<ImportEdge[]> {
    const resolvedImports: ImportEdge[] = [];

    for (const imp of imports) {
      const results = this.resolver.resolveAll(filePath, imp.rawSpecifier);
      if (results.length === 0) continue;

      for (const resolved of results) {
        const edge: ImportEdge = {
          ...imp,
          toPath: resolved.isExternal ? resolved.path : path.relative(this.rootDir, resolved.path),
          isExternal: resolved.isExternal,
        };

        if (resolved.isWorkspace) {
          edge.isWorkspace = true;
          edge.workspacePackage = resolved.workspacePackage;
        }

        if (resolved.isExternal) {
          this.attachLockfileVersion(edge);
        } else {
          this.enqueue(resolved.path);
        }

        resolvedImports.push(edge);
      }
    }

    return resolvedImports;
  }

  /**
   * @description Looks up the package version from the lock file and attaches it to the import edge.
   * Scoped packages (`@scope/pkg/deep/path`) are normalised to their two-segment name before lookup.
   * @param imp - The external import edge to annotate; mutated in place.
   */
  private attachLockfileVersion(imp: ImportEdge): void {
    if (!this.lockFile) return;
    const libName = imp.rawSpecifier.startsWith("@")
      ? imp.rawSpecifier.split("/").slice(0, 2).join("/")
      : (imp.rawSpecifier.split("/")[0] as string);
    const dep = libName ? this.lockFile.dependencies[libName] : undefined;
    if (dep) imp.version = dep.version;
  }

  /**
   * @description Fires the progress callback every 100 files to avoid flooding the caller with updates.
   */
  private showProgress() {
    if (this.progressCallback && this.visited.size % 100 === 0) {
      this.progressCallback(this.visited.size);
    }
  }
}
