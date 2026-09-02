/** Hand-rolled Groovy scanner: reads `package` / `import` lines and top-level declarations. Groovy's import grammar mirrors Java's. No AST library (`@lezer/groovy` does not exist). */

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

/** `import a.b.C`, `import a.b.*`, `import static a.b.C.*`, `import static a.b.C.NAME`, `import a.b.C as D`. */
const IMPORT_RE = /^\s*import\s+(static\s+)?([\w.]+(?:\.\*)?)(?:\s+as\s+\w+)?\s*$/;

/** Top-level type / method declaration whose name is an export, anchored at column 0. */
const DECL_RE =
  /^(?:@\w+\s+)*(?:public\s+|private\s+|protected\s+|final\s+|abstract\s+|static\s+)*(class|interface|trait|enum|def)\s+([A-Za-z_][A-Za-z0-9_]*)/;

/**
 * @description Normalises a Groovy import specifier to the FQN the resolver should act on.
 *   For `import static a.b.C.NAME` the trailing member is dropped so the specifier names the
 *   enclosing type; `import static a.b.C.*` keeps `a.b.C` (the `*` targets members, not a
 *   package).
 * @param isStatic - Whether the `static` keyword was present.
 * @param raw - The captured dotted path, possibly ending in `.*`.
 * @returns The specifier to put on the import edge, or `null` if nothing usable remains.
 */
function normaliseSpecifier(isStatic: boolean, raw: string): string | null {
  if (!isStatic) return raw || null;
  if (raw.endsWith(".*")) return raw.slice(0, -2) || null;
  return raw.split(".").slice(0, -1).join(".") || null;
}

/**
 * @description Parses a Groovy source file with a line scanner. Emits one external
 *   `ImportEdge` per `import` line, collects top-level `class` / `interface` / `trait` /
 *   `enum` / `def` names as exports, and reads `// @tag name` markers. `.gradle` build scripts
 *   parse here but are classified `config` by {@link classifyJvm}.
 * @param filePath - Path to the `.groovy` / `.gradle` file; used for classification.
 * @param content - Raw Groovy source text.
 * @returns Parsed imports, exports, comment-marker tags, and resolved category.
 */
export function parseGroovy(filePath: string, content: string): ParseResult {
  const tags = scanTagMarkers(content);
  const source = stripJvmComments(content);
  const lines = source.split("\n");

  const imports: ImportEdge[] = [];
  const exportNames = new Set<string>();

  for (const line of lines) {
    const imp = line.match(IMPORT_RE);
    if (imp?.[2]) {
      const specifier = normaliseSpecifier(Boolean(imp[1]), imp[2]);
      if (specifier) imports.push(jvmImportEdge(filePath, specifier));
      continue;
    }
    const decl = line.match(DECL_RE);
    if (decl?.[2]) exportNames.add(decl[2]);
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
