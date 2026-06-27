/** Detects entry-point files and builds an API surface describing all public exports reachable from them. */
import fs from "node:fs";
import path from "node:path";
import type { ExportedSymbol } from "../types/node";
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

  // Last resort: well-known candidates
  if (found.length === 0) {
    for (const candidate of ["src/index.ts", "src/index.js", "index.ts", "index.js"]) {
      if (graph.nodes.has(candidate)) {
        found.push(candidate);
        break;
      }
    }
  }

  return found;
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
export function buildApiSurface(graph: Graph, entryPoints: string[]): ApiSurface {
  if (entryPoints.length === 0)
    throw new Error("buildApiSurface requires at least one entry point");

  for (const ep of entryPoints) {
    if (!graph.nodes.has(ep)) throw new Error(`Entry point not found in graph: ${ep}`);
  }

  // --- 1. Collect all files reachable from any entry point ---
  const reachable = new Set<string>(entryPoints);
  for (const ep of entryPoints) {
    graph.traverse(
      ep,
      (node) => {
        reachable.add(node.path);
        return true;
      },
      { direction: "outgoing" },
    );
  }

  // --- 2. Build definitions map: symbol name → best concrete definition ---
  // "Best" = has signature/doc on a non-barrel file. Built from all reachable
  // non-entry files so that `definedIn` points to the actual implementation.
  const definitions = new Map<string, { file: string; sym: ExportedSymbol }>();
  for (const filePath of reachable) {
    if (entryPoints.includes(filePath)) continue;
    const node = graph.nodes.get(filePath);
    if (!node) continue;
    const isBarrel = node.category === "barrel";
    for (const sym of node.exports) {
      const existing = definitions.get(sym.name);
      const hasConcrete = !!(sym.signature || sym.doc);
      if (!existing || (hasConcrete && !isBarrel)) {
        definitions.set(sym.name, { file: filePath, sym });
      }
    }
  }

  // --- 3. Collect all accessible symbol names via re-export chain traversal ---
  // This handles `export * from` wildcards that the parser doesn't expand into
  // the entry node's `exports` array.
  const accessibleNames = collectAccessibleSymbolNames(graph, entryPoints);

  // --- 4. Build publicExports ---
  const publicExports: PublicExport[] = [];
  for (const name of accessibleNames) {
    const def = definitions.get(name);
    // Fall back to the entry node's own ExportedSymbol for signature/doc when no better def found
    const entrySymbol = entryPoints
      .flatMap((ep) => graph.nodes.get(ep)?.exports ?? [])
      .find((exportedSym) => exportedSym.name === name);
    const sym = def?.sym ?? entrySymbol;

    const definedIn =
      def?.file ??
      entryPoints.find((ep) =>
        graph.nodes.get(ep)?.exports.some((exportedSym) => exportedSym.name === name),
      ) ??
      (entryPoints[0] as string);

    const entry: PublicExport = { name, definedIn, kind: inferExportKind(sym?.signature) };
    if (sym?.doc) entry.doc = sym.doc;
    if (sym?.signature) entry.signature = sym.signature;
    publicExports.push(entry);
  }
  publicExports.sort((exportA, exportB) => exportA.name.localeCompare(exportB.name));

  // --- 5. Partition all graph nodes ---
  const isTestNode = (filePath: string) => graph.nodes.get(filePath)?.category === "test";

  const internalFiles = [...reachable].filter(
    (filePath) => !entryPoints.includes(filePath) && !isTestNode(filePath),
  );

  const notReachable = [...graph.nodes.keys()].filter((filePath) => !reachable.has(filePath));
  const unreachableFromEntry = notReachable.filter((filePath) => !isTestNode(filePath));
  const testFiles = notReachable.filter((filePath) => isTestNode(filePath));

  return { entryPoints, publicExports, internalFiles, unreachableFromEntry, testFiles };
}
