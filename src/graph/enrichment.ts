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
  for (const node of nodes.values()) applyCoverageForNode(node, coverageMap);
}

function applyCoverageForNode(node: FileNode, coverageMap: Map<string, number>): void {
  const pct = coverageMap.get(node.path);
  if (pct !== undefined) node.coveragePct = pct;
}

/**
 * @description Scans a file's *resolved* import edges and appends a structured `import`-kind tag
 * for every third-party library found. Scoped packages (`@scope/pkg/deep`) are normalised to their
 * two-segment name before deduplication. Relies on `isExternal` (set by the resolver) rather than
 * specifier syntax, since some languages — notably Sass/Less/Stylus — use bare specifiers
 * (`@import 'variables'`) to mean a local sibling file, not a package.
 * @param imports - The resolved import edges for the file being enriched.
 * @param tags - The tag array for that same file; modified in place.
 */
export function enrichLibraryTags(imports: ImportEdge[], tags: StructuredTag[]): void {
  for (const imp of imports) {
    if (imp.isExternal) {
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
    for (const imp of node.imports) applyTestedByForImport(node, imp, nodes);
  }
}

function applyTestedByForImport(
  node: FileNode,
  imp: ImportEdge,
  nodes: Map<string, FileNode>,
): void {
  if (imp.isExternal || !imp.toPath) return;
  const target = nodes.get(imp.toPath);
  if (!target) return;
  if (target.category !== "logic" && target.category !== "barrel") return;
  target.testedBy ??= [];
  if (!target.testedBy.includes(node.path)) target.testedBy.push(node.path);
}

/**
 * @description Links markdown docs to the code files they reference and flags likely-stale docs.
 * For each markdown node's resolved local imports, records the doc on the target's `documentedBy`
 * (any target, so "what docs reference this file?" stays accurate regardless of category), and —
 * when the target's last commit is newer than the doc's own — records the target on the doc's
 * `staleFor`. The staleness check is scoped to `category: "logic"` targets only: barrels (e.g.
 * `index.ts`), config files, and non-code files (package.json, lockfiles, other markdown) churn
 * constantly for reasons unrelated to documented behavior — comparing against them made every doc
 * in a repo look perpetually stale. This is still a commit-recency heuristic, not a content diff:
 * a doc can go stale without any timestamp gap (e.g. a behavior change bundled into the same
 * commit as its docs update), and a logic file touched only for formatting will still flag any
 * doc referencing it. Treat `staleFor` as "worth a look", not "definitely wrong".
 * @param nodes - The full node map produced by the graph builder; mutated in place.
 */
export function enrichDocDrift(nodes: Map<string, FileNode>): void {
  for (const node of nodes.values()) applyDocDriftForNode(node, nodes);
}

function applyDocDriftForNode(node: FileNode, nodes: Map<string, FileNode>): void {
  if (node.type !== "markdown") return;
  for (const imp of node.imports) {
    if (imp.isExternal || !imp.toPath) continue;
    const target = nodes.get(imp.toPath);
    if (!target || target === node) continue;

    target.documentedBy ??= [];
    if (!target.documentedBy.includes(node.path)) target.documentedBy.push(node.path);

    if (target.category !== "logic") continue;
    if ((target.lastCommitAt ?? 0) > (node.lastCommitAt ?? 0)) {
      node.staleFor ??= [];
      if (!node.staleFor.includes(target.path)) node.staleFor.push(target.path);
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
  for (const node of nodes.values()) applyExportUsageForNode(node, nodes);
}

function applyExportUsageForNode(node: FileNode, nodes: Map<string, FileNode>): void {
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

/**
 * @description Appends `{ name, kind }` to `tags` unless an entry with the same `name` and
 *   `kind` already exists. Centralises the dedup check shared by every tag-adding step in
 *   `enrichTestNodeTags`.
 * @param {StructuredTag[]} tags - The tag array to append to; mutated in place.
 * @param {string} name - The tag name to add.
 * @param {StructuredTag["kind"]} kind - The tag kind to add.
 */
function addUniqueTag(tags: StructuredTag[], name: string, kind: StructuredTag["kind"]): void {
  if (!name) return;
  if (tags.some((existingTag) => existingTag.name === name && existingTag.kind === kind)) return;
  tags.push({ name, kind });
}

/**
 * @description Adds a filename-derived `import` tag to `testNode` for the file it imports
 *   (e.g. a test importing `graph/builder.ts` receives the tag `builder`). Test-suffix
 *   extensions (`.test`/`.spec`) are stripped from the derived name.
 * @param {FileNode} testNode - The test node receiving the tag; mutated in place.
 * @param {ImportEdge} importEdge - The resolved import edge to derive the tag from.
 */
function addFilenameTag(testNode: FileNode, importEdge: ImportEdge): void {
  const toPath = importEdge.toPath as string;
  const filenameTag = path.basename(toPath, path.extname(toPath)).replace(/\.(test|spec)$/, "");
  addUniqueTag(testNode.tags, filenameTag, "import");
}

/**
 * @description Adds an `import` tag for each named symbol imported by `importEdge`.
 *   Namespace imports (`["*"]`) are skipped since there is no single symbol name to tag.
 * @param {FileNode} testNode - The test node receiving the tags; mutated in place.
 * @param {ImportEdge} importEdge - The resolved import edge whose `symbols` are tagged.
 */
function addSymbolTags(testNode: FileNode, importEdge: ImportEdge): void {
  if (!importEdge.symbols || importEdge.symbols.includes("*")) return;
  for (const symbolName of importEdge.symbols) {
    addUniqueTag(testNode.tags, symbolName, "import");
  }
}

/**
 * @description Propagates `comment-marker` tags (e.g. `@tag auth` in the source file) from
 *   the imported node to `testNode`, so tests inherit the semantic markers of what they test.
 *   Skips imports that resolve to another test node.
 * @param {FileNode} testNode - The test node receiving the tags; mutated in place.
 * @param {ImportEdge} importEdge - The resolved import edge whose target is inspected.
 * @param {Map<string, FileNode>} nodes - The full node map, used to look up the import target.
 */
function propagateCommentMarkers(
  testNode: FileNode,
  importEdge: ImportEdge,
  nodes: Map<string, FileNode>,
): void {
  const sourceNode = nodes.get(importEdge.toPath as string);
  if (!sourceNode || sourceNode.category === "test") return;
  for (const sourceTag of sourceNode.tags) {
    if (sourceTag.kind !== "comment-marker") continue;
    addUniqueTag(testNode.tags, sourceTag.name, "comment-marker");
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
    for (const importEdge of node.imports) applyTestNodeTagsForImport(node, importEdge, nodes);
  }
}

function applyTestNodeTagsForImport(
  node: FileNode,
  importEdge: ImportEdge,
  nodes: Map<string, FileNode>,
): void {
  if (!importEdge.toPath || importEdge.isExternal) return;

  addFilenameTag(node, importEdge);
  addSymbolTags(node, importEdge);
  propagateCommentMarkers(node, importEdge, nodes);
}

/**
 * @description Runs all five post-build enrichment concerns — test-node tags, `testedBy`
 *   links, export-usage ratios, doc-drift links, and coverage — in a single pass over `nodes`
 *   instead of one full-graph scan per concern (`enrichTestNodeTags`, `enrichTestedBy`,
 *   `enrichExportUsage`, `enrichDocDrift`, `enrichCoverage` run in sequence). Semantically
 *   equivalent to calling those five in sequence — see `enrichment.test.ts` for the
 *   equivalence check — and reuses the exact same per-node/per-import helpers each of them
 *   calls, so there is one implementation of every rule, not two.
 *
 *   Runs as two passes rather than one: a cheap reset pass clears enrichment-only derived
 *   fields (`testedBy`, `documentedBy`, `staleFor`, and `import`-kind tags previously added by
 *   this function to test nodes) before a second pass recomputes them. The reset has to happen
 *   for every node before any node is recomputed — `testedBy`/`documentedBy` are written onto
 *   the *target* of an edge, which can be a node that's processed later in map-iteration order,
 *   so resetting and writing in the same single pass would risk a node wiping output another
 *   node just wrote to it.
 *
 *   The reset matters for incremental rebuilds: `GraphBuilder`'s per-node cache reuse
 *   shallow-copies nodes from the previous graph, so these fields are the *same array
 *   references* carried forward build-to-build — without a reset, a relationship that stops
 *   being true (e.g. a test that no longer imports a file) would never be removed, only ever
 *   appended to. `comment-marker` tags are deliberately left out of the reset: that kind is
 *   also produced at parse time (`@tag` comments in a file's own source), so clearing it
 *   indiscriminately would delete genuine tags along with ones propagated by a prior
 *   enrichment run. That narrower staleness case is a pre-existing limitation, left as-is
 *   rather than risking data loss.
 * @param nodes - The full node map produced by the graph builder; mutated in place.
 * @param coverageMap - Map of project-relative path → line-coverage percentage (0–100). Pass
 *   an empty map to skip coverage annotation.
 */
export function enrichGraph(nodes: Map<string, FileNode>, coverageMap: Map<string, number>): void {
  for (const node of nodes.values()) {
    delete node.testedBy;
    delete node.documentedBy;
    delete node.staleFor;
    if (node.category === "test") node.tags = node.tags.filter((tag) => tag.kind !== "import");
  }

  for (const node of nodes.values()) {
    applyExportUsageForNode(node, nodes);
    if (coverageMap.size > 0) applyCoverageForNode(node, coverageMap);

    if (node.category === "test") {
      for (const imp of node.imports) {
        applyTestedByForImport(node, imp, nodes);
        applyTestNodeTagsForImport(node, imp, nodes);
      }
    }
    applyDocDriftForNode(node, nodes);
  }
}
