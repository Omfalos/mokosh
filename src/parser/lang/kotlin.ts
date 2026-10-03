/** Hybrid Kotlin parser: a hand-rolled line scanner for `package`/`import` lines and top-level
 *  declarations (imports/exports/tags/category — unchanged from the pre-grammar scanner, since
 *  the tree has no `typealias` rule and a tree-based export path would regress that construct),
 *  plus mokosh's own first-party @lezer grammar (see src/parser/lang/kotlin/PROGRESS.md,
 *  docs/adr-021-kotlin-parsing.md) layered on top purely additively for call-edge extraction and
 *  complexity scoring. Any parse failure or high error-node density degrades silently to the
 *  regex-only output — never worse than before the grammar existed. Complexity is computed
 *  whenever the error-ratio gate passes, regardless of category; call edges are additionally
 *  skipped for test files (see {@link CALL_EDGES_ENABLED}). */

import { extractLeadingDoc } from "../../languages/hooks/jvm-doc";
import type { ExportedSymbol, ImportEdge } from "../../types/node";
import {
  collectCallEdges,
  collectFunctionComplexity,
  computeComplexity,
  ERROR_RATIO_THRESHOLD,
} from "../complexity/kotlin";
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
import { parser as kotlinParser, scriptParser as kotlinScriptParser } from "./kotlin/index";

/** `import a.b.C`, `import a.b.*`, `import a.b.C as D`. The alias (group 3) is captured only to
 *  build the call-edge resolution map below — `ImportEdge` itself never retains it, matching the
 *  JVM-wide convention documented in `jvm-scan.ts`'s `importSymbolFromSpecifier`. */
const IMPORT_RE = /^\s*import\s+([\w.]+(?:\.\*)?)(?:\s+as\s+(\w+))?\s*$/;

/** Call-edge extraction is implemented and correct for what it can see. Consecutive statements
 *  used to collapse into one garbage `InfixExpression`; the grammar now separates statements with a
 *  newline-aware `Nl` token (see `docs/adr-021-kotlin-parsing.md`, "Newline-separated
 *  statements"), which replaced an earlier tree-walking workaround. Remaining gaps are unsupported
 *  syntax (labeled returns, star projections, explicit call type arguments), documented in `LANGUAGE_FIDELITY.kotlin`
 *  (`src/graph/language-support.ts`). */
const CALL_EDGES_ENABLED = true;

/** Leading modifier soup shared by type and function declarations. */
const MODIFIERS =
  "(?:public\\s+|internal\\s+|private\\s+|protected\\s+|open\\s+|abstract\\s+|final\\s+|sealed\\s+|data\\s+|value\\s+|inline\\s+|noinline\\s+|crossinline\\s+|external\\s+|expect\\s+|actual\\s+|suspend\\s+|operator\\s+|infix\\s+|tailrec\\s+|const\\s+|lateinit\\s+)*";

/** Top-level type declaration, anchored at column 0. Optional `enum`/`annotation` qualifier before `class`. */
const TYPE_DECL_RE = new RegExp(
  `^(?:@[\\w.]+(?:\\([^)]*\\))?\\s+)*${MODIFIERS}(?:(enum|annotation)\\s+)?(class|interface|object|typealias)\\s+([A-Za-z_][A-Za-z0-9_]*)`,
);

/**
 * Top-level `fun`, anchored at column 0. Skips optional type params (`<T>`) and an optional
 * extension receiver (`Foo.` / `Foo<T>.` / `foo.bar.`) so the captured name is the function
 * itself — `fun <T> Iterable<T>.asFlow()` yields `asFlow`, not `Iterable`.
 */
const FUN_DECL_RE = new RegExp(
  `^(?:@[\\w.]+(?:\\([^)]*\\))?\\s+)*${MODIFIERS}fun\\s+(?:<[^>]*>\\s*)?(?:[A-Za-z_][\\w.]*(?:<[^>]*>)?\\.)?([A-Za-z_][A-Za-z0-9_]*)\\s*[(<]`,
);

/** Name of the synthetic function that carries a `.kts` script's top-level complexity. */
const SCRIPT_FUNCTION_NAME = "<script>";

/** Top-level `val` / `var` / `const val`, anchored at column 0. */
const PROP_DECL_RE = new RegExp(
  `^(?:@[\\w.]+(?:\\([^)]*\\))?\\s+)*${MODIFIERS}(?:val|var)\\s+(?:<[^>]*>\\s*)?([A-Za-z_][A-Za-z0-9_]*)`,
);

