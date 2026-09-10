/** Collects structured tags from a TypeScript/JavaScript AST node using declaration names, `@marker` tokens in test titles, `@tag` comment annotations, and Vitest/Playwright option bags. */
import ts from "typescript";
import type { TagKind } from "../../types/parse";
import type { ParseContext } from "../types";

const TEST_CALL_NAMES = new Set(["test", "describe", "it"]);

/**
 * @description Collects tags from a single AST node into `ctx.tags` using three strategies:
 *   declaration names, comment `@tag` annotations, and test calls (`@marker` tokens in the
 *   test title + Vitest/Playwright option-bag arrays). Each strategy applies its own type
 *   guard so only relevant nodes produce output.
 * @param node - The AST node currently being visited.
 * @param ctx - Mutable parse context accumulating tags for the current source file.
 */
export function handleTagging(node: ts.Node, ctx: ParseContext): void {
  collectDeclarationNameTags(node, ctx);
  collectCommentAnnotationTags(node, ctx);
  collectTestCallTags(node, ctx);
}

/**
 * @description Adds the name of any top-level function or variable declaration to `ctx.tags`,
 *   tagging it as `"function"` or `"variable"` based on its initializer.
 *   Declarations nested inside callbacks or test blocks are skipped to avoid noise.
 * @param node - The AST node being visited.
 * @param ctx - Mutable parse context that receives the new tag.
 */
function collectDeclarationNameTags(node: ts.Node, ctx: ParseContext): void {
  if (
    (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) &&
    node.name &&
    ts.isIdentifier(node.name) &&
    isTopLevel(node)
  ) {
    let kind: TagKind;
    if (ts.isFunctionDeclaration(node)) {
      kind = "function";
    } else {
      const init = node.initializer;
      kind =
        init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
          ? "function"
          : "variable";
    }
    ctx.tags.add({ name: node.name.text, kind });
  }
}

/**
 * @description Determines whether a function or variable declaration sits directly under the
 *   source file root, distinguishing top-level exports from declarations nested in callbacks or blocks.
 * @param node - A function or variable declaration node to test.
 * @returns True if the node is a direct child of the `SourceFile`.
 */
function isTopLevel(node: ts.FunctionDeclaration | ts.VariableDeclaration): boolean {
  if (ts.isFunctionDeclaration(node)) return ts.isSourceFile(node.parent);
  const stmt = node.parent?.parent; // VariableDeclarationList → VariableStatement
  return !!stmt && ts.isSourceFile(stmt.parent);
}

/**
 * @description Scans the full source text for `@tag <name>` annotations and records each `<name>`
 *   as a `comment-marker` tag. Only runs when `node` is the `SourceFile` so the text is scanned exactly once per file.
 * @param node - The current AST node; processing is skipped unless it is a `SourceFile`.
 * @param ctx - Mutable parse context that receives extracted tags.
 */
function collectCommentAnnotationTags(node: ts.Node, ctx: ParseContext): void {
  if (!ts.isSourceFile(node)) return;
  const tagRegex = /@tag\s+([a-zA-Z0-9_-]+)/g;
  const fullText = node.getFullText();
  let match = tagRegex.exec(fullText);
  while (match !== null) {
    if (match[1]) ctx.tags.add({ name: match[1], kind: "comment-marker" });
    match = tagRegex.exec(fullText);
  }
}

/**
 * @description Inspects call expressions that match test-framework functions (`test` /
 *   `describe` / `it`, incl. chained forms like `it.each(...)` / `describe.skip(...)`) and
 *   extracts two kinds of tag: `@marker` tokens found in the **test title** (the first
 *   string-literal argument, e.g. `test('login @smoke', …)` → `smoke`) and values from a
 *   Vitest `tags: [...]` / Playwright `tag: "@x"` option-bag argument. `@word` tokens in any
 *   other string literal are deliberately ignored — they are almost always incidental
 *   (import specifiers, `@param`, emails), not test-selection labels.
 * @param node - The AST node to inspect; only call expressions are processed.
 * @param ctx - Mutable parse context that receives extracted tags.
 */
function collectTestCallTags(node: ts.Node, ctx: ParseContext): void {
  if (!ts.isCallExpression(node)) return;

  if (!isTestCallExpression(node.expression)) return;

  const [firstArg] = node.arguments;
  if (firstArg && ts.isStringLiteral(firstArg)) {
    for (const marker of firstArg.text.match(/@[\w-]+/g) ?? []) {
      ctx.tags.add({ name: marker.substring(1), kind: "comment-marker" });
    }
  }

  for (const arg of node.arguments) {
    if (!ts.isObjectLiteralExpression(arg)) continue;
    collectTagsFromObjectLiteral(arg, ctx);
  }
}

/**
 * @description Returns true if the callee expression resolves to a test-framework function
 *   (`test`, `describe`, or `it`), recognising both bare identifiers and property-access
 *   forms such as `it.skip` or `describe.concurrent`.
 * @param callee - The callee expression of a call node to classify.
 * @returns True when the expression refers to a known test-framework entry point.
 */
function isTestCallExpression(callee: ts.Expression): boolean {
  if (ts.isIdentifier(callee)) return TEST_CALL_NAMES.has(callee.text);
  if (ts.isPropertyAccessExpression(callee)) {
    // `something.test(...)` / `something.describe(...)`
    if (TEST_CALL_NAMES.has(callee.name.text)) return true;
    // `it.skip(...)` / `test.concurrent(...)` — base is the test function
    if (ts.isIdentifier(callee.expression) && TEST_CALL_NAMES.has(callee.expression.text))
      return true;
  }
  return false;
}

/**
 * @description Reads the `tags` (Vitest array) or `tag` (Playwright string or array) property
 *   from an object literal and records each value as a `comment-marker` tag, stripping any
 *   leading `@` so both frameworks produce the same normalised tag name.
 * @param obj - The object literal expression from a test call's option argument.
 * @param ctx - Mutable parse context that receives extracted tags.
 */
function collectTagsFromObjectLiteral(obj: ts.ObjectLiteralExpression, ctx: ParseContext): void {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
    if (prop.name.text !== "tags" && prop.name.text !== "tag") continue;

    const { initializer } = prop;
    const values: ts.StringLiteral[] = ts.isArrayLiteralExpression(initializer)
      ? initializer.elements.filter(ts.isStringLiteral)
      : prop.name.text === "tag" && ts.isStringLiteral(initializer)
        ? [initializer]
        : [];

    for (const el of values) {
      ctx.tags.add({ name: el.text.replace(/^@/, ""), kind: "comment-marker" });
    }
  }
}
