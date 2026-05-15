import path from "node:path";
import ts from "typescript";
import type { ExportedSymbol, ImportEdge, StructuredTag } from "../types/node";
import type { FileType, ImportType, NodeCategory } from "../types/parse";
import { getBarrelThreshold, getTestLibraries, getTestPatterns, isConfigFile } from "./classify";
import { isStyleFile } from "./file-type";
import { handleTagging } from "./tagging";
import type { ParseContext, ParseResult, RawCallEdge } from "./types";

/**
 * @description Parses a JavaScript or TypeScript file using the TypeScript Compiler API.
 *
 * Creates a source file AST, walks every node to collect imports, exports, tags, and
 * category hints, then classifies the file and returns a structured result.
 * @param filePath - Absolute path of the file; used as the node identifier in the graph.
 * @param content - Raw source content of the file.
 * @param fileType - Determines the TS script kind (`TSX` for TypeScript, `JSX` for JavaScript).
 * @returns Parsed result containing imports, exports, tags, and category.
 */
export function parseCodeFile(filePath: string, content: string, fileType: FileType): ParseResult {
  const imports: ImportEdge[] = [];
  const exports: Map<string, ExportedSymbol> = new Map();
  const tags: Set<StructuredTag> = new Set();

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
    rawCallEdges: [],
    sourceFile,
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
    tags.add({ name: category, kind: "comment-marker" });
  }

  if (category !== "test") {
    collectRawCallEdges(context, sourceFile);
  }

  const firstStatement = sourceFile.statements[0];
  const description = firstStatement ? extractJsDoc(firstStatement) : undefined;

  return {
    imports,
    exports: Array.from(exports.values()),
    tags: Array.from(tags),
    category,
    rawCallEdges: context.rawCallEdges ?? [],
    ...(description !== undefined ? { description } : {}),
  };
}

/**
 * @description Constructs an `ExportedSymbol` from an AST declaration node, attaching JSDoc, flags, and type signature where available.
 * @param name - The exported symbol name.
 * @param declNode - The specific declaration node (e.g. function or variable declarator) used for flags and signature extraction.
 * @param stmtNode - The parent statement node used for JSDoc extraction.
 * @param sourceFile - The source file, required by the TS printer for signature serialisation.
 * @returns The fully populated `ExportedSymbol`.
 */
function makeExportedSymbol(
  name: string,
  declNode: ts.Node,
  stmtNode: ts.Node,
  sourceFile: ts.SourceFile,
): ExportedSymbol {
  const sym: ExportedSymbol = { name };
  const doc = extractJsDoc(stmtNode);
  if (doc !== undefined) sym.doc = doc;
  const flags = extractJsDocFlags(declNode);
  if (flags !== undefined) sym.flags = flags;
  const sig = extractSignature(declNode, sourceFile);
  if (sig !== undefined) sym.signature = sig;
  return sym;
}

/**
 * @description Extracts the text of the first JSDoc comment block attached to a node.
 * @param node - The AST node to inspect.
 * @returns The comment text, or `undefined` if no JSDoc is present.
 */
function extractJsDoc(node: ts.Node): string | undefined {
  const cmts = ts.getJSDocCommentsAndTags(node);
  for (const c of cmts) {
    if (ts.isJSDoc(c) && c.comment) {
      return ts.getTextOfJSDocComment(c.comment) || undefined;
    }
  }
  return undefined;
}

/**
 * @description Extracts known JSDoc tag names from a node.
 *
 * Only a fixed set of tags is recognised: `deprecated`, `internal`, `public`, `alpha`, `beta`.
 * Unknown tags are ignored so that project-specific markers don't pollute the symbol metadata.
 * @param node - The AST node to inspect.
 * @returns Array of matched tag names, or `undefined` if none are present.
 */
function extractJsDocFlags(node: ts.Node): string[] | undefined {
  const KNOWN = new Set(["deprecated", "internal", "public", "alpha", "beta"]);
  const flags = ts
    .getJSDocTags(node)
    .map((t) => t.tagName.text)
    .filter((name) => KNOWN.has(name));
  return flags.length > 0 ? flags : undefined;
}

