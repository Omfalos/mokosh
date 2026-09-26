import { JVM_HOOKS } from "../hooks/jvm";
import type { LanguageAdapter } from "../types";

export const JAVA_ADAPTER: LanguageAdapter = {
  type: "java",
  family: "jvm",
  extensions: [".java"],
  hooks: JVM_HOOKS,
  capabilities: {
    exportSymbols: true,
    importSymbols: true,
    callEdges: true,
    functionComplexity: true,
    typeGraph: true,
    testTags: true,
  },
  fidelity: {
    importResolution: "partial",
    exportSymbols: "partial",
    importSymbols: "partial",
    callEdges: "partial",
    complexity: "full",
    category: "partial",
    duplication: "partial",
    testTags: "full",
  },
  caveats: {
    importResolution:
      "index-based: matched by type name across the module, not by resolving the exact package path (ADR-017)",
    exportSymbols: "top-level types only, no field/method-level exports",
    importSymbols:
      "one symbol per import (the FQN's last segment, or the static member for `import static`); wildcard imports carry none, and re-exports aren't tracked",
    callEdges: "static calls and constructors only (incl. through generics), not virtual dispatch",
  },
};

export const KOTLIN_ADAPTER: LanguageAdapter = {
  type: "kotlin",
  family: "jvm",
  extensions: [".kt", ".kts"],
  hooks: JVM_HOOKS,
  capabilities: {
    exportSymbols: true,
    importSymbols: true,
    callEdges: true,
    functionComplexity: true,
    typeGraph: true,
    testTags: true,
  },
  fidelity: {
    importResolution: "partial",
    exportSymbols: "partial",
    importSymbols: "partial",
    callEdges: "partial",
    complexity: "partial",
    category: "partial",
    duplication: "partial",
    testTags: "full",
  },
  caveats: {
    importResolution: "index-based, shared with Java's JvmLangResolver (ADR-017)",
    exportSymbols: "top-level types only",
    importSymbols:
      "one symbol per import (the FQN's last segment); wildcard imports carry none, and re-exports aren't tracked",
    callEdges:
      "static/qualified calls and constructors only (via the first-party Kotlin grammar, ADR-021), not virtual dispatch; single-level qualifiers only (`a.b()`, not `a.b.c()`); wildcard-imported qualifiers don't resolve; statements are newline-separated in the grammar, so consecutive calls each keep their edge — the remaining gaps are unsupported syntax (labeled returns `return@x`, star projections `List<*>`, explicit call type arguments `f<T>()`), which parse with error nodes and can drop edges in that region",
    complexity:
      "via the first-party Kotlin grammar (ADR-021); skipped entirely (no score, not a wrong one) above the 5% error-node-density gate shared with call edges; a function whose own body contains an error node and a decision point is omitted from the per-function list",
  },
};

export const SCALA_ADAPTER: LanguageAdapter = {
  type: "scala",
  family: "jvm",
  extensions: [".scala", ".sc"],
  hooks: JVM_HOOKS,
  capabilities: {
    exportSymbols: true,
    importSymbols: true,
    callEdges: false,
    functionComplexity: false,
    typeGraph: false,
    testTags: true,
  },
  fidelity: {
    importResolution: "partial",
    exportSymbols: "partial",
    importSymbols: "partial",
    callEdges: "none",
    complexity: "none",
    category: "partial",
    duplication: "partial",
    testTags: "full",
  },
  caveats: {
    importResolution:
      "index-based, shared with Java's JvmLangResolver; brace-package imports are a known gap",
    exportSymbols: "top-level types only",
    importSymbols:
      "one symbol per import (the FQN's last segment, brace groups expanded to one edge per member); wildcard imports carry none, and re-exports aren't tracked",
    callEdges: "not extracted — Scala needs its own grammar (issue 8c)",
    complexity: "not computed — Scala needs its own grammar (issue 8c)",
  },
};

export const GROOVY_ADAPTER: LanguageAdapter = {
  type: "groovy",
  family: "jvm",
  extensions: [".groovy", ".gradle"],
  hooks: JVM_HOOKS,
  capabilities: {
    exportSymbols: true,
    importSymbols: true,
    callEdges: false,
    functionComplexity: false,
    typeGraph: false,
    testTags: true,
  },
  fidelity: {
    importResolution: "partial",
    exportSymbols: "partial",
    importSymbols: "partial",
    callEdges: "none",
    complexity: "none",
    category: "partial",
    duplication: "partial",
    testTags: "full",
  },
  caveats: {
    importResolution: "index-based, shared with Java's JvmLangResolver",
    exportSymbols: "top-level types only",
    importSymbols:
      "one symbol per import (the FQN's last segment, or the static member for `import static`); wildcard imports carry none, and re-exports aren't tracked",
    callEdges: "not extracted — Groovy needs its own grammar (issue 8c)",
    complexity: "not computed — Groovy needs its own grammar (issue 8c)",
  },
};
