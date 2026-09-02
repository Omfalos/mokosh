/** Parses Java source files using the Lezer Java grammar to extract import edges, exported
 *  top-level types, `@tag` comment markers, per-method complexity, and call edges. */

import type { SyntaxNode, Tree } from "@lezer/common";
import { parser } from "@lezer/java";
import type { ExportedSymbol, ImportEdge } from "../../types/node";
import {
  collectFunctionComplexity,
  computeComplexity,
  enclosingTypeName,
} from "../complexity/java";
import type { ParseResult, RawCallEdge } from "../types";
import { classifyJvm, extractJvmPackage, jvmPackageEdge } from "./jvm-scan";

const TAG_RE = /\/\/\s*@tag\s+([a-zA-Z0-9_-]+)/;

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
 * @description Maps each concrete (non-wildcard) `import a.b.C;` to `{ C → a.b.C }` so a
 *   simple type name used in the body can be resolved back to a fully-qualified specifier the
 *   `JvmLangResolver` understands.
 * @param imports - The file's collected import edges.
 * @returns Simple-name → FQN specifier lookup.
 */
function importedTypeMap(imports: ImportEdge[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const edge of imports) {
    if (edge.type === "side-effect") continue;
    const spec = edge.rawSpecifier;
    if (spec.endsWith(".*")) continue;
    const simple = spec.split(".").pop();
    if (simple) map.set(simple, spec);
  }
  return map;
}

/**
 * @description Walks every `MethodDeclaration` / `ConstructorDeclaration` body and records a
 *   `RawCallEdge` for each **static method call** (`Foo.bar()` where `Foo` is an imported type)
 *   and each **constructor call** (`new Foo(...)` where `Foo` is imported). Instance calls
 *   through a variable or field (`this.x.bar()`) need type inference and are not captured — the
 *   same class of gap as Go's unqualified-call limitation (see docs/adr-017-jvm-languages.md).
 * @param tree - The parsed @lezer/java tree.
 * @param content - Full source text.
 * @param importedTypes - Simple-name → FQN map from {@link importedTypeMap}.
 * @returns One edge per resolvable static or constructor call to a known imported type.
 */
function collectRawCallEdges(
  tree: Tree,
  content: string,
  importedTypes: Map<string, string>,
): RawCallEdge[] {
  const edges: RawCallEdge[] = [];

  function walkBody(node: SyntaxNode, callerName: string): void {
    const name = node.type.name;
    if (name === "MethodInvocation") {
      const qualifier = node.firstChild;
      if (qualifier?.type.name === "Identifier") {
        const toSpecifier = importedTypes.get(content.slice(qualifier.from, qualifier.to));
        const methodNode = node.getChild("MethodName");
        if (toSpecifier && methodNode) {
          edges.push({
            from: callerName,
            to: content.slice(methodNode.from, methodNode.to),
            toSpecifier,
          });
        }
      }
    } else if (name === "ObjectCreationExpression") {
      const typeNode = node.getChild("TypeName");
      if (typeNode) {
        const toSpecifier = importedTypes.get(content.slice(typeNode.from, typeNode.to));
        if (toSpecifier) edges.push({ from: callerName, to: "new", toSpecifier });
      }
    }
    let child = node.firstChild;
    while (child) {
      walkBody(child, callerName);
      child = child.nextSibling;
    }
  }

  const cursor = tree.cursor();
  do {
    if (cursor.name === "MethodDeclaration" || cursor.name === "ConstructorDeclaration") {
      const nameNode = cursor.node.getChild("Definition");
      const body = cursor.node.getChild("Block") ?? cursor.node.getChild("ConstructorBody");
      if (nameNode && body) {
        const bare = content.slice(nameNode.from, nameNode.to);
        const owner = enclosingTypeName(cursor.node, content);
        const caller = owner && cursor.name === "MethodDeclaration" ? `${owner}.${bare}` : bare;
        walkBody(body, caller);
      }
    }
  } while (cursor.next());

  return edges;
}

/**
 * @description Parses a Java source file via the Lezer Java grammar. Extracts every `import`
 *   (all marked external — FQN→file resolution is deferred to `JvmLangResolver`), top-level
 *   `class` / `interface` / `enum` names as exports, `// @tag name` comment markers, per-method
 *   cyclomatic + cognitive complexity, and static/constructor call edges. The file's own
 *   `package` declaration is emitted as the synthetic same-package edge, not a normal import.
 * @param filePath - Path to the `.java` file; used for classification.
 * @param content - Raw Java source text.
 * @returns Parsed imports, exports, tags, category, complexity, and raw call edges.
 */
export function parseJava(filePath: string, content: string): ParseResult {
  const imports: ImportEdge[] = [];
  const exportMap = new Map<string, ExportedSymbol>();
  const tags = new Set<string>();
  const annotations = new Set<string>();

  let tree: Tree;
  try {
    tree = parser.parse(content);
  } catch {
    return { imports: [], exports: [], tags: [], category: classifyJvm(filePath, []) };
  }

  const cursor = tree.cursor();
  do {
    switch (cursor.name) {
      case "LineComment": {
        const match = content.slice(cursor.from, cursor.to).match(TAG_RE);
        if (match?.[1]) tags.add(match[1]);
        break;
      }
      case "MarkerAnnotation":
      case "Annotation": {
        const idNode = cursor.node.getChild("Identifier");
        if (idNode) annotations.add(content.slice(idNode.from, idNode.to));
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

  const category = classifyJvm(
    filePath,
    imports.map((edge) => edge.rawSpecifier),
    { typeNames: [...exportMap.keys()], annotations: [...annotations] },
  );

  const { complexity, cognitiveComplexity } = computeComplexity(tree.topNode, content);
  const functions = collectFunctionComplexity(tree, content);
  const rawCallEdges =
    category === "test" ? [] : collectRawCallEdges(tree, content, importedTypeMap(imports));

  return {
    imports,
    exports: Array.from(exportMap.values()),
    tags: Array.from(tags).map((name) => ({ name, kind: "comment-marker" as const })),
    category,
    rawCallEdges,
    complexity,
    cognitiveComplexity,
    ...(functions.length > 0 ? { functions } : {}),
  };
}
