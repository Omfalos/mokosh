import path from "node:path";
import ts from "typescript";
import type { FileType, ImportEdge, ImportType, NodeCategory } from "../types";
import { getBarrelThreshold, getTestLibraries, getTestPatterns, isConfigFile } from "./classify";
import { isStyleFile } from "./file-type";
import { handleTagging } from "./tagging";
import type { ParseContext, ParseResult } from "./types";

/**
 * Parses JavaScript and TypeScript files using the TypeScript Compiler API.
 */
export function parseCodeFile(filePath: string, content: string, fileType: FileType): ParseResult {
  const imports: ImportEdge[] = [];
  const exports: Set<string> = new Set();
  const tags: Set<string> = new Set();

  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    fileType === "typescript" ? ts.ScriptKind.TSX : ts.ScriptKind.JSX,
  );

  const context: ParseContext = {
    filePath,
    imports,
    exports,
    tags,
    hasUI: false,
    hasTypesOnly: true,
    totalStatements: 0,
    exportStatements: 0,
  };

  const visit = (node: ts.Node) => {
    analyzeNode(node, context);
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  const category = determineCategory(filePath, context);
  if (category === "test" || category === "barrel") {
    tags.add(category);
  }

  return {
    imports,
    exports: Array.from(exports),
    tags: Array.from(tags),
    category,
  };
}

function analyzeNode(node: ts.Node, ctx: ParseContext) {
  if (ts.isSourceFile(node)) {
    const statements = node.statements.filter((s) => !ts.isEmptyStatement(s));
    ctx.totalStatements = statements.length;
    ctx.exportStatements = statements.filter(
      (s) => ts.isExportDeclaration(s) || ts.isExportAssignment(s) || hasExportModifier(s),
    ).length;
  }

  // Detect UI elements
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
    ctx.hasUI = true;
    ctx.hasTypesOnly = false;
  }

  // Detect logic vs types
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isClassDeclaration(node) ||
    ts.isVariableStatement(node) ||
    ts.isEnumDeclaration(node)
  ) {
    ctx.hasTypesOnly = false;
  }

  // Handle imports/exports
  handleImports(node, ctx);
  handleExports(node, ctx);
  handleCalls(node, ctx);

  // Metadata / Tagging
  handleTagging(node, ctx);
}

function handleImports(node: ts.Node, ctx: ParseContext) {
  if (!ts.isImportDeclaration(node)) return;
  if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) return;

  const symbols: string[] = [];
  if (node.importClause) {
    if (node.importClause.name) symbols.push("default");
    if (node.importClause.namedBindings) {
      if (ts.isNamedImports(node.importClause.namedBindings)) {
        for (const element of node.importClause.namedBindings.elements) {
          symbols.push(element.name.text);
        }
      } else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
        symbols.push("*");
      }
    }
  }

  const type: ImportType = symbols.length > 0 ? "static" : "side-effect";
  ctx.imports.push({
    fromPath: ctx.filePath,
    toPath: "",
    rawSpecifier: node.moduleSpecifier.text,
    isStyle: isStyleFile(node.moduleSpecifier.text),
    type,
    symbols: symbols.length > 0 ? symbols : undefined,
  });
}

/**
 * Visits an AST node and records any exports it declares into `ctx`.
 *
 * Handles three syntactic forms:
 *
 * 1. **Re-export with source** (`export { A, B } from './mod'` / `export * from './mod'`):
 *    Adds an `ImportEdge` of type `"re-export"` so the graph captures the cross-file
 *    relationship. Symbols are the named exports, or `["*"]` for a star re-export.
 *
 * 2. **Local re-export** (`export { localName }`):
 *    Registers the symbol in `ctx.exports`; no import edge is created because no
 *    external module is referenced.
 *
 * 3. **Inline export modifier** (`export function foo`, `export const bar`, `export default`):
 *    Registers the exported name (or `"default"` for `export default`) in `ctx.exports`.
 */
function handleExports(node: ts.Node, ctx: ParseContext) {
  if (ts.isExportDeclaration(node)) {
    handleExportDeclaration(node, ctx);
  } else if (ts.isExportAssignment(node)) {
    ctx.exports.add("default");
  } else if (hasExportModifier(node)) {
    handleInlineExport(node, ctx);
  }
}

