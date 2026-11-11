/** Parses Go source files using the Lezer parser to extract import paths and tag annotations. */

import path from "node:path";
import type { SyntaxNode, Tree } from "@lezer/common";
import { parser } from "@lezer/go";
import type { ExportedSymbol, ImportEdge } from "../../types/node";
import { collectFunctionComplexity, computeComplexity, receiverTypeName } from "../complexity/go";
import type { ParseResult, RawCallEdge } from "../types";

const TAG_RE = /\/\/\s*@tag\s+([a-zA-Z0-9_-]+)/;
const BUILD_NEW_RE = /^\/\/go:build\s+(.+)$/;
const BUILD_OLD_RE = /^\/\/\s*\+build\s+(.+)$/;

/**
 * Sentinel `rawSpecifier` for the synthetic same-package edge every Go file gets (see
 * {@link goSamePackageEdge}). A null-byte prefix guarantees no real Go import path can ever
 * collide with it. `GoLangResolver` recognizes this sentinel and expands it to every other
 * non-test `.go` file in the importing file's own directory.
 */
export const GO_SAME_PACKAGE_SPECIFIER = "\0go-same-package";

/**
 * @description Builds the synthetic same-package edge every Go source file gets in addition to
 *   its explicit imports. Unlike JVM/Kotlin/Scala/Java, a Go package's scope is exactly "the
 *   other non-test `.go` files in this same directory" — no cross-directory package-name lookup
 *   is needed, so this only needs the file's own path, resolved lazily by
 *   `GoLangResolver.resolve()` via `path.dirname(currentFile)`. Without this edge, files in the
 *   same package that reference each other's types/functions with no `import` line (normal Go —
 *   sibling files in one package compile together) are invisible to blast-radius analysis and
 *   `find_unused` wrongly flags them as unreachable.
 * @param filePath - Path of the file that owns the package.
 * @returns The synthetic import edge.
 */
function goSamePackageEdge(filePath: string): ImportEdge {
  return {
    fromPath: filePath,
    toPath: "",
    rawSpecifier: GO_SAME_PACKAGE_SPECIFIER,
    isExternal: true,
    isStyle: false,
    type: "side-effect",
    isSamePackage: true,
  };
}

/** Mutable accumulator filled while walking a Go syntax tree. */
interface GoScan {
  imports: ImportEdge[];
  exportMap: Map<string, ExportedSymbol>;
  tags: Set<string>;
  buildTags: Set<string>;
  /** Identifier code uses for a package (alias or last path segment) → raw import specifier. */
  packageIdents: Map<string, string>;
}

/**
 * @description Records `// @tag x` markers and `//go:build` / `// +build` constraint tokens.
 * @param {string} text - The comment's source text.
 * @param {GoScan} acc - Accumulator; `tags` and `buildTags` are mutated.
 */
function scanLineComment(text: string, acc: GoScan): void {
  const tagM = text.match(TAG_RE);
  if (tagM?.[1]) acc.tags.add(tagM[1]);

  const newBuild = text.match(BUILD_NEW_RE);
  if (newBuild) extractBuildTokens(newBuild[1] as string, acc.buildTags);

  const oldBuild = text.match(BUILD_OLD_RE);
  if (oldBuild) extractBuildTokens(oldBuild[1] as string, acc.buildTags);
}

/**
 * @description Records one import (`ImportSpec: DefName? String`) and the identifier code uses to
 *   reference the package: an explicit alias, or — absent one — the last path segment.
 * @param {SyntaxNode} node - The `ImportSpec` node.
 * @param {string} filePath - Path of the importing file.
 * @param {string} content - Full source text.
 * @param {GoScan} acc - Accumulator; `imports` and `packageIdents` are mutated.
 */
function scanImportSpec(node: SyntaxNode, filePath: string, content: string, acc: GoScan): void {
  const stringNode = node.getChild("String");
  if (!stringNode) return;
  // Strip the surrounding double-quotes.
  const specifier = content.slice(stringNode.from, stringNode.to).slice(1, -1);
  acc.imports.push({
    fromPath: filePath,
    toPath: "",
    rawSpecifier: specifier,
    isExternal: true,
    isStyle: false,
    type: "static",
  });
  const aliasNode = node.getChild("DefName");
  const ident = aliasNode
    ? content.slice(aliasNode.from, aliasNode.to)
    : specifier.split("/").pop();
  if (ident && ident !== "_" && ident !== ".") acc.packageIdents.set(ident, specifier);
}

/**
 * @description Records a top-level declaration's name as an export when it starts uppercase (the
 *   Go export rule). For FunctionDecl the DefName is a direct child; for MethodDecl the receiver
 *   name is a direct child too, so FieldName is matched instead; for TypeDecl the DefName lives
 *   inside TypeSpec, and for VarDecl/ConstDecl inside VarSpec/ConstSpec.
 * @param {SyntaxNode} node - The declaration node.
 * @param {string} content - Full source text.
 * @param {GoScan} acc - Accumulator; `exportMap` is mutated.
 */
function scanDeclaration(node: SyntaxNode, content: string, acc: GoScan): void {
  const nameNode =
    node.getChild("DefName") ??
    node.getChild("FieldName") ??
    node.getChild("TypeSpec")?.getChild("DefName") ??
    node.getChild("VarSpec")?.getChild("DefName") ??
    node.getChild("ConstSpec")?.getChild("DefName");
  if (!nameNode) return;
  const name = content.slice(nameNode.from, nameNode.to);
  if (name !== "_" && /^[A-Z]/.test(name) && !acc.exportMap.has(name)) {
    acc.exportMap.set(name, { name });
  }
}

