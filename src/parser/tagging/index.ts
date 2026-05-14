import ts from "typescript";
import type { TagKind } from "../../types/parse";
import type { ParseContext } from "../types";

const TEST_CALL_NAMES = new Set(["test", "describe", "it"]);

/**
 * Collects tags from a single AST node into `ctx.tags` using four strategies:
 *
 * 1. **Top-level declaration names** — top-level `function foo` or `const foo` contributes `"foo"`
 *    as a tag. Nested declarations (inside callbacks, test blocks, etc.) are ignored to avoid noise.
 *
 * 2. **String-literal `@` markers** — any `@word` inside a string literal (e.g. the title of a
 *    `test('login @smoke', ...)` call) is extracted and added without the leading `@`.
 *
 * 3. **Comment `@tag` annotations** — `@tag <name>` anywhere in the source text (JSDoc, inline
 *    comments) registers `<name>` as a tag. Checked only once per source file to avoid rescanning.
 *
 * 4. **Vitest / Playwright option-bag tags** — the second argument of `test`/`describe`/`it` may
 *    be an object literal with a `tags` array (Vitest: `{ tags: ['foo'] }`) or a `tag` string/array
 *    (Playwright: `{ tag: '@smoke' }` / `{ tag: ['@smoke', '@regression'] }`). Leading `@` is
 *    stripped so both conventions produce the same tag value.
 */
export function handleTagging(node: ts.Node, ctx: ParseContext): void {
  collectDeclarationNameTags(node, ctx);
  collectStringLiteralAtTags(node, ctx);
  collectCommentAnnotationTags(node, ctx);
  collectVitestOptionBagTags(node, ctx);
}

/**
 * Strategy 1: top-level `function foo` / `const foo` → tag `"foo"`.
 * Nested declarations (inside callbacks, test blocks, etc.) are excluded to avoid noise.
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
 * Returns true if `node` is a direct child of the source file.
 * - `FunctionDeclaration`: parent is `SourceFile`
 * - `VariableDeclaration`: parent chain is `VariableDeclarationList → VariableStatement → SourceFile`
 */
function isTopLevel(node: ts.FunctionDeclaration | ts.VariableDeclaration): boolean {
  if (ts.isFunctionDeclaration(node)) return ts.isSourceFile(node.parent);
  const stmt = node.parent?.parent; // VariableDeclarationList → VariableStatement
  return !!stmt && ts.isSourceFile(stmt.parent);
}

/** Strategy 2: `@word` patterns inside any string literal → tag `"word"`. */
function collectStringLiteralAtTags(node: ts.Node, ctx: ParseContext): void {
  if (!ts.isStringLiteral(node)) return;
  const matches = node.text.match(/@[\w-]+/g);
  if (matches) {
    for (const tag of matches) ctx.tags.add({ name: tag.substring(1), kind: "comment-marker" });
  }
}

/**
 * Strategy 3: `@tag <name>` in comments anywhere in the source file.
 * Only runs at the `SourceFile` node so the full text is scanned exactly once.
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
 * Strategy 4: Vitest option-bag `{ tags: ['foo', 'bar'] }` in `test`/`describe`/`it` calls.
 *
 * Both direct calls (`test(...)`) and chained/namespaced calls (`it.each(...)`,
 * `describe.skip(...)`) are recognised via a property-access check.
 */
function collectVitestOptionBagTags(node: ts.Node, ctx: ParseContext): void {
  if (!ts.isCallExpression(node)) return;

  if (!isTestCallExpression(node.expression)) return;

  for (const arg of node.arguments) {
    if (!ts.isObjectLiteralExpression(arg)) continue;
    collectTagsFromObjectLiteral(arg, ctx);
  }
}

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

function collectTagsFromObjectLiteral(obj: ts.ObjectLiteralExpression, ctx: ParseContext): void {
  for (const prop of obj.properties) {
    if (
      !ts.isPropertyAssignment(prop) ||
      !ts.isIdentifier(prop.name) ||
      (prop.name.text !== "tags" && prop.name.text !== "tag")
    )
      continue;
    if (prop.name.text === "tag" && ts.isStringLiteral(prop.initializer)) {
      // Playwright: tag: '@smoke'
      ctx.tags.add({ name: prop.initializer.text.replace(/^@/, ""), kind: "comment-marker" });
    } else if (ts.isArrayLiteralExpression(prop.initializer)) {
      // Vitest: tags: ['foo']  /  Playwright: tag: ['@smoke']
      for (const el of prop.initializer.elements) {
        if (ts.isStringLiteral(el))
          ctx.tags.add({ name: el.text.replace(/^@/, ""), kind: "comment-marker" });
      }
    }
  }
}
