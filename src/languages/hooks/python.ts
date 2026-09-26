import type { FileNode } from "../../types/node";
import type { LanguageHooks } from "../types";

/**
 * The shallowest `__init__.py` files (package roots) if any exist, else every module.
 *
 * @param {readonly FileNode[]} sources - Non-test Python source nodes.
 * @returns {string[]} Sorted project-relative paths.
 */
function pythonEntryPoints(sources: readonly FileNode[]): string[] {
  const inits = sources.filter((node) => node.path.replace(/^.*\//, "") === "__init__.py");
  if (inits.length > 0) {
    const minDepth = Math.min(...inits.map((node) => node.path.split("/").length));
    return inits
      .filter((node) => node.path.split("/").length === minDepth)
      .map((node) => node.path)
      .sort();
  }
  return sources.map((node) => node.path).sort();
}

export const PYTHON_HOOKS: LanguageHooks = { entryPoints: pythonEntryPoints };
