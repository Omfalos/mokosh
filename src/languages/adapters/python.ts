import { PYTHON_HOOKS } from "../hooks/python";
import type { LanguageAdapter } from "../types";

export const PYTHON_ADAPTER: LanguageAdapter = {
  type: "python",
  extensions: [".py"],
  hooks: PYTHON_HOOKS,
  capabilities: {
    exportSymbols: true,
    importSymbols: true,
    callEdges: true,
    functionComplexity: true,
    typeGraph: false,
    testTags: true,
  },
  fidelity: {
    importResolution: "full",
    exportSymbols: "partial",
    importSymbols: "partial",
    callEdges: "full",
    complexity: "full",
    category: "partial",
    duplication: "partial",
    testTags: "full",
  },
  caveats: {
    exportSymbols: "tracked at module level, not per-symbol",
    importSymbols: "only star imports and re-exports are tracked (ADR-002)",
  },
};
