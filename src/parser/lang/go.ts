import path from "node:path";
import { parser } from "@lezer/go";
import type { ExportedSymbol, ImportEdge } from "../../types/node";
import type { ParseResult } from "../types";

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

  const tree = parser.parse(content);
  const cursor = tree.cursor();

  do {
    switch (cursor.name) {
      case "LineComment": {
        const text = content.slice(cursor.from, cursor.to);
        const tagM = text.match(TAG_RE);
        if (tagM?.[1]) tags.add(tagM[1]);

        const newBuild = text.match(BUILD_NEW_RE);
        if (newBuild) extractBuildTokens(newBuild[1]!, buildTags);

        const oldBuild = text.match(BUILD_OLD_RE);
        if (oldBuild) extractBuildTokens(oldBuild[1]!, buildTags);
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
        }
        break;
      }

      case "FunctionDecl":
      case "TypeDecl":
      case "VarDecl":
      case "ConstDecl": {
        // For FunctionDecl the DefName is a direct child.
        // For TypeDecl the DefName lives inside TypeSpec.
        // For VarDecl/ConstDecl the DefName lives inside VarSpec/ConstSpec.
        const nameNode =
          cursor.node.getChild("DefName") ??
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

  const importsTestingPkg = imports.some((i) => i.rawSpecifier === "testing");
  const category =
    path.basename(filePath).endsWith("_test.go") || tags.has("test") || importsTestingPkg
      ? "test"
      : "logic";

  const allTagNames = new Set([...tags, ...buildTags]);
  return {
    imports,
    exports: Array.from(exportMap.values()),
    tags: Array.from(allTagNames).map((name) => ({ name, kind: "comment-marker" as const })),
    category,
  };
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
