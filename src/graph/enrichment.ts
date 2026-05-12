import path from "node:path";
import type { FileNode, ImportEdge, StructuredTag } from "../types.js";

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
