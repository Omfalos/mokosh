/** Detects entry-point files and builds an API surface describing all public exports reachable from them. */
import fs from "node:fs";
import path from "node:path";
import type { ExportedSymbol, FileNode } from "../types/node";
import type { FileType } from "../types/parse";
import type { Graph } from "./model";

/**
 * Coarse kind of a public export derived from its type signature prefix.
 * Used to distinguish runtime values from type-only exports without parsing the full signature.
 */
export type ExportKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "const"
  | "namespace"
  | "unknown";

/** A single named export surfaced by an entry point, resolved to its original defining file. */
export interface PublicExport {
  /** Exported symbol name. */
  name: string;
  /** Project-relative path of the file that originally defines this symbol. */
  definedIn: string;
  /** Coarse kind derived from the signature prefix. */
  kind: ExportKind;
  /** JSDoc summary when present on the defining export. */
  doc?: string;
  /** Type signature string when present (e.g. `"interface FileNode"`, `"class Graph"`). */
  signature?: string;
}

/** The complete API surface report for one or more entry points. */
export interface ApiSurface {
  /** Project-relative paths used as public entry points for this report. */
  entryPoints: string[];
  /** All symbols accessible from any entry point via direct declaration or `export *` chains. */
  publicExports: PublicExport[];
  /**
   * All non-test files transitively reachable from any entry point (excluding the entry points
   * themselves). These form the implementation surface backing the public API.
   */
  internalFiles: string[];
  /**
   * Non-test files NOT reachable from any entry point — separate consumers (CLI, MCP server),
   * config, or truly unused files. Not automatically dead code.
   */
  unreachableFromEntry: string[];
  /**
   * Test files in the graph that are not reachable from any entry point.
   * Shown separately so they don't inflate the `unreachableFromEntry` signal.
   */
  testFiles: string[];
}

/**
 * A compact, token-bounded projection of an {@link ApiSurface}, suitable as the default
 * response of a "what's the public API?" query. Every unbounded list in `ApiSurface` is
 * replaced by a count; `publicExports` is reduced to a capped `{ name, kind }` sample plus a
 * `byKind` histogram over the full set. `unreachableFromEntry` — the one directly actionable
 * signal (missed entry points / dead code) — keeps its list, capped.
 */
export interface ApiSurfaceSummary {
  /** Entry points, capped (see `entryPointsTruncated`). */
  entryPoints: string[];
  /** True number of entry points. */
  entryPointCount: number;
  /** Present and `true` when `entryPoints` was truncated. */
  entryPointsTruncated?: true;
  /** True number of accessible public exports. */
  publicExportCount: number;
  /** Capped `{ name, kind }` sample of the public exports, alphabetical. */
  publicExports: Array<{ name: string; kind: ExportKind }>;
  /** Present and `true` when `publicExports` was truncated. */
  publicExportsTruncated?: true;
  /** Count of public exports per {@link ExportKind}, over the full (un-capped) set. */
  byKind: Partial<Record<ExportKind, number>>;
  /** Number of non-test implementation files reachable from an entry point. */
  internalFileCount: number;
  /** Number of non-test files not reachable from any entry point. */
  unreachableFromEntryCount: number;
  /** The unreachable non-test files, capped (see `unreachableFromEntryTruncated`). */
  unreachableFromEntry: string[];
  /** Present and `true` when `unreachableFromEntry` was truncated. */
  unreachableFromEntryTruncated?: true;
  /** Number of unreachable test files. */
  testFileCount: number;
  /** How to obtain the full lists this summary omits. */
  hint: string;
}

/** Entry-point echo cap, matched to the MCP handler's own limit. */
const MAX_ENTRY_POINTS_IN_SUMMARY = 25;
const DEFAULT_MAX_EXPORTS_IN_SUMMARY = 30;
const DEFAULT_MAX_UNREACHABLE_IN_SUMMARY = 50;