/**
 * @description Serialises the type signature of a declaration node into a human-readable string.
 *
 * Covers functions, methods, variable declarations (including arrow functions), classes,
 * interfaces, type aliases, and enums. Returns `undefined` for node kinds with no
 * meaningful signature (e.g. plain object literals).
 * @param node - The declaration node to serialise.
 * @param sourceFile - Required by the TS printer to resolve node text.
 * @returns The signature string, or `undefined` if the node kind is not supported.
 */
function extractSignature(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
  const printer = ts.createPrinter({ removeComments: true });
  const print = (n: ts.Node) => printer.printNode(ts.EmitHint.Unspecified, n, sourceFile);

  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
    const params = node.parameters.map(print).join(", ");
    const ret = node.type ? print(node.type) : "void";
    const tps = node.typeParameters
      ? `<${node.typeParameters.map((tp) => tp.name.text).join(", ")}>`
      : "";
    return `${tps}(${params}) => ${ret}`;
  }
  if (ts.isVariableDeclaration(node)) {
    if (node.type) return print(node.type);
    if (
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      const fn = node.initializer;
      const params = fn.parameters.map(print).join(", ");
      const ret = fn.type ? print(fn.type) : "unknown";
      return `(${params}) => ${ret}`;
    }
    return undefined;
  }
  if (ts.isClassDeclaration(node) && node.name) return `class ${node.name.text}`;
  if (ts.isInterfaceDeclaration(node)) return `interface ${node.name.text}`;
  if (ts.isTypeAliasDeclaration(node)) return print(node.type);
  if (ts.isEnumDeclaration(node)) return `enum ${node.name.text}`;
  return undefined;
}

/**
 * @description Dispatches a single AST node to all analysis handlers that update the parse context.
 * @param node - The current AST node being visited.
 * @param ctx - The shared parse context accumulating imports, exports, tags, and category hints.
 */
function analyzeNode(node: ts.Node, ctx: ParseContext) {
  updateStatementCounts(node, ctx);
  updateCategoryHints(node, ctx);
  handleImports(node, ctx);
  handleExports(node, ctx);
  handleCalls(node, ctx);
  handleTagging(node, ctx);
}

/**
 * @description Counts total and export statements in a source file and writes the totals to the parse context.
 *
 * Only runs for `SourceFile` nodes — all other node kinds are ignored.
 * The counts are later used by `determineCategory` to detect barrel files.
 * @param node - The current AST node; only `SourceFile` nodes are processed.
 * @param ctx - The parse context to update.
 */
function updateStatementCounts(node: ts.Node, ctx: ParseContext) {
  if (!ts.isSourceFile(node)) return;
  const statements = node.statements.filter((s) => !ts.isEmptyStatement(s));
  ctx.totalStatements = statements.length;
  ctx.exportStatements = statements.filter(
    (s) => ts.isExportDeclaration(s) || ts.isExportAssignment(s) || hasExportModifier(s),
  ).length;
}

/**
 * @description Updates `hasUI` and `hasTypesOnly` flags on the context based on the current node kind.
 *
 * JSX nodes set `hasUI`; function/class/variable/enum nodes clear `hasTypesOnly`.
 * Both flags feed into `determineCategory` after the full AST walk.
 * @param node - The current AST node.
 * @param ctx - The parse context whose flags are mutated.
 */
function updateCategoryHints(node: ts.Node, ctx: ParseContext) {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
    ctx.hasUI = true;
    ctx.hasTypesOnly = false;
    return;
  }
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
}

/**
 * @description Handles a static `import` declaration and pushes an `ImportEdge` onto the context.
 *
 * Symbol extraction distinguishes default imports, named imports, and namespace imports (`* as ns`).
 * A declaration with no import clause (side-effect import) produces an edge with no symbols.
 * @param node - The current AST node; only `ImportDeclaration` nodes are processed.
 * @param ctx - The parse context whose `imports` array is updated.
 */
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
 * @description Visits an AST node and records any exports it declares into `ctx`.
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
 * @param node - The current AST node to inspect.
 * @param ctx - The parse context whose `exports` and `imports` are updated.
 */
