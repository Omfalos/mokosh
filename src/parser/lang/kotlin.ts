/** Hand-rolled Kotlin scanner: reads `package` / `import` lines and top-level declarations. No AST library (`@lezer/kotlin` does not exist). */

import type { ExportedSymbol, ImportEdge } from "../../types/node";
import type { ParseResult } from "../types";
import {
  classifyJvm,
  extractJvmPackage,
  jvmImportEdge,
  jvmPackageEdge,
  scanJvmClassifyHints,
  scanTagMarkers,
  stripJvmComments,
} from "./jvm-scan";

/** `import a.b.C`, `import a.b.*`, `import a.b.C as D` — the trailing `as <alias>` is dropped. */
const IMPORT_RE = /^\s*import\s+([\w.]+(?:\.\*)?)(?:\s+as\s+\w+)?\s*$/;

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
 *   exports, and reads `// @tag name` markers.
 * @param filePath - Path to the `.kt` / `.kts` file; used for test-file classification.
 * @param content - Raw Kotlin source text.
 * @returns Parsed imports, exports, comment-marker tags, and resolved category.
 */
export function parseKotlin(filePath: string, content: string): ParseResult {
  const tags = scanTagMarkers(content);
  const source = stripJvmComments(content);
  const lines = source.split("\n");

  const imports: ImportEdge[] = [];
  const exportNames = new Set<string>();

  for (const line of lines) {
    const imp = line.match(IMPORT_RE);
    if (imp?.[1]) {
      imports.push(jvmImportEdge(filePath, imp[1]));
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

  return {
    imports,
    exports,
    tags: Array.from(tags).map((name) => ({ name, kind: "comment-marker" as const })),
    category: classifyJvm(
      filePath,
      imports.map((edge) => edge.rawSpecifier),
      {
        typeNames: [...exportNames],
        annotations: scanJvmClassifyHints(content).annotations,
      },
    ),
  };
}
