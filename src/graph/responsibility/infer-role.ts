/** Infers a coarse semantic role for a file node from its path and graph category. */
import type { FileNode } from "../../types/node";
import type { ModuleRole } from "./types";

/**
 * Infers a coarse `ModuleRole` from a file's path and graph category.
 * Uses common directory-naming conventions so it works across any project layout.
 *
 * @param {FileNode} node - The file node to classify.
 * @returns {ModuleRole} The best-matching role, defaulting to `"other"`.
 */
export function inferRole(node: FileNode): ModuleRole {
  if (node.category === "test") return "test";
  if (node.category === "config") return "config";
  if (node.category === "type-only") return "types";

  const filePath = node.path;

  // Ordered most-specific → least-specific
  if (seg(filePath, "component") || seg(filePath, "components")) return "component";
  if (seg(filePath, "controller") || seg(filePath, "controllers")) return "controller";
  if (seg(filePath, "middleware")) return "middleware";
  if (seg(filePath, "router") || seg(filePath, "routes") || seg(filePath, "route")) return "router";
  if (seg(filePath, "store") || seg(filePath, "stores")) return "store";
  if (seg(filePath, "service") || seg(filePath, "services")) return "service";
  if (seg(filePath, "handler") || seg(filePath, "handlers")) return "handler";
  if (seg(filePath, "adapter") || seg(filePath, "adapters")) return "adapter";
  if (seg(filePath, "plugin") || seg(filePath, "plugins")) return "plugin";
  if (seg(filePath, "api")) return "api";
  if (seg(filePath, "cli") || seg(filePath, "commands") || fileBasename(filePath) === "cli")
    return "cli";
  if (
    seg(filePath, "util") ||
    seg(filePath, "utils") ||
    seg(filePath, "helper") ||
    seg(filePath, "helpers")
  )
    return "util";
  if (seg(filePath, "model") || seg(filePath, "models") || fileBasename(filePath) === "model")
    return "model";
  if (seg(filePath, "parser") || seg(filePath, "parsers") || fileBasename(filePath) === "parser")
    return "parser";
  if (fileBasename(filePath) === "builder") return "builder";
  if (fileBasename(filePath) === "resolver") return "resolver";

  return "other";
}

/**
 * Returns true when `segment` appears as a discrete path component.
 * Matches `/<segment>/` (directory) or `/<segment>.` (file) to avoid false
 * positives on names that merely contain the segment as a substring.
 *
 * @param {string} filePath - Project-relative file path to test.
 * @param {string} segment - Directory or filename stem to look for.
 * @returns {boolean} Whether `segment` is a standalone path component in `filePath`.
 */
function seg(filePath: string, segment: string): boolean {
  return filePath.includes(`/${segment}/`) || filePath.includes(`/${segment}.`);
}

/**
 * Extracts the basename of a file path with its extension removed.
 *
 * @param {string} filePath - Project-relative file path (e.g. `src/graph/builder.ts`).
 * @returns {string} The stem of the filename (e.g. `builder`).
 */
function fileBasename(filePath: string): string {
  const name = filePath.slice(filePath.lastIndexOf("/") + 1);
  return name.slice(0, name.lastIndexOf(".")) || name;
}
