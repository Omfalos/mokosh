/** Infers a coarse semantic role for a file node from its path and graph category. */
import type { FileNode } from "../../types/node";
import type { ModuleRole } from "./types";

/**
 * Ordered most-specific → least-specific. Each rule matches if any of its `segments` appears
 * as a standalone path component (via {@link seg}), or the file's basename equals one of
 * `basenames`. The first matching rule wins.
 * @type {{ role: ModuleRole; segments?: string[]; basenames?: string[] }[]}
 */
const ROLE_RULES: { role: ModuleRole; segments?: string[]; basenames?: string[] }[] = [
  { role: "component", segments: ["component", "components"] },
  { role: "controller", segments: ["controller", "controllers"] },
  { role: "middleware", segments: ["middleware"] },
  { role: "router", segments: ["router", "routes", "route"] },
  { role: "store", segments: ["store", "stores"] },
  { role: "service", segments: ["service", "services"] },
  { role: "handler", segments: ["handler", "handlers"] },
  { role: "adapter", segments: ["adapter", "adapters"] },
  { role: "plugin", segments: ["plugin", "plugins"] },
  { role: "api", segments: ["api"] },
  { role: "cli", segments: ["cli", "commands"], basenames: ["cli"] },
  { role: "util", segments: ["util", "utils", "helper", "helpers"] },
  { role: "model", segments: ["model", "models"], basenames: ["model"] },
  { role: "parser", segments: ["parser", "parsers"], basenames: ["parser"] },
  { role: "builder", basenames: ["builder"] },
  { role: "resolver", basenames: ["resolver"] },
];

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
  const basename = fileBasename(filePath);

  for (const rule of ROLE_RULES) {
    if (rule.segments?.some((segment) => seg(filePath, segment))) return rule.role;
    if (rule.basenames?.includes(basename)) return rule.role;
  }

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
