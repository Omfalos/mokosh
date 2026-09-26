import { GO_HOOKS } from "../hooks/go";
import type { LanguageAdapter } from "../types";

export const GO_ADAPTER: LanguageAdapter = {
  type: "go",
  extensions: [".go"],
  hooks: GO_HOOKS,
  capabilities: {
    exportSymbols: true,
    importSymbols: false,
    callEdges: true,
    functionComplexity: true,
    typeGraph: false,
    testTags: true,
  },
  fidelity: {
    importResolution: "full",
    exportSymbols: "partial",
    importSymbols: "none",
    callEdges: "full",
    complexity: "full",
    category: "partial",
    duplication: "partial",
    testTags: "full",
  },
  caveats: {
    exportSymbols: "identifier-level, no per-symbol doc/signature",
    importSymbols: "not tracked — per-import symbol resolution is not implemented",
  },
};
