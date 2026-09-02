/** Parses Java source files using the Lezer Java grammar to extract import edges, exported top-level types, and @tag comment markers. */

import type { SyntaxNode } from "@lezer/common";
import { parser } from "@lezer/java";
import type { ExportedSymbol, ImportEdge } from "../../types/node";
import type { NodeCategory } from "../../types/parse";
import type { ParseResult } from "../types";
import { extractJvmPackage, jvmPackageEdge } from "./jvm-scan";

const TAG_RE = /\/\/\s*@tag\s+([a-zA-Z0-9_-]+)/;

/** Import roots that mark a file as a test regardless of its path. */
const TEST_IMPORT_PREFIXES = ["org.junit", "androidx.test", "org.robolectric", "org.mockito"];

/**
 * @description Decides a Java file's category from its path and imports. Files under a
 *   `src/test/` or `src/androidTest/` source set, or importing a known test framework, are
 *   `"test"`; everything else is `"logic"`.
 * @param filePath - Path to the `.java` file (used for source-set convention matching).
 * @param importSpecifiers - Raw FQN specifiers extracted from the file's `import` lines.
 * @returns The resolved node category.
 */
function classifyJava(filePath: string, importSpecifiers: string[]): NodeCategory {
  const normalized = filePath.replace(/\\/g, "/");
  if (/\/src\/(test|androidTest|integrationTest)\//.test(normalized)) return "test";
  if (
    importSpecifiers.some((spec) =>
      TEST_IMPORT_PREFIXES.some((prefix) => spec === prefix || spec.startsWith(`${prefix}.`)),
    )
  ) {
    return "test";
  }
  return "logic";
}

/**
 * @description Reads an `ImportDeclaration` node and returns the FQN specifier the resolver
 *   should act on, plus whether it is a wildcard (package-level) import.
 *
 *   - `import a.b.C;` → `{ specifier: "a.b.C", wildcard: false }`
 *   - `import a.b.*;` → `{ specifier: "a.b.*", wildcard: true }`
 *   - `import static a.b.C.MAX;` → `{ specifier: "a.b.C", wildcard: false }` (last segment is a
 *     member, dropped so the specifier names the enclosing type)
 *   - `import static a.b.C.*;` → `{ specifier: "a.b.C", wildcard: false }` (the `ScopedIdentifier`
 *     already names the type; the `*` targets its members, not a package)
 * @param node - The `ImportDeclaration` syntax node.
 * @param source - Full file source text.
 * @returns The specifier and wildcard flag, or `null` when no identifier could be read.
 */
function readImport(
  node: SyntaxNode,
  source: string,
): { specifier: string; wildcard: boolean } | null {
  const scoped = node.getChild("ScopedIdentifier");
  if (!scoped) return null;

  const isStatic = node.getChild("static") != null;
  const hasAsterisk = node.getChild("Asterisk") != null;
  let specifier = source.slice(scoped.from, scoped.to);

  if (isStatic) {
    // `a.b.C.MAX` → `a.b.C`; `a.b.C` (from `import static a.b.C.*`) → unchanged.
    if (!hasAsterisk) specifier = specifier.split(".").slice(0, -1).join(".");
    return specifier ? { specifier, wildcard: false } : null;
  }

  if (hasAsterisk) return { specifier: `${specifier}.*`, wildcard: true };
  return { specifier, wildcard: false };
}

/**
 * @description Parses a Java source file via the Lezer Java grammar. Extracts every `import`
 *   (all marked external — FQN→file resolution is deferred to `JvmLangResolver`), the file's
 *   own `package` declaration is not emitted as an edge, top-level `class` / `interface` /
 *   `enum` names as exports, and `// @tag name` comment markers.
 * @param filePath - Path to the `.java` file; used for test-file classification.
 * @param content - Raw Java source text.
 * @returns Parsed imports, exports, comment-marker tags, and resolved category.
 */
export function parseJava(filePath: string, content: string): ParseResult {
  const imports: ImportEdge[] = [];
  const exportMap = new Map<string, ExportedSymbol>();
  const tags = new Set<string>();

  let tree: ReturnType<typeof parser.parse>;
  try {
    tree = parser.parse(content);
  } catch {
    return { imports: [], exports: [], tags: [], category: classifyJava(filePath, []) };
  }

  const cursor = tree.cursor();
  do {
    switch (cursor.name) {
      case "LineComment": {
        const match = content.slice(cursor.from, cursor.to).match(TAG_RE);
        if (match?.[1]) tags.add(match[1]);
        break;
      }
      case "ImportDeclaration": {
        const parsed = readImport(cursor.node, content);
        if (parsed) {
          imports.push({
            fromPath: filePath,
            toPath: "",
            rawSpecifier: parsed.specifier,
            isExternal: true,
            isStyle: false,
            type: "static",
          });
        }
        break;
      }
      case "ClassDeclaration":
      case "InterfaceDeclaration":
      case "EnumDeclaration":
      case "AnnotationTypeDeclaration": {
        // Only top-level type declarations count as exports; a nested type's parent chain
        // passes through another *Body node before reaching Program.
        if (cursor.node.parent?.name === "Program") {
          const nameNode = cursor.node.getChild("Definition");
          if (nameNode) {
            const name = content.slice(nameNode.from, nameNode.to);
            if (!exportMap.has(name)) exportMap.set(name, { name });
          }
        }
        break;
      }
    }
  } while (cursor.next());

  const ownPackage = extractJvmPackage(content, false);
  if (ownPackage) imports.push(jvmPackageEdge(filePath, ownPackage));

  return {
    imports,
    exports: Array.from(exportMap.values()),
    tags: Array.from(tags).map((name) => ({ name, kind: "comment-marker" as const })),
    category: classifyJava(
      filePath,
      imports.map((edge) => edge.rawSpecifier),
    ),
  };
}