function handleExports(node: ts.Node, ctx: ParseContext) {
  if (ts.isExportDeclaration(node)) {
    handleExportDeclaration(node, ctx);
  } else if (ts.isExportAssignment(node)) {
    ctx.exports.set("default", { name: "default" });
  } else if (hasExportModifier(node)) {
    handleInlineExport(node, ctx);
  }
}

/**
 * @description Handles `export { ... }` and `export { ... } from '...'` / `export * from '...'`.
 *
 * When a module specifier is present this is a re-export edge; otherwise it is a
 * local symbol registration.
 * @param node - The export declaration node.
 * @param ctx - The parse context to update.
 */
function handleExportDeclaration(node: ts.ExportDeclaration, ctx: ParseContext) {
  if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
    handleReExport(node, node.moduleSpecifier.text, ctx);
  } else if (node.exportClause && ts.isNamedExports(node.exportClause)) {
    for (const element of node.exportClause.elements) {
      const name = element.name.text;
      ctx.exports.set(name, { name });
    }
  }
}

/**
 * @description Records a cross-module re-export as an `ImportEdge`.
 *
 * Extracts named symbols from `export { A } from '...'`, or uses `"*"` for
 * `export * from '...'` (no export clause).
 * @param node - The export declaration node.
 * @param specifier - The raw module specifier string from the source.
 * @param ctx - The parse context whose `imports` array is updated.
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

/**
 * @description Returns the exported symbol names from a re-export declaration.
 *
 * Returns `["*"]` when the export clause is absent (star re-export), or an empty
 * array for namespace re-exports (`export * as ns from '...'`) which are not yet tracked.
 * @param node - The export declaration node to inspect.
 * @returns Array of symbol names, or `["*"]` for a star re-export.
 */
function extractReExportSymbols(node: ts.ExportDeclaration): string[] {
  if (!node.exportClause) return ["*"];
  if (ts.isNamedExports(node.exportClause)) {
    return node.exportClause.elements.map((el) => el.name.text);
  }
  return [];
}

/**
 * @description Handles declarations that carry an `export` modifier, e.g.:
 * `export function foo`, `export class Bar`, `export const baz`, `export type T`.
 *
 * Registers each exported name into `ctx.exports` with its signature and JSDoc metadata.
 * @param node - The exported declaration node.
 * @param ctx - The parse context whose `exports` map is updated.
 */
function handleInlineExport(node: ts.Node, ctx: ParseContext) {
  const isNamedDeclaration =
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node);

  if (isNamedDeclaration && node.name) {
    const name = node.name.text;
    ctx.exports.set(name, makeExportedSymbol(name, node, node, ctx.sourceFile));
    return;
  }

  if (ts.isVariableStatement(node)) {
    for (const decl of node.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) {
        const name = decl.name.text;
        ctx.exports.set(name, makeExportedSymbol(name, decl, node, ctx.sourceFile));
      }
    }
  }
}

/**
 * @description Handles dynamic `import()` calls and `require()` calls, pushing import edges onto the context.
 *
 * The string argument is hoisted before the call-type check so both branches share the
 * same guard, removing a level of nesting. Non-string (computed) specifiers are silently ignored.
 * @param node - The current AST node; only `CallExpression` nodes are processed.
 * @param ctx - The parse context whose `imports` array is updated.
 */
function handleCalls(node: ts.Node, ctx: ParseContext) {
  if (!ts.isCallExpression(node)) return;

  const arg = node.arguments[0];
  if (!arg || !ts.isStringLiteral(arg)) return;

  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    ctx.imports.push({
      fromPath: ctx.filePath,
      toPath: "",
      rawSpecifier: arg.text,
      isStyle: isStyleFile(arg.text),
      type: "dynamic",
    });
  } else if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
    ctx.imports.push({
      fromPath: ctx.filePath,
      toPath: "",
      rawSpecifier: arg.text,
      isStyle: isStyleFile(arg.text),
      type: "require",
    });
  }
}

/**
 * @description Classifies a parsed file into a `NodeCategory` based on file name patterns, imports, and AST shape.
 *
 * Checks are ordered from most to least specific: explicit test files, config files,
 * testing-library imports, JSX/UI presence, barrel ratio, type-only content, and finally
 * the default `"logic"` bucket.
 * @param filePath - The file path, checked against test and config name patterns.
 * @param ctx - The parse context with accumulated category hints from the AST walk.
 * @returns The most specific matching `NodeCategory`.
 */
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