/**
 * @description Parses a Kotlin source file with a line scanner. Emits one external
 *   `ImportEdge` per `import` line plus a synthetic same-package edge (see {@link jvmPackageEdge}),
 *   collects top-level `class` / `interface` / `object` / `typealias` / `fun` / `val` names as
 *   exports, reads `// @tag name` markers, and — additively, via mokosh's own Kotlin grammar —
 *   file/function complexity (see {@link computeComplexity}, {@link collectFunctionComplexity})
 *   and resolvable call edges (see {@link collectCallEdges}). Complexity and call edges are both
 *   skipped on a grammar-parse failure or above {@link ERROR_RATIO_THRESHOLD} error-node density;
 *   call-edge extraction is additionally skipped for test files. In every one of those cases the
 *   rest of the result is identical to the pre-grammar scanner.
 * @param filePath - Path to the `.kt` / `.kts` file; used for test-file classification.
 * @param content - Raw Kotlin source text.
 * @returns Parsed imports, exports, comment-marker tags, resolved category, and (when resolvable)
 *   complexity, per-function complexity, and raw call edges.
 */
export function parseKotlin(filePath: string, content: string): ParseResult {
  const tags = scanTagMarkers(content);
  const source = stripJvmComments(content);
  const lines = source.split("\n");

  const imports: ImportEdge[] = [];
  /** Export name → Kotlin-native signature (`class Foo`, `fun bar`, …), read by `get_api_surface`. */
  const exportNames = new Map<string, string>();
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
    if (typeDecl?.[3]) {
      const keyword = typeDecl[1] === "enum" ? "enum" : typeDecl[2];
      exportNames.set(typeDecl[3], `${keyword} ${typeDecl[3]}`);
      continue;
    }
    const funDecl = line.match(FUN_DECL_RE);
    if (funDecl?.[1]) {
      exportNames.set(funDecl[1], `fun ${funDecl[1]}`);
      continue;
    }
    const propDecl = line.match(PROP_DECL_RE);
    if (propDecl?.[1]) exportNames.set(propDecl[1], `val ${propDecl[1]}`);
  }

  const ownPackage = extractJvmPackage(content, false);
  if (ownPackage) imports.push(jvmPackageEdge(filePath, ownPackage));

  const exports: ExportedSymbol[] = Array.from(exportNames, ([name, signature]) => ({
    name,
    signature,
  }));

  const category = classifyJvm(
    filePath,
    imports.map((edge) => edge.rawSpecifier),
    {
      typeNames: [...exportNames.keys()],
      annotations: scanJvmClassifyHints(content).annotations,
    },
  );

  let rawCallEdges: RawCallEdge[] | undefined;
  let complexityResult: ReturnType<typeof computeComplexity> | undefined;
  let functions: ReturnType<typeof collectFunctionComplexity> | undefined;
  try {
    const isScript = filePath.endsWith(".kts");
    const tree = (isScript ? kotlinScriptParser : kotlinParser).parse(content);
    if (errorRatio(tree, content) <= ERROR_RATIO_THRESHOLD) {
      complexityResult = computeComplexity(tree.topNode, content);
      functions = collectFunctionComplexity(tree, content);
      if (isScript) {
        // A script's statements live outside any `fun`; attribute them to one synthetic entry.
        functions = [
          {
            name: SCRIPT_FUNCTION_NAME,
            line: 1,
            complexity: complexityResult.complexity,
            cognitiveComplexity: complexityResult.cognitiveComplexity,
          },
          ...functions,
        ];
      }
      if (CALL_EDGES_ENABLED && category !== "test") {
        rawCallEdges = collectCallEdges(tree, content, localNames, ownPackage);
      }
    }
  } catch {
    // Grammar parse failure — degrade to the regex-only result, exactly as before the grammar.
  }

  const description = extractLeadingDoc(content);

  return {
    imports,
    exports,
    ...(description ? { description } : {}),
    tags: Array.from(tags).map((name) => ({ name, kind: "comment-marker" as const })),
    category,
    ...(rawCallEdges && rawCallEdges.length > 0 ? { rawCallEdges } : {}),
    ...(complexityResult ?? {}),
    ...(functions && functions.length > 0 ? { functions } : {}),
  };
}