/**
 * @description Parses a Go source file using the Lezer Go grammar to extract import edges,
 *   exported symbols, `// @tag` comment markers, and file category. All imports are marked
 *   external — local package resolution requires `go.mod` context not available at parse time.
 * @param {string} filePath - Path to the `.go` file; used for test-file classification by basename convention.
 * @param {string} content - Raw Go source text.
 * @returns {ParseResult} Parsed imports, top-level exports, comment-marker tags, and resolved category.
 */
export function parseGo(filePath: string, content: string): ParseResult {
  const acc: GoScan = {
    imports: [],
    exportMap: new Map(),
    tags: new Set(),
    buildTags: new Set(),
    packageIdents: new Map(),
  };
  const { imports, exportMap, tags, buildTags, packageIdents } = acc;

  const tree = parser.parse(content);
  const cursor = tree.cursor();

  do {
    switch (cursor.name) {
      case "LineComment":
        scanLineComment(content.slice(cursor.from, cursor.to), acc);
        break;
      case "ImportSpec":
        scanImportSpec(cursor.node, filePath, content, acc);
        break;
      case "FunctionDecl":
      case "MethodDecl":
      case "TypeDecl":
      case "VarDecl":
      case "ConstDecl":
        scanDeclaration(cursor.node, content, acc);
        break;
    }
  } while (cursor.next());

  imports.push(goSamePackageEdge(filePath));

  const importsTestingPkg = imports.some((importEdge) => importEdge.rawSpecifier === "testing");
  const category =
    path.basename(filePath).endsWith("_test.go") || tags.has("test") || importsTestingPkg
      ? "test"
      : "logic";

  const allTagNames = new Set([...tags, ...buildTags]);
  const { complexity, cognitiveComplexity } = computeComplexity(tree.topNode, content);
  const functions = collectFunctionComplexity(tree, content);
  const rawCallEdges = category === "test" ? [] : collectRawCallEdges(tree, content, packageIdents);

  return {
    imports,
    exports: Array.from(exportMap.values()),
    tags: Array.from(allTagNames).map((name) => ({ name, kind: "comment-marker" as const })),
    category,
    rawCallEdges,
    complexity,
    cognitiveComplexity,
    ...(functions.length > 0 ? { functions } : {}),
  };
}

/**
 * @description Walks every top-level exported `FunctionDecl` and every `MethodDecl` (regardless
 *   of export — a receiver always names the enclosing type, mirroring how the TS parser tracks
 *   class methods regardless of their own visibility), recording a `RawCallEdge` for each call to
 *   a package-qualified function (`pkg.Func()`) where `pkg` resolves to a tracked import.
 *   Unqualified calls (to same-file functions) are not cross-file dependencies and are skipped.
 * @param {Tree} tree - The parsed @lezer/go tree.
 * @param {string} content - Full source text.
 * @param {Map<string, string>} packageIdents - Maps the identifier code uses for a package
 *   (alias or default last-path-segment) to its raw import specifier.
 * @returns {RawCallEdge[]} One edge per package-qualified call to a known imported package.
 */
function collectRawCallEdges(
  tree: Tree,
  content: string,
  packageIdents: Map<string, string>,
): RawCallEdge[] {
  const edges: RawCallEdge[] = [];

  function walkBody(node: SyntaxNode, callerName: string): void {
    if (node.type.name === "CallExpr") {
      const callee = node.firstChild;
      if (callee?.type.name === "SelectorExpr") {
        const pkgIdentNode = callee.firstChild;
        const fieldNode = callee.getChild("FieldName");
        if (pkgIdentNode?.type.name === "VariableName" && fieldNode) {
          const pkgIdent = content.slice(pkgIdentNode.from, pkgIdentNode.to);
          const toSpecifier = packageIdents.get(pkgIdent);
          if (toSpecifier) {
            const to = content.slice(fieldNode.from, fieldNode.to);
            edges.push({ from: callerName, to, toSpecifier });
          }
        }
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
    if (cursor.name === "FunctionDecl") {
      const nameNode = cursor.node.getChild("DefName");
      const body = cursor.node.getChild("Block");
      if (nameNode && body) {
        const name = content.slice(nameNode.from, nameNode.to);
        if (/^[A-Z]/.test(name)) walkBody(body, name);
      }
    } else if (cursor.name === "MethodDecl") {
      const fieldNode = cursor.node.getChild("FieldName");
      const body = cursor.node.getChild("Block");
      if (fieldNode && body) {
        const methodName = content.slice(fieldNode.from, fieldNode.to);
        const receiver = receiverTypeName(cursor.node, content);
        walkBody(body, receiver ? `${receiver}.${methodName}` : methodName);
      }
    }
  } while (cursor.next());

  return edges;
}

/**
 * @description Extracts individual identifier tokens from a Go build constraint expression.
 *   Splits on operators and punctuation, strips leading `!`, discards the pseudo-tag `ignore`.
 * @param {string} expr - Raw expression text after `//go:build` or `// +build`.
 * @param {Set<string>} out - Set to populate with extracted tag names.
 */
function extractBuildTokens(expr: string, out: Set<string>): void {
  for (const tok of expr.split(/[\s,&|!()]+/)) {
    const name = tok.trim();
    if (name && name !== "ignore") out.add(name);
  }
}
