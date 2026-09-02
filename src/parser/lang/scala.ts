/** Hand-rolled Scala scanner: reads `import` clauses (incl. brace groups, renames, Scala 2/3 wildcards) and top-level type declarations. No AST library (`@lezer/scala` does not exist). */

import type { ExportedSymbol, ImportEdge } from "../../types/node";
import type { ParseResult } from "../types";
import {
  classifyJvm,
  extractJvmPackage,
  jvmImportEdge,
  jvmPackageEdge,
  scanTagMarkers,
  stripJvmComments,
} from "./jvm-scan";

/** Any line introducing one or more imports. Scala allows block-scoped imports, so every line is scanned. */
const IMPORT_LINE_RE = /^\s*import\s+(.+?)\s*$/;

/** Top-level type declaration whose name is an export, anchored at column 0. */
const DECL_RE =
  /^(?:@\w+\s+)*(?:private\s+|protected\s+|final\s+|sealed\s+|abstract\s+|implicit\s+|case\s+)*(class|trait|object|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/;

/**
 * @description Turns one member of a brace group (`import a.b.{ ... }`) into a specifier
 *   suffix. `X => Y` and `X => _` resolve on `X`; `_`, `*`, and `given` are package wildcards.
 * @param prefix - The dotted package prefix (no trailing dot), e.g. `a.b`.
 * @param member - One raw, trimmed member from inside the braces.
 * @returns A fully-qualified specifier, or `null` to skip.
 */
function memberToSpecifier(prefix: string, member: string): string | null {
  const name = member.split("=>")[0]?.trim();
  if (!name) return null;
  if (name === "_" || name === "*" || name === "given") return `${prefix}.*`;
  return `${prefix}.${name}`;
}

/**
 * @description Parses one Scala import clause (the text after `import`) into zero or more
 *   fully-qualified specifiers.
 *
 *   - `a.b.C` → `["a.b.C"]`
 *   - `a.b.C as D` / `a.b.{C => D}` → `["a.b.C"]`
 *   - `a.b._` (Scala 2) / `a.b.*` (Scala 3) / `a.b.given` → `["a.b.*"]`
 *   - `a.b.{C, D, E}` → `["a.b.C", "a.b.D", "a.b.E"]`
 *   - `a.b.C, x.y.Z` (Scala 3 multi-import) → `["a.b.C", "x.y.Z"]`
 * @param clause - Trimmed text following the `import` keyword.
 * @returns The resolved specifiers.
 */
export function parseScalaImportClause(clause: string): string[] {
  const braceStart = clause.indexOf("{");
  if (braceStart !== -1) {
    const braceEnd = clause.indexOf("}", braceStart);
    const prefix = clause.slice(0, braceStart).trim().replace(/\.$/, "");
    const body = clause.slice(braceStart + 1, braceEnd === -1 ? undefined : braceEnd);
    if (!prefix) return [];
    return body
      .split(",")
      .map((member) => memberToSpecifier(prefix, member.trim()))
      .filter((spec): spec is string => spec != null);
  }

  const specifiers: string[] = [];
  for (const rawPart of clause.split(",")) {
    const part = rawPart.trim().replace(/\s+as\s+\w+$/, "");
    if (!part) continue;
    if (part.endsWith("._") || part.endsWith(".*") || part.endsWith(".given")) {
      const pkg = part.replace(/\.(_|\*|given)$/, "");
      if (pkg) specifiers.push(`${pkg}.*`);
    } else {
      specifiers.push(part);
    }
  }
  return specifiers;
}

/**
 * @description Parses a Scala source file with a line scanner. Emits one external `ImportEdge`
 *   per resolved import specifier (brace groups expanded to one edge per member), collects
 *   top-level `class` / `object` / `trait` / `type` / `enum` names as exports, and reads
 *   `// @tag name` markers.
 * @param filePath - Path to the `.scala` / `.sc` file; used for test-file classification.
 * @param content - Raw Scala source text.
 * @returns Parsed imports, exports, comment-marker tags, and resolved category.
 */
export function parseScala(filePath: string, content: string): ParseResult {
  const tags = scanTagMarkers(content);
  const source = stripJvmComments(content);
  const lines = source.split("\n");

  const imports: ImportEdge[] = [];
  const exportNames = new Set<string>();

  for (const line of lines) {
    const imp = line.match(IMPORT_LINE_RE);
    if (imp?.[1]) {
      for (const specifier of parseScalaImportClause(imp[1])) {
        imports.push(jvmImportEdge(filePath, specifier));
      }
      continue;
    }
    const decl = line.match(DECL_RE);
    if (decl?.[2]) exportNames.add(decl[2]);
  }

  const ownPackage = extractJvmPackage(content, true);
  if (ownPackage) imports.push(jvmPackageEdge(filePath, ownPackage));

  const exports: ExportedSymbol[] = Array.from(exportNames, (name) => ({ name }));

  return {
    imports,
    exports,
    tags: Array.from(tags).map((name) => ({ name, kind: "comment-marker" as const })),
    category: classifyJvm(
      filePath,
      imports.map((edge) => edge.rawSpecifier),
    ),
  };
}
