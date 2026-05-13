import fs from "node:fs";
import path from "node:path";
import { getGitFileStats } from "../git.js";
import { type LockFileData, loadLockFile } from "../parser/lockfile.js";
import { getFileType, parseFile } from "../parser.js";
import type { DependencyGraph, FileNode, ImportEdge } from "../types.js";
import { enrichLibraryTags, enrichTestedBy, enrichTestNodeTags } from "./enrichment.js";
import { Graph } from "./model.js";
import { DefaultResolver, type PathResolver } from "./resolver.js";

/**
 * @description Builds a dependency graph by recursively walking the file system from a set of entry points.
 *
 * Responsibilities:
 * - Parsing each reachable source file via {@link parseFile}
 * - Resolving raw import specifiers to actual file paths via a {@link PathResolver}
 * - Reusing unchanged nodes from a previous graph (incremental build)
 * - Annotating external imports with lock-file versions
 * - Applying post-build enrichment (test-node tags)
 *
 * **SRP note:** `resolveImports` intentionally doubles as the recursion trigger —
 * it calls `processFile` on each local dependency as it resolves it. This keeps the
 * traversal depth-first and avoids a separate queue, at the cost of two concerns
 * living in one method.
 *
 * **DIP note:** Only `PathResolver` is abstracted. `fs`, parsers, and enrichment
 * functions are concrete imports — sufficient for a build-time tool where the call
 * sites are stable and swapping them out has no real use case.
 */
export class GraphBuilder {
  private graph: DependencyGraph = { nodes: new Map() };
  private visited = new Set<string>();
  private readonly previousGraph: Graph | null = null;
  private readonly resolver: PathResolver;
  private lockFile: LockFileData | null = null;
  private progressCallback?: (count: number) => void;

  /**
   * @param rootDir - Absolute path to the project root; all node paths in the graph are relative to this.
   * @param previousGraph - Optional graph from a prior run. Nodes whose `mtime` and `size` match are reused as-is, making incremental builds significantly faster.
   * @param resolver - Strategy for turning raw import specifiers into absolute file paths. Defaults to {@link DefaultResolver}, which handles relative paths, tsconfig aliases, and node_modules.
   * @param progressCallback - Called every 100 files processed; useful for rendering a progress indicator in long-running CLI builds.
   * @param gitStats - When true, fetches `commitCount90d` and `lastAuthor` for each cache-missed file via git log.
   */
  constructor(
    private rootDir: string,
    previousGraph: Graph | null = null,
    resolver?: PathResolver,
    progressCallback?: (count: number) => void,
    private readonly enableGitStats = false,
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
   * Each entry point triggers a depth-first traversal: imports are resolved, unvisited
   * local files are parsed, and the process continues until the full reachable subgraph
   * is covered. Test-node tags are applied as a final post-processing step because they
   * depend on the fully connected graph (e.g. a file is "test" if something imports it
   * with a `.test.` path, which can only be known after all edges are resolved).
   * @param entryPoints - File paths to start from. Relative paths are resolved against `rootDir`.
   * @returns The completed, enriched dependency graph.
   */
  public async build(entryPoints: string[]): Promise<Graph> {
    for (const entry of entryPoints) {
      const entryPath = path.isAbsolute(entry) ? entry : path.resolve(this.rootDir, entry);
      await this.processFile(entryPath);
    }

    if (this.progressCallback && this.visited.size >= 100) {
      process.stderr.write(`\nDone. Total processed: ${this.visited.size} nodes.\n`);
    }

    enrichTestNodeTags(this.graph.nodes);
    enrichTestedBy(this.graph.nodes);
    return new Graph(this.graph.nodes);
  }

  /**
   * @description Parses a single file and registers it in the graph, then recurses into its imports.
   *
   * The `visited` guard prevents re-processing files encountered via multiple import paths
   * (diamond dependencies). It is set before any async work so concurrent calls on the same
   * path — if this ever runs with parallelism — cannot race.
   * @param filePath - Absolute path of the file to process.
   */
  private async processFile(filePath: string) {
    if (this.visited.has(filePath)) return;
    this.visited.add(filePath);

    this.showProgress();

    const stats = fs.statSync(filePath, { throwIfNoEntry: false });
    if (!stats?.isFile()) return;

    const relativePath = path.relative(this.rootDir, filePath);
    const node = await this.getNode(filePath, relativePath, stats);

    node.imports = await this.resolveImports(filePath, node.imports);

    this.graph.nodes.set(node.path, node);
  }

  /**
   * @description Returns the `FileNode` for a file, either from the incremental cache or by parsing it fresh.
   *
   * Cache hit condition: the previous graph has a node at the same relative path **and** both
   * `mtime` and `size` match the current file stats. Both checks are needed because some tools
   * (e.g. file watchers) can restore a previous version with the same mtime but different content.
   *
   * On parse failure the file is kept in the graph as a stub (`category: "other"`, empty
   * imports/exports) so that the surrounding graph remains usable and the failure is surfaced
   * as a warning rather than crashing the build.
   * @param filePath - Absolute path of the file.
   * @param relativePath - Path of the file relative to `rootDir`, used as the node key.
   * @param stats - File system stats, used for cache validation and stored on the node.
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

    const content = fs.readFileSync(filePath, "utf-8");
    let parsed: Awaited<ReturnType<typeof parseFile>>;
    try {
      parsed = await parseFile(filePath, content);
    } catch (err) {
      process.stderr.write(`\nWarning: failed to parse ${relativePath}: ${err}\n`);
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
    const { imports, exports, tags, category, description } = parsed;

    enrichLibraryTags(imports, tags);

    const node: FileNode = {
      path: relativePath,
      type: getFileType(filePath),
      category,
      imports,
      exports,
      tags,
      mtime: stats.mtimeMs,
      size: stats.size,
      ...(description !== undefined ? { description } : {}),
    };

    if (this.enableGitStats) {
      try {
        const git = getGitFileStats(this.rootDir, relativePath);
        node.commitCount90d = git.commitCount90d;
        if (git.lastAuthor !== undefined) node.lastAuthor = git.lastAuthor;
      } catch {
        // git not available or file not tracked — silent
      }
    }

    return node;
  }

  /**
   * @description Resolves each import's raw specifier to a concrete path and, for local imports,
   * triggers recursive processing of the target file.
   *
   * Combining resolution with recursion (rather than two separate passes) keeps the
   * traversal depth-first, which improves cache locality during parsing. The trade-off
   * is that this method now owns two concerns: path resolution and graph traversal.
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
      const resolved = this.resolver.resolve(filePath, imp.rawSpecifier);
      if (!resolved) continue;

      imp.toPath = resolved.isExternal ? resolved.path : path.relative(this.rootDir, resolved.path);
      imp.isExternal = resolved.isExternal;

      if (resolved.isExternal) {
        this.attachLockfileVersion(imp);
      } else {
        await this.processFile(resolved.path);
      }

      resolvedImports.push(imp);
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
