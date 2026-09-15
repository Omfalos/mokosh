/** Hybrid Kotlin parser: a hand-rolled line scanner for `package`/`import` lines and top-level
 *  declarations (imports/exports/tags/category — unchanged from the pre-grammar scanner, since
 *  the tree has no `typealias` rule and a tree-based export path would regress that construct),
 *  plus mokosh's own first-party @lezer grammar (see src/parser/lang/kotlin/PROGRESS.md,
 *  docs/adr-021-kotlin-parsing.md) layered on top purely additively for call-edge extraction. Any
 *  parse failure or high error-node density degrades silently to the regex-only output — never
 *  worse than before the grammar existed. */

import type { ExportedSymbol, ImportEdge } from "../../types/node";
import { collectCallEdges } from "../complexity/kotlin";
import { errorRatio } from "../complexity/lezer-utils";
import type { ParseResult, RawCallEdge } from "../types";
import {
  classifyJvm,
  extractJvmPackage,
  jvmImportEdge,
  jvmPackageEdge,
  scanJvmClassifyHints,
  scanTagMarkers,
  stripJvmComments,
} from "./jvm-scan";
import { parser as kotlinParser } from "./kotlin/index";

/** `import a.b.C`, `import a.b.*`, `import a.b.C as D`. The alias (group 3) is captured only to
 *  build the call-edge resolution map below — `ImportEdge` itself never retains it, matching the
 *  JVM-wide convention documented in `jvm-scan.ts`'s `importSymbolFromSpecifier`. */
const IMPORT_RE = /^\s*import\s+([\w.]+(?:\.\*)?)(?:\s+as\s+(\w+))?\s*$/;

/** Above this error-node-span ratio, the tree is untrustworthy enough that call-edge extraction
 *  is skipped entirely rather than risk emitting wrong edges — see `docs/adr-021-kotlin-parsing.md`
 *  and the Phase 1 corpus gate result it's based on (OkHttp: 1.02% overall, worst single-file
 *  outliers ~22%, all attributable to documented grammar scope cuts). */
const ERROR_RATIO_THRESHOLD = 0.05;

/** Call-edge extraction is implemented and correct for what it can see (no false positives
 *  demonstrated). A real grammar bug (no ASI/newline-sensitivity — consecutive bare-call
 *  statements with no separator collapse into one garbage `InfixExpression`, a very common
 *  Kotlin shape) survived three grammar-level fix attempts, each hitting a different Lezer
 *  automaton dead end (see `src/parser/lang/kotlin/PROGRESS.md`'s "Phase 1" section) — so the
 *  recovery lives in {@link collectCallEdges}'s `collectInfixMisparseEdges` instead, at the
 *  tree-walking level: the common mis-nested shapes (qualified calls, no-argument constructor
 *  calls) are recovered from the mis-parsed tree, leaving only a narrower residual gap
 *  (with-arguments constructor calls in that exact position) documented in
 *  `LANGUAGE_FIDELITY.kotlin` (`src/graph/language-support.ts`). */
const CALL_EDGES_ENABLED = true;

/** Leading modifier soup shared by type and function declarations. */
const MODIFIERS =
  "(?:public\\s+|internal\\s+|private\\s+|protected\\s+|open\\s+|abstract\\s+|final\\s+|sealed\\s+|data\\s+|value\\s+|inline\\s+|noinline\\s+|crossinline\\s+|external\\s+|expect\\s+|actual\\s+|suspend\\s+|operator\\s+|infix\\s+|tailrec\\s+|const\\s+|lateinit\\s+)*";

/** Top-level type declaration, anchored at column 0. Optional `enum`/`annotation` qualifier before `class`. */
const TYPE_DECL_RE = new RegExp(
  `^(?:@[\\w.]+(?:\\([^)]*\\))?\\s+)*${MODIFIERS}(?:(?:enum|annotation)\\s+)?(class|interface|object|typealias)\\s+([A-Za-z_][A-Za-z0-9_]*)`,
);

/**
 * Top-level `fun`, anchored at column 0. Skips optional type params (`<T>`) and an optional
 * extension receiver (`Foo.` / `Foo<T>.` / `foo.bar.`) so the captured name is the function
 * itself — `fun <T> Iterable<T>.asFlow()` yields `asFlow`, not `Iterable`.
 */
