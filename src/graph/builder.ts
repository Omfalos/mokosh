import fs from "node:fs";
import path from "node:path";
import { type LockFileData, loadLockFile } from "../parser/lockfile.js";
import { getFileType, parseFile } from "../parser.js";
import type { DependencyGraph, FileNode, ImportEdge } from "../types.js";
import { enrichLibraryTags, enrichTestNodeTags } from "./enrichment.js";
import { Graph } from "./model.js";
import { DefaultResolver, type PathResolver } from "./resolver.js";

export class GraphBuilder {
  private graph: DependencyGraph = { nodes: new Map() };
  private visited = new Set<string>();
  private previousGraph: Graph | null = null;
  private resolver: PathResolver;
  private lockFile: LockFileData | null = null;
  private progressCallback?: (count: number) => void;

  constructor(
    private rootDir: string,
    previousGraph: Graph | null = null,
    resolver?: PathResolver,
    progressCallback?: (count: number) => void,
  ) {
    this.previousGraph = previousGraph;
    this.resolver = resolver || new DefaultResolver(rootDir);
    this.lockFile = loadLockFile(rootDir);
    if (progressCallback) {
      this.progressCallback = progressCallback;
    }
  }

  public async build(entryPoints: string[]): Promise<Graph> {
    for (const entry of entryPoints) {
      const entryPath = path.isAbsolute(entry) ? entry : path.resolve(this.rootDir, entry);
      await this.processFile(entryPath);
    }

    if (this.progressCallback && this.visited.size >= 100) {
      process.stderr.write(`\nDone. Total processed: ${this.visited.size} nodes.\n`);
    }

    enrichTestNodeTags(this.graph.nodes);
    return new Graph(this.graph.nodes);
  }

  private async processFile(filePath: string) {
    if (this.visited.has(filePath)) return;
    this.visited.add(filePath);

    this.showProgress();

    const stats = fs.statSync(filePath, { throwIfNoEntry: false });
    if (!stats?.isFile()) return;

    const relativePath = path.relative(this.rootDir, filePath);
    const node = await this.getNode(filePath, relativePath, stats);

    // Resolve and process imports to build the graph structure
    node.imports = await this.resolveImports(filePath, node.imports);

    this.graph.nodes.set(node.path, node);
  }

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
    const { imports, exports, tags, category } = parsed;

    enrichLibraryTags(imports, tags);

    return {
      path: relativePath,
      type: getFileType(filePath),
      category,
      imports,
      exports,
      tags,
      mtime: stats.mtimeMs,
      size: stats.size,
    };
  }

  private async resolveImports(filePath: string, imports: ImportEdge[]): Promise<ImportEdge[]> {
    const resolvedImports: ImportEdge[] = [];

    for (const imp of imports) {
      const resolved = this.resolver.resolve(filePath, imp.rawSpecifier);
      if (resolved) {
        imp.toPath = resolved.isExternal
          ? resolved.path
          : path.relative(this.rootDir, resolved.path);
        imp.isExternal = resolved.isExternal;

        // If it's external, try to get version from lockfile
        if (resolved.isExternal && this.lockFile) {
          const libName = imp.rawSpecifier.startsWith("@")
            ? imp.rawSpecifier.split("/").slice(0, 2).join("/")
            : (imp.rawSpecifier.split("/")[0] as string);
          const dep = libName ? this.lockFile.dependencies[libName] : undefined;
          if (dep) {
            imp.version = dep.version;
          }
        }

        resolvedImports.push(imp);

        if (!resolved.isExternal) {
          await this.processFile(resolved.path);
        }
      }
    }

    return resolvedImports;
  }

  private showProgress() {
    if (this.progressCallback && this.visited.size % 100 === 0) {
      this.progressCallback(this.visited.size);
    }
  }
}
