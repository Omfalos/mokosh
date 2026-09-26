import type { LanguageAdapter } from "../types";

export const CSS_ADAPTER: LanguageAdapter = {
  type: "css",
  family: "style",
  extensions: [".css"],
  capabilities: {
    exportSymbols: false,
    importSymbols: false,
    callEdges: false,
    functionComplexity: false,
    typeGraph: false,
    testTags: false,
  },
  fidelity: {
    importResolution: "full",
    exportSymbols: "none",
    importSymbols: "none",
    callEdges: "none",
    complexity: "none",
    category: "full",
    duplication: "full",
    testTags: "none",
  },
};

export const SCSS_ADAPTER: LanguageAdapter = {
  type: "scss",
  family: "style",
  extensions: [".scss", ".sass"],
  capabilities: {
    exportSymbols: true,
    importSymbols: false,
    callEdges: false,
    functionComplexity: false,
    typeGraph: false,
    testTags: false,
  },
  fidelity: {
    importResolution: "full",
    exportSymbols: "partial",
    importSymbols: "none",
    callEdges: "none",
    complexity: "none",
    category: "full",
    duplication: "full",
    testTags: "none",
  },
  caveats: { exportSymbols: "root-level $/@ variables, mixins and functions only" },
};

export const LESS_ADAPTER: LanguageAdapter = {
  type: "less",
  family: "style",
  extensions: [".less"],
  capabilities: {
    exportSymbols: true,
    importSymbols: false,
    callEdges: false,
    functionComplexity: false,
    typeGraph: false,
    testTags: false,
  },
  fidelity: {
    importResolution: "full",
    exportSymbols: "partial",
    importSymbols: "none",
    callEdges: "none",
    complexity: "none",
    category: "full",
    duplication: "full",
    testTags: "none",
  },
  caveats: { exportSymbols: "root-level $/@ variables, mixins and functions only" },
};

export const STYLUS_ADAPTER: LanguageAdapter = {
  type: "stylus",
  family: "style",
  extensions: [".styl"],
  capabilities: {
    exportSymbols: false,
    importSymbols: false,
    callEdges: false,
    functionComplexity: false,
    typeGraph: false,
    testTags: false,
  },
  fidelity: {
    importResolution: "full",
    exportSymbols: "none",
    importSymbols: "none",
    callEdges: "none",
    complexity: "none",
    category: "full",
    duplication: "partial",
    testTags: "none",
  },
  caveats: {
    duplication: "generic token pipeline — no shared PostCSS AST for structural comparison",
  },
};