const FUN_DECL_RE = new RegExp(
  `^(?:@[\\w.]+(?:\\([^)]*\\))?\\s+)*${MODIFIERS}fun\\s+(?:<[^>]*>\\s*)?(?:[A-Za-z_][\\w.]*(?:<[^>]*>)?\\.)?([A-Za-z_][A-Za-z0-9_]*)\\s*[(<]`,
);

/** Top-level `val` / `var` / `const val`, anchored at column 0. */
const PROP_DECL_RE = new RegExp(
  `^(?:@[\\w.]+(?:\\([^)]*\\))?\\s+)*${MODIFIERS}(?:val|var)\\s+(?:<[^>]*>\\s*)?([A-Za-z_][A-Za-z0-9_]*)`,
);

/**
 * @description Parses a Kotlin source file with a line scanner. Emits one external
 *   `ImportEdge` per `import` line plus a synthetic same-package edge (see {@link jvmPackageEdge}),
 *   collects top-level `class` / `interface` / `object` / `typealias` / `fun` / `val` names as
 *   exports, reads `// @tag name` markers, and — additively, via mokosh's own Kotlin grammar —
 *   resolvable call edges (see {@link collectCallEdges}). Call-edge extraction is skipped for test
 *   files, on a grammar-parse failure, or above {@link ERROR_RATIO_THRESHOLD} error-node density;
 *   in every one of those cases the rest of the result is identical to the pre-grammar scanner.
 * @param filePath - Path to the `.kt` / `.kts` file; used for test-file classification.
 * @param content - Raw Kotlin source text.
 * @returns Parsed imports, exports, comment-marker tags, resolved category, and (when resolvable)
 *   raw call edges.
 */
export function parseKotlin(filePath: string, content: string): ParseResult {
  const tags = scanTagMarkers(content);
  const source = stripJvmComments(content);
  const lines = source.split("\n");

  const imports: ImportEdge[] = [];
  const exportNames = new Set<string>();
  /** Simple/aliased local name → FQN specifier, for call-edge resolution only (not retained on
   *  `ImportEdge`). Wildcard imports contribute no local name. */
  const localNames = new Map<string, string>();

  for (const line of lines) {
    const imp = line.match(IMPORT_RE);
    if (imp?.[1]) {
      const specifier = imp[1];
      imports.push(jvmImportEdge(filePath, specifier));
      if (!specifier.endsWith(".*")) {
        const local = imp[2] ?? specifier.split(".").pop();
        if (local) localNames.set(local, specifier);
      }
      continue;
    }
    const typeDecl = line.match(TYPE_DECL_RE);
    if (typeDecl?.[2]) {
      exportNames.add(typeDecl[2]);
      continue;
    }
    const funDecl = line.match(FUN_DECL_RE);
    if (funDecl?.[1]) {
      exportNames.add(funDecl[1]);
      continue;
    }
    const propDecl = line.match(PROP_DECL_RE);
    if (propDecl?.[1]) exportNames.add(propDecl[1]);
  }

  const ownPackage = extractJvmPackage(content, false);
  if (ownPackage) imports.push(jvmPackageEdge(filePath, ownPackage));

  const exports: ExportedSymbol[] = Array.from(exportNames, (name) => ({ name }));

  const category = classifyJvm(
    filePath,
    imports.map((edge) => edge.rawSpecifier),
    {
      typeNames: [...exportNames],
      annotations: scanJvmClassifyHints(content).annotations,
    },
  );

  let rawCallEdges: RawCallEdge[] | undefined;
  if (CALL_EDGES_ENABLED && category !== "test") {
    try {
      const tree = kotlinParser.parse(content);
      if (errorRatio(tree, content) <= ERROR_RATIO_THRESHOLD) {
        rawCallEdges = collectCallEdges(tree, content, localNames);
      }
    } catch {
      // Grammar parse failure — degrade to the regex-only result, exactly as before the grammar.
    }
  }

  return {
    imports,
    exports,
    tags: Array.from(tags).map((name) => ({ name, kind: "comment-marker" as const })),
    category,
    ...(rawCallEdges && rawCallEdges.length > 0 ? { rawCallEdges } : {}),
  };
}
