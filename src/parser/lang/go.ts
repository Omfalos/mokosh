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
 * @description Parses a Go source file using the Lezer Go grammar to extract import edges,
 *   exported symbols, `// @tag` comment markers, and file category. All imports are marked
 *   external — local package resolution requires `go.mod` context not available at parse time.
 * @param {string} filePath - Path to the `.go` file; used for test-file classification by basename convention.
 * @param {string} content - Raw Go source text.
 * @returns {ParseResult} Parsed imports, top-level exports, comment-marker tags, and resolved category.
 */
export function parseGo(filePath: string, content: string): ParseResult {
  const imports: ImportEdge[] = [];
  const exportMap = new Map<string, ExportedSymbol>();
  const tags = new Set<string>();
  const buildTags = new Set<string>();
  const packageIdents = new Map<string, string>();

  const tree = parser.parse(content);
  const cursor = tree.cursor();

  do {
    switch (cursor.name) {
      case "LineComment": {
        const text = content.slice(cursor.from, cursor.to);
        const tagM = text.match(TAG_RE);
        if (tagM?.[1]) tags.add(tagM[1]);

        const newBuild = text.match(BUILD_NEW_RE);
        if (newBuild) extractBuildTokens(newBuild[1] as string, buildTags);

        const oldBuild = text.match(BUILD_OLD_RE);
        if (oldBuild) extractBuildTokens(oldBuild[1] as string, buildTags);
        break;
      }

      case "ImportSpec": {
        // ImportSpec: DefName? String
        // The String child always holds the quoted import path.
        const stringNode = cursor.node.getChild("String");
        if (stringNode) {
          const raw = content.slice(stringNode.from, stringNode.to);
          // Strip surrounding double-quotes
          const specifier = raw.slice(1, -1);
          imports.push({
            fromPath: filePath,
            toPath: "",
            rawSpecifier: specifier,
            isExternal: true,
            isStyle: false,
            type: "static",
          });

          // Track the identifier code uses to reference this package: an explicit alias
          // (DefName), or — absent one — the conventional last path segment.
          const aliasNode = cursor.node.getChild("DefName");
          const ident = aliasNode
            ? content.slice(aliasNode.from, aliasNode.to)
            : specifier.split("/").pop();
          if (ident && ident !== "_" && ident !== ".") packageIdents.set(ident, specifier);
        }
        break;
      }

      case "FunctionDecl":
      case "MethodDecl":
      case "TypeDecl":
      case "VarDecl":
      case "ConstDecl": {
        // For FunctionDecl the DefName is a direct child.
        // For MethodDecl the receiver name is a direct child too, so match FieldName instead.
        // For TypeDecl the DefName lives inside TypeSpec.
        // For VarDecl/ConstDecl the DefName lives inside VarSpec/ConstSpec.
        const nameNode =
          cursor.node.getChild("DefName") ??
          cursor.node.getChild("FieldName") ??
          cursor.node.getChild("TypeSpec")?.getChild("DefName") ??
          cursor.node.getChild("VarSpec")?.getChild("DefName") ??
          cursor.node.getChild("ConstSpec")?.getChild("DefName");

        if (nameNode) {
          const name = content.slice(nameNode.from, nameNode.to);
          // Go export rule: identifier starts with an uppercase letter
          if (name !== "_" && /^[A-Z]/.test(name) && !exportMap.has(name)) {
            exportMap.set(name, { name });
          }
        }
        break;
      }
    }
  } while (cursor.next());

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
