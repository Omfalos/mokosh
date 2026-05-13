import path from "node:path";
import type { FileNode, ImportEdge, StructuredTag } from "../types.js";

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
      if (libName && !tags.some((t) => t.name === libName)) {
        tags.push({ name: libName, kind: "import" });
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

/**
 * @description Adds a tag derived from the base filename of each local import to the
 * importing test node. This lets query tools filter for test files by the subject they
 * cover (e.g. a test that imports `graph/builder.ts` receives the tag `builder`).
 * Existing duplicate tags are skipped.
 * @param nodes - The full node map produced by the graph builder; mutated in place.
 */
export function enrichTestNodeTags(nodes: Map<string, FileNode>): void {
  for (const node of nodes.values()) {
    if (node.category !== "test") continue;
    for (const imp of node.imports) {
      if (!imp.toPath || imp.isExternal) continue;
      const tag = path.basename(imp.toPath, path.extname(imp.toPath)).replace(/\.(test|spec)$/, "");
      if (tag && !node.tags.some((t) => t.name === tag)) {
        node.tags.push({ name: tag, kind: "import" });
      }
    }
  }
}