/**
 * @description Checks whether a node has an `export` keyword modifier.
 * @param node - The AST node to inspect.
 * @returns `true` if the node carries an `export` modifier.
 */
function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true
  );
}

/**
 * @description Builds a map of imported symbol names to their module specifiers, then walks
 *   every top-level exported function body to collect caller→callee→specifier triples.
 *   Populates `ctx.rawCallEdges` in place; skipped entirely for test files.
 * @param ctx - The parse context whose `rawCallEdges` array is populated.
 * @param sourceFile - The TypeScript source file AST used to enumerate statements.
 */
function collectRawCallEdges(ctx: ParseContext, sourceFile: ts.SourceFile): void {
  const edges: RawCallEdge[] = ctx.rawCallEdges ?? [];
  ctx.rawCallEdges = edges;

  const importSymbolMap = new Map<string, string>();
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const specifier = stmt.moduleSpecifier.text;
    const clause = stmt.importClause;
    if (!clause) continue;
    if (clause.name) importSymbolMap.set(clause.name.text, specifier);
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) {
        importSymbolMap.set(el.name.text, specifier);
      }
    }
  }
  if (importSymbolMap.size === 0) return;

  for (const stmt of sourceFile.statements) {
    const fnName = getTopLevelExportedFunctionName(stmt);
    if (!fnName) continue;
    const body = getFunctionBody(stmt);
    if (!body) continue;
    walkCallExpressions(body, fnName, importSymbolMap, edges);
  }
}

/**
 * @description Extracts the name of a top-level exported function from a statement.
 *   Recognises both `export function foo` and `export const foo = () => ...` forms.
 * @param stmt - The top-level statement to inspect.
 * @returns The function name, or `undefined` if the statement is not an exported function.
 */
function getTopLevelExportedFunctionName(stmt: ts.Statement): string | undefined {
  if (!hasExportModifier(stmt)) return undefined;
  if (ts.isFunctionDeclaration(stmt) && stmt.name) return stmt.name.text;
  if (ts.isVariableStatement(stmt)) {
    for (const decl of stmt.declarationList.declarations) {
      if (
        ts.isIdentifier(decl.name) &&
        decl.initializer &&
        (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
      ) {
        return decl.name.text;
      }
    }
  }
  return undefined;
}

/**
 * @description Extracts the body node from a top-level function declaration or a variable-declared
 *   arrow/function expression. Used to scope the call-expression walk to a single function.
 * @param stmt - The top-level statement to inspect.
 * @returns The body node, or `undefined` if the statement is neither a function declaration
 *   nor a variable-declared function expression.
 */
function getFunctionBody(stmt: ts.Statement): ts.Node | undefined {
  if (ts.isFunctionDeclaration(stmt)) return stmt.body;
  if (ts.isVariableStatement(stmt)) {
    for (const decl of stmt.declarationList.declarations) {
      if (
        decl.initializer &&
        (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
      ) {
        return decl.initializer;
      }
    }
  }
  return undefined;
}

/**
 * @description Recursively walks an AST subtree and records every direct call to an imported
 *   symbol as a `RawCallEdge`. Deduplicates so the same (from, to, specifier) triple is only
 *   pushed once.
 * @param node - The AST node to walk.
 * @param fnName - The name of the enclosing exported function, used as the `from` field on edges.
 * @param importSymbolMap - Maps local import names to their module specifiers.
 * @param result - Accumulator array that receives discovered edges.
 */
function walkCallExpressions(
  node: ts.Node,
  fnName: string,
  importSymbolMap: Map<string, string>,
  result: RawCallEdge[],
): void {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    const callee = node.expression.text;
    const specifier = importSymbolMap.get(callee);
    if (
      specifier &&
      !result.some((e) => e.from === fnName && e.to === callee && e.toSpecifier === specifier)
    ) {
      result.push({ from: fnName, to: callee, toSpecifier: specifier });
    }
  }
  ts.forEachChild(node, (child) => walkCallExpressions(child, fnName, importSymbolMap, result));
}
