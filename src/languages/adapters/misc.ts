import type { LanguageAdapter } from "../types";

export const COFFEESCRIPT_ADAPTER: LanguageAdapter = {
  type: "coffeescript",
  extensions: [".coffee"],
  capabilities: {
    exportSymbols: true,
    importSymbols: false,
    callEdges: false,
    functionComplexity: false,
    typeGraph: false,
    testTags: false,
  },
  fidelity: {
    importResolution: "partial",
    exportSymbols: "partial",
    importSymbols: "none",
    callEdges: "none",
    complexity: "none",
    category: "partial",
    duplication: "partial",
    testTags: "none",
  },
  caveats: {
    importResolution: "generic relative-path fallback, no ecosystem-specific rules",
    exportSymbols: "best-effort, less validated than TS/JS",
    callEdges: "not extracted (backfill planned — see the language coverage roadmap)",
    complexity: "not computed (backfill planned — see the language coverage roadmap)",
    testTags: "no framework-aware strategy — falls back to the generic path-glob applier",
  },
};

export const LIVESCRIPT_ADAPTER: LanguageAdapter = {
  type: "livescript",
  extensions: [".ls"],
  capabilities: {
    exportSymbols: false,
    importSymbols: false,
    callEdges: false,
    functionComplexity: false,
    typeGraph: false,
    testTags: false,
  },
  fidelity: {
    importResolution: "partial",
    exportSymbols: "none",
    importSymbols: "none",
    callEdges: "none",
    complexity: "none",
    category: "partial",
    duplication: "partial",
    testTags: "none",
  },
  caveats: {
    importResolution: "generic relative-path fallback",
    exportSymbols: "not tracked",
    callEdges: "not extracted (backfill planned)",
    complexity: "not computed (backfill planned)",
    testTags: "no framework-aware strategy — falls back to the generic path-glob applier",
  },
};

export const LUA_ADAPTER: LanguageAdapter = {
  type: "lua",
  extensions: [".lua"],
  capabilities: {
    exportSymbols: true,
    importSymbols: false,
    callEdges: false,
    functionComplexity: false,
    typeGraph: false,
    testTags: false,
  },
  fidelity: {
    importResolution: "partial",
    exportSymbols: "partial",
    importSymbols: "none",
    callEdges: "none",
    complexity: "none",
    category: "partial",
    duplication: "partial",
    testTags: "none",
  },
  caveats: {
    importResolution: "basic dot-path handling only",
    exportSymbols: "best-effort module-return inspection",
    callEdges: "not extracted (backfill planned)",
    complexity: "not computed (backfill planned)",
    testTags: "no framework-aware strategy — falls back to the generic path-glob applier",
  },
};

export const GHERKIN_ADAPTER: LanguageAdapter = {
  type: "gherkin",
  extensions: [".feature"],
  capabilities: {
    exportSymbols: false,
    importSymbols: false,
    callEdges: false,
    functionComplexity: false,
    typeGraph: false,
    testTags: true,
  },
  fidelity: {
    importResolution: "none",
    exportSymbols: "none",
    importSymbols: "none",
    callEdges: "none",
    complexity: "none",
    category: "full",
    duplication: "partial",
    testTags: "full",
  },
  caveats: { importResolution: "feature files have no imports" },
};

export const MARKDOWN_ADAPTER: LanguageAdapter = {
  type: "markdown",
  extensions: [".md", ".mdx"],
  capabilities: {
    exportSymbols: false,
    importSymbols: false,
    callEdges: false,
    functionComplexity: false,
    typeGraph: false,
    testTags: false,
  },
  fidelity: {
    importResolution: "partial",
    exportSymbols: "none",
    importSymbols: "none",
    callEdges: "none",
    complexity: "none",
    category: "full",
    duplication: "partial",
    testTags: "none",
  },
  caveats: {
    importResolution: "edges only via code-span file references (`` `src/foo.ts` ``) (ADR-009)",
  },
};

export const UNKNOWN_ADAPTER: LanguageAdapter = {
  type: "unknown",
  extensions: [],
  capabilities: {
    exportSymbols: false,
    importSymbols: false,
    callEdges: false,
    functionComplexity: false,
    typeGraph: false,
    testTags: false,
  },
  fidelity: {
    importResolution: "none",
    exportSymbols: "none",
    importSymbols: "none",
    callEdges: "none",
    complexity: "none",
    category: "none",
    duplication: "none",
    testTags: "none",
  },
};
