import type { FileNode } from "../../types/node";
import type { LanguageHooks } from "../types";

export const GO_HOOKS: LanguageHooks = {
  entryPoints: (sources: readonly FileNode[]) => sources.map((node) => node.path).sort(),
  isTestPath: (relPath: string) => relPath.endsWith("_test.go"),
};
