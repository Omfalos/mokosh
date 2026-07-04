/** Post-build enrichment passes that annotate graph nodes with coverage, library tags, test links, and export-usage ratios. */
import path from "node:path";
import type { FileNode, ImportEdge, StructuredTag } from "../types/node";

/**
 * @description Annotates each node with its line-coverage percentage from a pre-loaded
 *   coverage map. Nodes not present in the map are left untouched (`coveragePct` remains
 *   undefined). Only called when the map is non-empty.
 * @param nodes - The full node map produced by the graph builder; mutated in place.
 * @param coverageMap - Map of project-relative path → line-coverage percentage (0–100).
 */
export function enrichCoverage(
  nodes: Map<string, FileNode>,
  coverageMap: Map<string, number>,
): void {
  for (const node of nodes.values()) {
    const pct = coverageMap.get(node.path);
    if (pct !== undefined) node.coveragePct = pct;
  }
}

/**
 * @description Scans a file's import edges and appends a structured `import`-kind tag for every
 * third-party library found. Scoped packages (`@scope/pkg/deep`) are normalised to their
 * two-segment name before deduplication.
 * @param imports - The resolved import edges for the file being enriched.
 * @param tags - The tag array for that same file; modified in place.
 */
export function enrichLibraryTags(imports: ImportEdge[], tags: StructuredTag[]): void {
  for (const imp of imports) {
    if (!imp.rawSpecifier.startsWith(".") && !path.isAbsolute(imp.rawSpecifier)) {
      const libName = imp.rawSpecifier.startsWith("@")
        ? imp.rawSpecifier.split("/").slice(0, 2).join("/")
        : imp.rawSpecifier.split("/")[0];
      if (libName && !tags.some((existingTag) => existingTag.name === libName)) {
        tags.push({ name: libName, kind: "library" });
      }
    }
  }
}

/**
 * @description Walks every test node in the graph and records it as a tester of each
 * `logic` or `barrel` node it imports. Populates `FileNode.testedBy` so that an AI
 * (or human) can ask "what tests cover this file?" without re-running dynamic analysis.
 * Only internal, resolved imports are considered; external imports are ignored.
 * @param nodes - The full node map produced by the graph builder; mutated in place.
 */
export function enrichTestedBy(nodes: Map<string, FileNode>): void {
  for (const node of nodes.values()) {
    if (node.category !== "test") continue;
    for (const imp of node.imports) {
      if (imp.isExternal || !imp.toPath) continue;
      const target = nodes.get(imp.toPath);
      if (!target) continue;
      if (target.category !== "logic" && target.category !== "barrel") continue;
      target.testedBy ??= [];
      if (!target.testedBy.includes(node.path)) target.testedBy.push(node.path);
    }
  }
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
/**
 * @description Computes a `exportUsageRatio` for each internal import edge and aggregates
 *   `avgExportUsage` and `maxExportUsage` per node. The ratio is the fraction of the target
 *   file's exports consumed by this import (`importedSymbols / target.exports.length`).
 *   Namespace imports (`["*"]`) and unresolved re-exports are treated as full usage (1.0).
 *   Side-effect imports and edges where the target has zero exports are skipped.
 * @param nodes - The full node map produced by the graph builder; mutated in place.
 */
export function enrichExportUsage(nodes: Map<string, FileNode>): void {
  for (const node of nodes.values()) {
    const ratios: number[] = [];
    for (const imp of node.imports) {
      if (imp.isExternal || !imp.toPath) continue;
      const target = nodes.get(imp.toPath);
      if (!target || target.exports.length === 0) continue;

      let ratio: number;
      if (imp.symbols === undefined) {
        if (imp.type === "side-effect") continue;
        ratio = 1.0;
      } else if (imp.symbols.includes("*")) {
        ratio = 1.0;
      } else {
        ratio = imp.symbols.length / target.exports.length;
      }

      imp.exportUsageRatio = round4(Math.min(1, ratio));
      ratios.push(imp.exportUsageRatio);
    }

    if (ratios.length > 0) {
      node.avgExportUsage = round4(ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length);
      node.maxExportUsage = Math.max(...ratios);
    }
  }
}

/**
 * @description Adds tags derived from each local import to the importing test node.
 *   Two tag kinds are applied: a filename-derived `import` tag (e.g. a test importing
 *   `graph/builder.ts` receives the tag `builder`), and any `comment-marker` tags
 *   propagated from the source node (e.g. `@tag auth` in `auth/service.ts` propagates
 *   to tests that import it). `function` and `variable` kind tags are intentionally skipped
 *   as they are too granular for test filtering. Existing duplicate tags are skipped.
 * @param {Map<string, FileNode>} nodes - The full node map produced by the graph builder; mutated in place.
 */
export function enrichTestNodeTags(nodes: Map<string, FileNode>): void {
  for (const node of nodes.values()) {
    if (node.category !== "test") continue;
    for (const imp of node.imports) {
      if (!imp.toPath || imp.isExternal) continue;

      const tag = path.basename(imp.toPath, path.extname(imp.toPath)).replace(/\.(test|spec)$/, "");
      if (
        tag &&
        !node.tags.some((existingTag) => existingTag.name === tag && existingTag.kind === "import")
      ) {
        node.tags.push({ name: tag, kind: "import" });
      }

      if (imp.symbols && !imp.symbols.includes("*")) {
        for (const sym of imp.symbols) {
          if (
            sym &&
            !node.tags.some(
              (existingTag) => existingTag.name === sym && existingTag.kind === "import",
            )
          ) {
            node.tags.push({ name: sym, kind: "import" });
          }
        }
      }

      const sourceNode = nodes.get(imp.toPath);
      if (!sourceNode || sourceNode.category === "test") continue;
      for (const sourceTag of sourceNode.tags) {
        if (sourceTag.kind !== "comment-marker") continue;
        if (
          !node.tags.some(
            (existingTag) =>
              existingTag.name === sourceTag.name && existingTag.kind === "comment-marker",
          )
        ) {
          node.tags.push({ name: sourceTag.name, kind: "comment-marker" });
        }
      }
    }
  }
}
