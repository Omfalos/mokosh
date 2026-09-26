import type { LanguageAdapter } from "../types";

export const TYPESCRIPT_ADAPTER: LanguageAdapter = {
  type: "typescript",
  family: "js",
  extensions: [".ts", ".tsx"],
  capabilities: {
    exportSymbols: true,
    importSymbols: true,
    callEdges: true,
    functionComplexity: true,
    typeGraph: true,
    testTags: true,
  },
  fidelity: {
    importResolution: "full",
    exportSymbols: "full",
    importSymbols: "full",
    callEdges: "full",
    complexity: "full",
    category: "full",
    duplication: "partial",
    testTags: "full",
  },
};

export const JAVASCRIPT_ADAPTER: LanguageAdapter = {
  type: "javascript",
  family: "js",
  extensions: [".js", ".jsx", ".mjs", ".cjs"],
  capabilities: {
    exportSymbols: true,
    importSymbols: true,
    callEdges: true,
    functionComplexity: true,
    typeGraph: true,
    testTags: true,
  },
  fidelity: {
    importResolution: "full",
    exportSymbols: "full",
    importSymbols: "full",
    callEdges: "full",
    complexity: "full",
    category: "full",
    duplication: "partial",
    testTags: "full",
  },
};
