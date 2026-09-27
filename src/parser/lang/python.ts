/** Parses Python source files using the Lezer parser to extract import edges, exports, and tag annotations. */
import path from "node:path";
import type { SyntaxNode, Tree } from "@lezer/common";
import { parser } from "@lezer/python";
import type { ExportedSymbol, ImportEdge } from "../../types/node";
import { collectFunctionComplexity, computeComplexity } from "../complexity/python";
import type { ParseResult, RawCallEdge } from "../types";

const TEST_LIBS = new Set(["pytest", "unittest", "nose", "hypothesis"]);

/**
 * @description Parses a Python source file using the Lezer parser to extract import edges,
 *   top-level definitions as exports, `# @tag` comment markers, and file category.
 * @param {string} filePath - Path to the `.py` file; used for test-file classification by basename convention.
 * @param {string} content - Raw Python source text.
 * @returns {ParseResult} Parsed imports, top-level exports, comment-marker tags, and resolved category.
 */
export function parsePython(filePath: string, content: string): ParseResult {
  const imports: ImportEdge[] = [];
  const exports: ExportedSymbol[] = [];
  const tags = new Set<string>();
  const baseName = path.basename(filePath).toLowerCase();

  const tree = parser.parse(content);
  const cursor = tree.cursor();

  do {
    switch (cursor.name) {
      case "Comment": {
        const tagMatch = content.slice(cursor.from, cursor.to).match(/#\s*@tag\s+([a-zA-Z0-9_-]+)/);
        if (tagMatch?.[1]) tags.add(tagMatch[1]);
        break;
      }
      case "ImportStatement": {
        for (const edge of extractImportEdges(cursor.node, content, filePath)) {
          imports.push(edge);
        }
        break;
      }
      case "FunctionDefinition":
      case "ClassDefinition": {
        // Only top-level — parent must be Script or a DecoratedStatement directly under Script
        const parentNode = cursor.node.parent;
        const isTopLevel =
          parentNode?.name === "Script" ||
          (parentNode?.name === "DecoratedStatement" && parentNode.parent?.name === "Script");
        if (isTopLevel) {
          const nameNode = cursor.node.getChild("VariableName");
          if (nameNode) exports.push({ name: content.slice(nameNode.from, nameNode.to) });
        }
        break;
      }

      case "AssignStatement": {
        // Only top-level simple assignments: `MY_VAR = value`
        if (cursor.node.parent?.name === "Script") {
          const target = cursor.node.firstChild;
          if (target?.name === "VariableName") {
            exports.push({ name: content.slice(target.from, target.to) });
          }
        }
        break;
      }
    }
  } while (cursor.next());

  const category = resolveCategory(baseName, imports, tags);
  if (category === "test") tags.add("test");

  const { complexity, cognitiveComplexity } = computeComplexity(tree.topNode);
  const functions = collectFunctionComplexity(tree, content);
  const rawCallEdges = category === "test" ? [] : collectRawCallEdges(tree, content);

  return {
    imports,
    exports,
    tags: Array.from(tags).map((name) => ({ name, kind: "comment-marker" as const })),
    category,
    rawCallEdges,
    complexity,
    cognitiveComplexity,
    ...(functions.length > 0 ? { functions } : {}),
  };
}

// ─── import edge extraction ───────────────────────────────────────────────────

/**
 * @description Dispatches a single Lezer `ImportStatement` node to the appropriate extractor
 *   based on whether it begins with `from` (from-import form) or not (bare import form).
 * @param {SyntaxNode} node - The `ImportStatement` AST node to process.
 * @param {string} src - Full source text, used to slice node ranges into strings.
 * @param {string} filePath - Source file path stamped onto each emitted edge.
 * @returns {ImportEdge[]} One or more import edges extracted from the statement.
 */
function extractImportEdges(node: SyntaxNode, src: string, filePath: string): ImportEdge[] {
  const first = node.firstChild;
  if (!first) return [];
  return first.name === "from"
    ? extractFromImport(node, src, filePath)
    : extractBareImport(node, src, filePath);
}

/**
 * Handles `from <module> import <names>` in all forms:
 *   absolute, relative (. / .. / ...), dotted module paths, star, aliases.
 */
function extractFromImport(node: SyntaxNode, src: string, filePath: string): ImportEdge[] {
  const fromKw = node.firstChild;
  if (!fromKw) return [];

  // Find the `import` keyword that splits module from names
  let importKw: SyntaxNode | null = fromKw.nextSibling;
  while (importKw && importKw.name !== "import") importKw = importKw.nextSibling;
  if (!importKw) return [];

  // Raw module text: everything between `from` end and `import` start.
  // e.g. " .models", " os.path", " .. ", " ...core.utils"
  const rawModule = src.slice(fromKw.to, importKw.from).trim();
  const importedNames = collectImportedNames(importKw.nextSibling, src);
  if (!importedNames.length) return [];

  // A re-export edge (see edgesForSpecifier) only signals a genuine public re-export at module
  // scope — a function-local `from .x import Y as Y` isn't part of the file's public API.
  const isTopLevel = node.parent?.name === "Script";

  // Split leading dots from the rest of the module path
  let dotCount = 0;
  while (dotCount < rawModule.length && rawModule[dotCount] === ".") dotCount++;
  const modulePart = rawModule.slice(dotCount); // e.g. "models", "core.utils", ""

  if (dotCount === 0) {
    // Absolute import: `from pathlib import Path`
    // Keep dotted module name as-is; resolver converts dots → path separators.
    return edgesForSpecifier(filePath, rawModule, importedNames, true, isTopLevel);
  }

  // n=1 → "./"  (current package)
  // n=2 → "../" (parent package)
  // n=3 → "../../" (grandparent)
  const prefix = dotCount === 1 ? "./" : "../".repeat(dotCount - 1);

  if (!modulePart) {
    // `from . import utils, models` — each name is its own sub-module.
    // `from . import *`            — edge to the package init.
    if (importedNames[0]?.name === "*") {
      return [makeEdge(filePath, prefix.slice(0, -1), ["*"], false)];
    }
    return importedNames.flatMap((name) =>
      edgesForSpecifier(filePath, prefix + name.name, [name], false, isTopLevel),
    );
  }

  // `from .models import User` → "./models"
  // `from .models.user import X` → "./models/user"
  return edgesForSpecifier(
    filePath,
    prefix + modulePart.replace(/\./g, "/"),
    importedNames,
    false,
    isTopLevel,
  );
}

/**
 * @description Builds one or two edges for a single specifier's imported names: a plain `static`
 *   edge for ordinarily-imported names, and — when `isTopLevel` and at least one name is an
 *   explicit self-aliased re-export (`from .x import Y as Y`, or `from . import y as y` for a
 *   sub-module) — a separate `type: "re-export"` edge carrying just those names. This is
 *   Python's conventional signal (also recognized by mypy) that a re-export is intentional, not
 *   just an import for internal use; PEP 484 requires the alias to exactly match the original
 *   name for that signal, so an ordinary `as OtherName` alias never qualifies.
 *
 *   The split lets `get_api_surface`'s existing re-export-following (`collectAccessibleSymbolNames`
 *   in `src/graph/api-surface.ts`, built for TypeScript's `export { foo } from "…"`) pick up
 *   Python's idiom for free — before this, `from .app import Flask as Flask` in an `__init__.py`
 *   was invisible to `get_api_surface` (ADR-002 covered only star-imports/re-exports; explicit
 *   same-name aliasing was untracked).
 * @param filePath - Path of the importing file.
 * @param specifier - Raw module specifier, already resolved to its dotted/relative form.
 * @param names - The names imported from this specifier, with their re-export flag.
 * @param isExternal - Whether the specifier is external (absolute, non-relative import).
 * @param isTopLevel - Whether the import statement is at module scope.
 * @returns One edge when no name is a top-level self-aliased re-export, otherwise two — one per
 *   edge type, so a caller reading `imp.type` never has to inspect individual symbols.
 */
function edgesForSpecifier(
  filePath: string,
  specifier: string,
  names: ImportedName[],
  isExternal: boolean,
  isTopLevel: boolean,
): ImportEdge[] {
  if (!isTopLevel) {
    return [
      makeEdge(
        filePath,
        specifier,
        names.map((n) => n.name),
        isExternal,
      ),
    ];
  }

  const reexported = names.filter((n) => n.isExplicitReexport).map((n) => n.name);
  const plain = names.filter((n) => !n.isExplicitReexport).map((n) => n.name);

  const edges: ImportEdge[] = [];
  if (plain.length > 0) edges.push(makeEdge(filePath, specifier, plain, isExternal));
  if (reexported.length > 0) {
    edges.push(makeEdge(filePath, specifier, reexported, isExternal, "re-export"));
  }
  return edges;
}

/**
 * Handles `import <module>` statements, including dotted paths and aliases.
 * `import os, sys` produces two edges; `import os.path as p` uses the original module name.
 */
function extractBareImport(node: SyntaxNode, src: string, filePath: string): ImportEdge[] {
  const edges: ImportEdge[] = [];
  let childNode: SyntaxNode | null = node.firstChild?.nextSibling ?? null; // skip "import" keyword

  while (childNode) {
    if (childNode.name === "VariableName") {
      // Collect possibly dotted module name: os + . + path → "os.path"
      let modName = src.slice(childNode.from, childNode.to);
      while (
        childNode.nextSibling?.name === "." &&
        childNode.nextSibling.nextSibling?.name === "VariableName"
      ) {
        childNode = childNode.nextSibling.nextSibling as SyntaxNode;
        modName += `.${src.slice(childNode.from, childNode.to)}`;
      }
      // Skip optional `as alias`
      if (childNode.nextSibling?.name === "as") {
        childNode = childNode.nextSibling.nextSibling ?? childNode.nextSibling;
      }
      edges.push(makeEdge(filePath, modName, ["*"], true));
    }
    childNode = childNode.nextSibling;
  }

  return edges;
}

/**
 * A single name bound by a `from <module> import <name> [as <alias>]` clause.
 */
interface ImportedName {
  name: string;
  /** True when explicitly aliased to itself (`Y as Y`) — see `edgesForSpecifier`. */
  isExplicitReexport: boolean;
}

/**
 * Walks the sibling chain after `import`, collecting each imported symbol's original (pre-alias)
 * name — matching the `ImportEdge.symbols` convention this parser has always used — plus whether
 * it carries a same-name `as` alias (the `Y as Y` re-export idiom; see `edgesForSpecifier`).
 */
function collectImportedNames(start: SyntaxNode | null, src: string): ImportedName[] {
  const names: ImportedName[] = [];
  let childNode: SyntaxNode | null = start;
  while (childNode) {
    if (childNode.name === "*") {
      names.push({ name: "*", isExplicitReexport: false });
    } else if (childNode.name === "VariableName") {
      const name = src.slice(childNode.from, childNode.to);
      let isExplicitReexport = false;
      // Check for an `as alias` and, if present, whether it's a same-name (re-export) alias
      if (childNode.nextSibling?.name === "as") {
        const aliasNode = childNode.nextSibling.nextSibling;
        if (aliasNode?.name === "VariableName") {
          isExplicitReexport = src.slice(aliasNode.from, aliasNode.to) === name;
        }
        childNode = childNode.nextSibling.nextSibling ?? childNode.nextSibling;
      }
      names.push({ name, isExplicitReexport });
    }
    childNode = childNode.nextSibling;
  }
  return names;
}

// ─── call-edge extraction ──────────────────────────────────────────────────────

/**
 * @description Builds a map from each name bound by a `from <module> import <name> [as alias]`
 *   statement to that module's raw specifier (mirroring the specifier computation in
 *   `extractFromImport`, including alias resolution and relative-import prefixing). Bare
 *   `import <module>` statements are not included: unqualified calls can't tell which bound
 *   module a member access like `module.func()` belongs to, so — matching the TS parser's
 *   documented exclusion of "calls through chained member access" — only directly named imports
 *   are tracked as callable symbols.
 * @param {Tree} tree - The parsed @lezer/python tree.
 * @param {string} content - Full source text.
 * @returns {Map<string, string>} Local (possibly aliased) name → raw import specifier.
 */
function buildImportSymbolMap(tree: Tree, content: string): Map<string, string> {
  const symbolMap = new Map<string, string>();
  const cursor = tree.cursor();

  do {
    if (cursor.name !== "ImportStatement") continue;
    const node = cursor.node;
    const fromKw = node.firstChild;
    if (fromKw?.type.name !== "from") continue;

    let importKw: SyntaxNode | null = fromKw.nextSibling;
    while (importKw && importKw.type.name !== "import") importKw = importKw.nextSibling;
    if (!importKw) continue;

    const rawModule = content.slice(fromKw.to, importKw.from).trim();
    let dotCount = 0;
    while (dotCount < rawModule.length && rawModule[dotCount] === ".") dotCount++;
    const modulePart = rawModule.slice(dotCount);
    const prefix = dotCount <= 1 ? "./" : "../".repeat(dotCount - 1);

    let child: SyntaxNode | null = importKw.nextSibling;
    while (child) {
      if (child.type.name === "VariableName") {
        const importedName = content.slice(child.from, child.to);
        let localName = importedName;
        if (child.nextSibling?.type.name === "as") {
          const aliasNode = child.nextSibling.nextSibling;
          if (aliasNode?.type.name === "VariableName") {
            localName = content.slice(aliasNode.from, aliasNode.to);
            child = aliasNode;
          }
        }
        const specifier =
          dotCount === 0
            ? rawModule
            : modulePart
              ? prefix + modulePart.replace(/\./g, "/")
              : prefix + importedName;
        symbolMap.set(localName, specifier);
      }
      child = child.nextSibling;
    }
  } while (cursor.next());

  return symbolMap;
}

/**
 * @description Walks every top-level `FunctionDefinition` and every method directly inside a
 *   `ClassDefinition`'s body, recording a `RawCallEdge` for each bare call (`func(...)`) whose
 *   callee resolves to a name bound by a `from <module> import <name>` statement. Methods are
 *   qualified as `ClassName.methodName`, mirroring the TS parser's convention.
 * @param {Tree} tree - The parsed @lezer/python tree.
 * @param {string} content - Full source text.
 * @returns {RawCallEdge[]} One edge per call to a known imported symbol.
 */
function collectRawCallEdges(tree: Tree, content: string): RawCallEdge[] {
  const importSymbols = buildImportSymbolMap(tree, content);
  const edges: RawCallEdge[] = [];

  function walkBody(node: SyntaxNode, callerName: string): void {
    if (node.type.name === "CallExpression" && node.firstChild?.type.name === "VariableName") {
      const calleeNode = node.firstChild;
      const calleeName = content.slice(calleeNode.from, calleeNode.to);
      const toSpecifier = importSymbols.get(calleeName);
      if (toSpecifier) edges.push({ from: callerName, to: calleeName, toSpecifier });
    }
    let child = node.firstChild;
    while (child) {
      walkBody(child, callerName);
      child = child.nextSibling;
    }
  }

  function walkChildren(node: SyntaxNode): void {
    let child = node.firstChild;
    while (child) {
      walk(child);
      child = child.nextSibling;
    }
  }

  function walk(node: SyntaxNode): void {
    if (node.type.name === "ClassDefinition") {
      const classNameNode = node.getChild("VariableName");
      const className = classNameNode
        ? content.slice(classNameNode.from, classNameNode.to)
        : undefined;
      const body = node.getChild("Body");
      if (body) {
        let child = body.firstChild;
        while (child) {
          if (child.type.name === "FunctionDefinition") {
            const fnNameNode = child.getChild("VariableName");
            const fnName = fnNameNode ? content.slice(fnNameNode.from, fnNameNode.to) : undefined;
            if (fnName) walkBody(child, className ? `${className}.${fnName}` : fnName);
          } else {
            walk(child);
          }
          child = child.nextSibling;
        }
      }
      return;
    }

    if (node.type.name === "FunctionDefinition") {
      const nameNode = node.getChild("VariableName");
      if (nameNode) walkBody(node, content.slice(nameNode.from, nameNode.to));
      return;
    }

    walkChildren(node);
  }

  walk(tree.topNode);
  return edges;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeEdge(
  filePath: string,
  rawSpecifier: string,
  symbols: string[],
  isExternal: boolean,
  type: ImportEdge["type"] = "static",
): ImportEdge {
  return {
    fromPath: filePath,
    toPath: "",
    rawSpecifier,
    isStyle: false,
    isExternal,
    type,
    symbols: symbols.length > 0 ? symbols : undefined,
  };
}

/**
 * @description Classifies a Python file as `"test"`, `"config"`, or `"logic"` based on
 *   its basename convention, imports from known test libraries, and explicit `@tag test` markers.
 * @param {string} baseName - Lowercase basename of the file, e.g. `"test_auth.py"`.
 * @param {ImportEdge[]} imports - Resolved import edges used to detect test-library usage.
 * @param {Set<string>} tags - Tag names extracted from comments.
 * @returns {"test" | "config" | "logic"} The resolved category for this file.
 */
function resolveCategory(
  baseName: string,
  imports: ImportEdge[],
  tags: Set<string>,
): "test" | "config" | "logic" {
  if (baseName.startsWith("test_") || baseName.endsWith("_test.py")) return "test";
  if (baseName === "conftest.py" || baseName === "setup.py") return "config";
  if (tags.has("test")) return "test";
  if (imports.some((imp) => TEST_LIBS.has(imp.rawSpecifier))) return "test";
  return "logic";
}