/**
 * Handles `export { ... }` and `export { ... } from '...'` / `export * from '...'`.
 * When a module specifier is present this is a re-export edge; otherwise it is a
 * local symbol registration.
 */
function handleExportDeclaration(node: ts.ExportDeclaration, ctx: ParseContext) {
  if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
    handleReExport(node, node.moduleSpecifier.text, ctx);
  } else if (node.exportClause && ts.isNamedExports(node.exportClause)) {
    for (const element of node.exportClause.elements) {
      ctx.exports.add(element.name.text);
    }
  }
}

/**
 * Records a cross-module re-export as an `ImportEdge`.
 * Extracts named symbols from `export { A } from '...'`, or uses `"*"` for
 * `export * from '...'` (no export clause).
 */
function handleReExport(node: ts.ExportDeclaration, specifier: string, ctx: ParseContext) {
  const symbols = extractReExportSymbols(node);
  const edge: ImportEdge = {
    fromPath: ctx.filePath,
    toPath: "",
    rawSpecifier: specifier,
    isStyle: isStyleFile(specifier),
    type: "re-export",
  };
  if (symbols.length > 0) edge.symbols = symbols;
  ctx.imports.push(edge);
}

/** Returns the exported symbol names, or `["*"]` when the clause is absent (star re-export). */
function extractReExportSymbols(node: ts.ExportDeclaration): string[] {
  if (!node.exportClause) return ["*"];
  if (ts.isNamedExports(node.exportClause)) {
    return node.exportClause.elements.map((el) => el.name.text);
  }
  return [];
}

/**
 * Handles declarations that carry an `export` modifier, e.g.:
 * `export function foo`, `export class Bar`, `export const baz`, `export type T`.
 * Registers each exported name into `ctx.exports`.
 */
function handleInlineExport(node: ts.Node, ctx: ParseContext) {
  const isNamedDeclaration =
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node);

  if (isNamedDeclaration && node.name) {
    ctx.exports.add(node.name.text);
    return;
  }

  if (ts.isVariableStatement(node)) {
    for (const decl of node.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) ctx.exports.add(decl.name.text);
    }
  }
}

function handleCalls(node: ts.Node, ctx: ParseContext) {
  if (!ts.isCallExpression(node)) return;

  // Dynamic import()
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const arg = node.arguments[0];
    if (arg && ts.isStringLiteral(arg)) {
      ctx.imports.push({
        fromPath: ctx.filePath,
        toPath: "",
        rawSpecifier: arg.text,
        isStyle: isStyleFile(arg.text),
        type: "dynamic",
      });
    }
  }
  // require()
  else if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
    const arg = node.arguments[0];
    if (arg && ts.isStringLiteral(arg)) {
      ctx.imports.push({
        fromPath: ctx.filePath,
        toPath: "",
        rawSpecifier: arg.text,
        isStyle: isStyleFile(arg.text),
        type: "require",
      });
    }
  }
}

function determineCategory(filePath: string, ctx: ParseContext): NodeCategory {
  const baseName = path.basename(filePath).toLowerCase();
  const ext = path.extname(filePath).toLowerCase();

  // 1. Explicit test files
  if (getTestPatterns().some((p) => baseName.includes(p))) {
    return "test";
  }

  // 2. Configuration files (built-in list + user-registered matchers)
  if (isConfigFile(baseName)) {
    return "config";
  }

  // 3. UI detection (JSX/TSX or explicit UI elements or testing library imports)
  const importsTestingLib = ctx.imports.some((imp) =>
    getTestLibraries().some((lib) => imp.rawSpecifier.includes(lib)),
  );

  if (importsTestingLib) return "test";

  if (ext === ".tsx" || ext === ".jsx" || ctx.hasUI) return "ui";

  // 4. Barrel files (mostly exports)
  if (ctx.totalStatements > 0 && ctx.exportStatements / ctx.totalStatements > getBarrelThreshold())
    return "barrel";

  // 5. Type-only files (interfaces, types)
  if (ctx.hasTypesOnly && ctx.totalStatements > 0) return "type-only";

  return "logic";
}

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true
  );
}