/**
 * Reduces a full {@link ApiSurface} to a token-bounded {@link ApiSurfaceSummary}.
 *
 * @param {ApiSurface} surface - The full surface report from {@link buildApiSurface}.
 * @param {{ maxExports?: number; maxUnreachable?: number }} [opts] - `maxExports` caps the
 *   `publicExports` sample (default 30; pass `Infinity` to keep all names); `maxUnreachable`
 *   caps the `unreachableFromEntry` list (default 50).
 * @returns {ApiSurfaceSummary} The compact projection.
 */
export function summarizeApiSurface(
  surface: ApiSurface,
  opts: { maxExports?: number; maxUnreachable?: number } = {},
): ApiSurfaceSummary {
  const maxExports = opts.maxExports ?? DEFAULT_MAX_EXPORTS_IN_SUMMARY;
  const maxUnreachable = opts.maxUnreachable ?? DEFAULT_MAX_UNREACHABLE_IN_SUMMARY;

  const byKind: Partial<Record<ExportKind, number>> = {};
  for (const exp of surface.publicExports) byKind[exp.kind] = (byKind[exp.kind] ?? 0) + 1;

  const exportSample = surface.publicExports
    .slice(0, maxExports)
    .map((exp) => ({ name: exp.name, kind: exp.kind }));
  const unreachableSample = surface.unreachableFromEntry.slice(0, maxUnreachable);

  const summary: ApiSurfaceSummary = {
    entryPoints: surface.entryPoints.slice(0, MAX_ENTRY_POINTS_IN_SUMMARY),
    entryPointCount: surface.entryPoints.length,
    publicExportCount: surface.publicExports.length,
    publicExports: exportSample,
    byKind,
    internalFileCount: surface.internalFiles.length,
    unreachableFromEntryCount: surface.unreachableFromEntry.length,
    unreachableFromEntry: unreachableSample,
    testFileCount: surface.testFiles.length,
    hint: `Pass view:"exports" for all ${surface.publicExports.length} exports with docs, signatures and definedIn; view:"full" for that plus the internalFiles / testFiles path lists.`,
  };
  if (surface.entryPoints.length > summary.entryPoints.length) summary.entryPointsTruncated = true;
  if (exportSample.length < surface.publicExports.length) summary.publicExportsTruncated = true;
  if (unreachableSample.length < surface.unreachableFromEntry.length)
    summary.unreachableFromEntryTruncated = true;
  return summary;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolves a `package.json` field value (from `exports` or `main`) to a project-relative
 * path present in the graph. Tries the field as-is, then converts `dist/…js` → `src/…ts`.
 *
 * @param {string} field - Raw field value (e.g. `"./dist/index.js"`).
 * @param {Graph} graph - Graph to probe.
 * @returns {string | null} Project-relative path, or `null` if not found.
 */
function tryResolveSrcEquiv(field: string, graph: Graph): string | null {
  const rel = field.replace(/^\.\//, "");
  if (graph.nodes.has(rel)) return rel;
  const srcEquiv = rel.replace(/^dist\//, "src/").replace(/\.(js|mjs|cjs)$/, ".ts");
  if (graph.nodes.has(srcEquiv)) return srcEquiv;
  return null;
}

/**
 * Resolves a single value from `package.json exports[subpath]` to a graph path.
 * Handles both plain strings and conditional-export objects (`{ import, require, default }`).
 *
 * @param {unknown} value - Value for one subpath entry in the `exports` map.
 * @param {Graph} graph - Graph to probe.
 * @returns {string | null} Project-relative path, or `null` if not resolvable.
 */
function resolveExportsValue(value: unknown, graph: Graph): string | null {
  if (typeof value === "string") return tryResolveSrcEquiv(value, graph);
  if (value && typeof value === "object") {
    // Conditional exports: prefer import > require > default
    const cond = value as Record<string, unknown>;
    for (const key of ["import", "require", "default"]) {
      const resolved = resolveExportsValue(cond[key], graph);
      if (resolved) return resolved;
    }
  }
  return null;
}

/**
 * Infers a coarse `ExportKind` from the leading keyword of a type signature string.
 *
 * @param {string | undefined} signature - Raw signature string from an `ExportedSymbol`.
 * @returns {ExportKind} Inferred kind, or `"unknown"` when the signature is absent or unrecognised.
 */
function inferExportKind(signature: string | undefined): ExportKind {
  if (!signature) return "unknown";
  const trimmed = signature.trimStart();
  if (trimmed.startsWith("interface ")) return "interface";
  if (trimmed.startsWith("class ")) return "class";
  if (trimmed.startsWith("enum ")) return "enum";
  if (trimmed.startsWith("type ")) return "type";
  if (trimmed.startsWith("namespace ")) return "namespace";
  if (
    trimmed.startsWith("const ") ||
    trimmed.startsWith("let ") ||
    trimmed.startsWith("var ") ||
    trimmed.startsWith("readonly ")
  )
    return "const";
  // Function signatures: leading `(`, async keyword, or contains `=>`
  if (
    trimmed.startsWith("(") ||
    trimmed.startsWith("async ") ||
    trimmed.startsWith("function ") ||
    trimmed.includes("=>")
  )
    return "function";
  return "unknown";
}

/**
 * Walks the `export * from` and named `export { … } from` chains starting at each entry
 * point and returns every symbol name accessible to consumers of those entry points.
 *
 * Wildcard re-exports (`export * from "./module"` — edge with no `symbols`) propagate all
 * exports of the target file and recurse into that file's own re-export edges.
 * Named re-exports (`export { foo } from "./module"` — edge with `symbols: ["foo"]`) add
 * only those names without recursing, because the constraint is already fully specified.
 *
 * @param {Graph} graph - The dependency graph.
 * @param {string[]} entryPoints - Project-relative paths of all public entry points.
 * @returns {Set<string>} All symbol names accessible from the entry points.
 */
function collectAccessibleSymbolNames(graph: Graph, entryPoints: string[]): Set<string> {
  const accessible = new Set<string>();
  // Only visit a file via wildcard path once to avoid cycles and redundant work
  const wildcardVisited = new Set<string>();
  const queue: string[] = [...entryPoints];

  while (queue.length) {
    const current = queue.shift() as string;
    if (wildcardVisited.has(current)) continue;
    wildcardVisited.add(current);

    const node = graph.nodes.get(current);
    if (!node) continue;

    // Direct exports declared in this file (catches concrete declarations in entry points)
    for (const sym of node.exports) accessible.add(sym.name);

    // Follow re-export edges.
    // The TypeScript parser represents `export * from "…"` as symbols: ["*"].
    // Named re-exports like `export { foo } from "…"` carry the actual names.
    for (const imp of node.imports) {
      if (imp.type !== "re-export" || imp.isExternal || !imp.toPath) continue;

      const isWildcard = !imp.symbols?.length || imp.symbols.includes("*");
      if (isWildcard) {
        // Wildcard re-export: expose all target exports and recurse into that file
        const target = graph.nodes.get(imp.toPath);
        if (target) {
          for (const sym of target.exports) accessible.add(sym.name);
        }
        queue.push(imp.toPath);
      } else {
        // Named re-export: expose only the listed names, do not recurse
        for (const name of imp.symbols as string[]) accessible.add(name);
      }
    }
  }

  return accessible;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attempts to auto-detect the primary public entry point by reading `package.json` from `root`.
 * Handles modern conditional-exports objects as well as plain `main`/`module` fields.
 * Converts `dist/index.js` → `src/index.ts` before checking the graph.
 * Falls back to common candidates when `package.json` is absent or unparseable.
 *
 * @param {Graph} graph - The built dependency graph.
 * @param {string} root - Absolute path to the project root.
 * @returns {string | null} Project-relative path of the detected entry point, or `null` if none found.
 */
export function detectEntryPoint(graph: Graph, root: string): string | null {
  const all = detectAllEntryPoints(graph, root);
  return all[0] ?? null;
}

/**
 * Detects all public entry points for a project by reading the `package.json exports` map.
 * Each sub-path (`.`, `./utils`, etc.) is resolved to a project-relative graph path.
 * Falls back to `main`/`module` fields, then to common `src/index.ts` candidates.
 *
 * @param {Graph} graph - The built dependency graph.
 * @param {string} root - Absolute path to the project root.
 * @returns {string[]} Ordered list of project-relative paths for all detected entry points.
 */
export function detectAllEntryPoints(graph: Graph, root: string): string[] {
  const found: string[] = [];

  const pkgPath = path.join(root, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
        main?: string;
        module?: string;
        exports?: unknown;
        bin?: unknown;
      };

      // Modern packages: parse exports map (handles conditional exports)
      if (pkg.exports && typeof pkg.exports === "object" && !Array.isArray(pkg.exports)) {
        for (const value of Object.values(pkg.exports as Record<string, unknown>)) {
          const resolved = resolveExportsValue(value, graph);
          if (resolved && !found.includes(resolved)) found.push(resolved);
        }
      } else if (typeof pkg.exports === "string") {
        const resolved = tryResolveSrcEquiv(pkg.exports, graph);
        if (resolved) found.push(resolved);
      }

      // `bin` scripts are real additional entry points (CLI / server binaries). Their transitive
      // deps are implementation, not dead code — count them so `unreachableFromEntry` stays a
      // meaningful signal. Additive to `exports`; listed after it so `found[0]` stays the lib root.
      const binValues =
        typeof pkg.bin === "string"
          ? [pkg.bin]
          : pkg.bin && typeof pkg.bin === "object" && !Array.isArray(pkg.bin)
            ? Object.values(pkg.bin as Record<string, unknown>).filter(
                (value): value is string => typeof value === "string",
              )
            : [];
      for (const binValue of binValues) {
        const resolved = tryResolveSrcEquiv(binValue, graph);
        if (resolved && !found.includes(resolved)) found.push(resolved);
      }

      // Legacy fallbacks: main / module
      if (found.length === 0) {
        for (const field of [pkg.main, pkg.module].filter(Boolean) as string[]) {
          const resolved = tryResolveSrcEquiv(field, graph);
          if (resolved && !found.includes(resolved)) found.push(resolved);
        }
      }
    } catch {
      // ignore parse/IO errors
    }
  }

  // Well-known JS/TS candidates
  if (found.length === 0) {
    for (const candidate of ["src/index.ts", "src/index.js", "index.ts", "index.js"]) {
      if (graph.nodes.has(candidate)) {
        found.push(candidate);
        break;
      }
    }
  }

  // Non-JS projects have no package.json convention — fall back to a per-language heuristic.
  if (found.length === 0) return detectNonJsEntryPoints(graph);

  return found;
}

const JVM_TYPES = new Set<FileType>(["java", "kotlin", "scala", "groovy"]);

/** Path-based test detection, for languages/layouts the category classifier may not cover
 *  (notably Go's `*_test.go` convention). */
function looksLikeTest(relPath: string): boolean {
  return (
    relPath.endsWith("_test.go") ||
    /(^|\/)(test|tests|__tests__|testdata)\//.test(relPath) ||
    /[._-](test|spec)\.[^/]+$/.test(relPath)
  );
}

/**
 * @description Entry-point heuristic for non-JS projects, which have no `package.json`
 *   `exports`/`main` to read. The "public API" of a Go/Python/JVM module is the set of exported
 *   symbols across its source files, so every non-test source file is treated as an entry point:
 *   - **Python**: the shallowest `__init__.py` files (package roots) if any exist, else every module.
 *   - **Go**: every non-`*_test.go` file.
 *   - **JVM** (java/kotlin/scala/groovy): every non-test source file — covers a single-repo JVM
 *     project not detected as a Gradle/sbt workspace.
 *   The first language with matching nodes wins; a genuinely polyglot repo is analysed one
 *   language at a time via its own `analyze`/query anyway.
 * @param {Graph} graph - The built dependency graph.
 * @returns {string[]} Project-relative entry-point paths, sorted; empty if no non-JS source is present.
 */
function detectNonJsEntryPoints(graph: Graph): string[] {
  const nodes = [...graph.nodes.values()];
  const sourcesOf = (match: (type: FileType) => boolean): FileNode[] =>
    nodes.filter(
      (node) => match(node.type) && node.category !== "test" && !looksLikeTest(node.path),
    );

  const python = sourcesOf((type) => type === "python");
  if (python.length > 0) {
    const inits = python.filter((node) => node.path.replace(/^.*\//, "") === "__init__.py");
    if (inits.length > 0) {
      const minDepth = Math.min(...inits.map((node) => node.path.split("/").length));
      return inits
        .filter((node) => node.path.split("/").length === minDepth)
        .map((node) => node.path)
        .sort();
    }
    return python.map((node) => node.path).sort();
  }

  const go = sourcesOf((type) => type === "go");
  if (go.length > 0) return go.map((node) => node.path).sort();

  const jvm = sourcesOf((type) => JVM_TYPES.has(type));
  if (jvm.length > 0) return jvm.map((node) => node.path).sort();

  return [];
}

/**
 * Builds an API surface report for one or more public entry points.
 *
 * **Public exports** are collected by walking `export * from` wildcard chains and named
 * `export { … } from` edges — not just the `exports` array of the entry node. This means
 * barrel re-export patterns (the common TypeScript library layout) are handled correctly.
 * Each symbol is resolved to the file that concretely defines it (has `signature` or `doc`
 * on a non-barrel node); barrel intermediaries are skipped.
 *
 * **File partitioning** (all graph nodes, each in exactly one bucket):
 * - `entryPoints` themselves
 * - `internalFiles` — reachable from any entry point, non-test
 * - `testFiles` — not reachable from any entry point, `category === "test"`
 * - `unreachableFromEntry` — not reachable from any entry point, non-test (may be separate consumers or dead code)
 *
 * @param {Graph} graph - The built dependency graph.
 * @param {string[]} entryPoints - Project-relative paths of the public entry point files.
 * @returns {ApiSurface} The API surface report.
 * @throws {Error} If any entry point is not present in the graph.
 */
/**
 * @description Walks outgoing imports from every entry point and returns the set of all
 *   files reachable from them, including the entry points themselves.
 * @param {Graph} graph - The dependency graph.
 * @param {string[]} entryPoints - Project-relative paths of all public entry points.
 * @returns {Set<string>} Every file path reachable from any entry point.
 */
function collectReachableFiles(graph: Graph, entryPoints: string[]): Set<string> {
  const reachableFiles = new Set<string>(entryPoints);
  for (const entryPoint of entryPoints) {
    graph.traverse(
      entryPoint,
      (node) => {
        reachableFiles.add(node.path);
        return true;
      },
      { direction: "outgoing" },
    );
  }
  return reachableFiles;
}

/** The best concrete definition found for an exported symbol name. */
interface SymbolDefinition {
  file: string;
  symbol: ExportedSymbol;
}

/**
 * @description Builds a map of symbol name → best concrete definition among all reachable,
 *   non-entry files. "Best" means having a signature/doc on a non-barrel file, so `definedIn`
 *   points at the actual implementation rather than a re-exporting barrel.
 * @param {Graph} graph - The dependency graph.
 * @param {Set<string>} reachableFiles - Files reachable from any entry point.
 * @param {string[]} entryPoints - Project-relative paths of all public entry points, excluded from consideration.
 * @returns {Map<string, SymbolDefinition>} Symbol name → its best concrete definition.
 */
function buildDefinitionsMap(
  graph: Graph,
  reachableFiles: Set<string>,
  entryPoints: string[],
): Map<string, SymbolDefinition> {
  const definitions = new Map<string, SymbolDefinition>();
  for (const filePath of reachableFiles) {
    if (entryPoints.includes(filePath)) continue;
    const node = graph.nodes.get(filePath);
    if (!node) continue;
    const isBarrel = node.category === "barrel";
    for (const exportedSymbol of node.exports) {
      const existingDefinition = definitions.get(exportedSymbol.name);
      const hasConcreteSignature = !!(exportedSymbol.signature || exportedSymbol.doc);
      if (!existingDefinition || (hasConcreteSignature && !isBarrel)) {
        definitions.set(exportedSymbol.name, { file: filePath, symbol: exportedSymbol });
      }
    }
  }
  return definitions;
}

/**
 * @description Builds the sorted `publicExports` list for every accessible symbol name,
 *   preferring the best concrete definition found by `buildDefinitionsMap` and falling back
 *   to the entry node's own `ExportedSymbol` when no better definition exists.
 * @param {Set<string>} accessibleNames - All symbol names accessible from the entry points.
 * @param {Map<string, SymbolDefinition>} definitions - Symbol name → best concrete definition.
 * @param {Graph} graph - The dependency graph.
 * @param {string[]} entryPoints - Project-relative paths of all public entry points.
 * @returns {PublicExport[]} Public exports sorted alphabetically by name.
 */
function buildPublicExports(
  accessibleNames: Set<string>,
  definitions: Map<string, SymbolDefinition>,
  graph: Graph,
  entryPoints: string[],
): PublicExport[] {
  const publicExports: PublicExport[] = [];
  for (const name of accessibleNames) {
    const definition = definitions.get(name);
    const entrySymbol = entryPoints
      .flatMap((entryPoint) => graph.nodes.get(entryPoint)?.exports ?? [])
      .find((exportedSymbol) => exportedSymbol.name === name);
    const symbol = definition?.symbol ?? entrySymbol;

    const definedIn =
      definition?.file ??
      entryPoints.find((entryPoint) =>
        graph.nodes.get(entryPoint)?.exports.some((exportedSymbol) => exportedSymbol.name === name),
      ) ??
      (entryPoints[0] as string);

    const publicExport: PublicExport = {
      name,
      definedIn,
      kind: inferExportKind(symbol?.signature),
    };
    if (symbol?.doc) publicExport.doc = symbol.doc;
    if (symbol?.signature) publicExport.signature = symbol.signature;
    publicExports.push(publicExport);
  }
  publicExports.sort((exportA, exportB) => exportA.name.localeCompare(exportB.name));
  return publicExports;
}

/** File-path partitions of the whole graph relative to reachability and test status. */
interface NodePartitions {
  internalFiles: string[];
  unreachableFromEntry: string[];
  testFiles: string[];
}

/**
 * @description Partitions every file in the graph into implementation files backing the
 *   public API (`internalFiles`), non-test files unreachable from any entry point
 *   (`unreachableFromEntry`), and unreachable test files (`testFiles`).
 * @param {Graph} graph - The dependency graph.
 * @param {Set<string>} reachableFiles - Files reachable from any entry point.
 * @param {string[]} entryPoints - Project-relative paths of all public entry points.
 * @returns {NodePartitions} The three file-path partitions.
 */
function partitionNodes(
  graph: Graph,
  reachableFiles: Set<string>,
  entryPoints: string[],
): NodePartitions {
  const isTestNode = (filePath: string) => graph.nodes.get(filePath)?.category === "test";

  const internalFiles = [...reachableFiles].filter(
    (filePath) => !entryPoints.includes(filePath) && !isTestNode(filePath),
  );

  const unreachableFiles = [...graph.nodes.keys()].filter(
    (filePath) => !reachableFiles.has(filePath),
  );
  const unreachableFromEntry = unreachableFiles.filter((filePath) => !isTestNode(filePath));
  const testFiles = unreachableFiles.filter((filePath) => isTestNode(filePath));

  return { internalFiles, unreachableFromEntry, testFiles };
}

export function buildApiSurface(graph: Graph, entryPoints: string[]): ApiSurface {
  if (entryPoints.length === 0)
    throw new Error("buildApiSurface requires at least one entry point");

  for (const entryPoint of entryPoints) {
    if (!graph.nodes.has(entryPoint))
      throw new Error(`Entry point not found in graph: ${entryPoint}`);
  }

  const reachableFiles = collectReachableFiles(graph, entryPoints);
  const definitions = buildDefinitionsMap(graph, reachableFiles, entryPoints);

  // Handles `export * from` wildcards that the parser doesn't expand into the entry node's
  // own `exports` array.
  const accessibleNames = collectAccessibleSymbolNames(graph, entryPoints);

  const publicExports = buildPublicExports(accessibleNames, definitions, graph, entryPoints);
  const { internalFiles, unreachableFromEntry, testFiles } = partitionNodes(
    graph,
    reachableFiles,
    entryPoints,
  );

  return { entryPoints, publicExports, internalFiles, unreachableFromEntry, testFiles };
}
