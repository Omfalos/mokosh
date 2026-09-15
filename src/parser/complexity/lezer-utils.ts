/** Shared low-level helpers for walking @lezer/common SyntaxNode trees during complexity
 *  analysis. The actual cyclomatic/cognitive scoring logic in ./go.ts and ./python.ts is *not*
 *  shared beyond this: Go's if/else-if is nested (like TS), while Python's if/elif/else and
 *  try/except are flat sibling sequences within one node — different enough that a forced common
 *  abstraction would need as much branching as it saves. See docs/adr-011-go-python-call-edges.md. */
import type { SyntaxNode, Tree } from "@lezer/common";

/**
 * @description Collects the direct children of a Lezer syntax node into an array, in document
 *   order, by walking the `firstChild`/`nextSibling` chain. Lezer nodes have no `getChildren()`
 *   equivalent for "all children", unlike the TS compiler API's `forEachChild`.
 * @param {SyntaxNode} node - The node whose direct children to collect.
 * @returns {SyntaxNode[]} The node's direct children, in order.
 */
export function childrenOf(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  let child = node.firstChild;
  while (child) {
    result.push(child);
    child = child.nextSibling;
  }
  return result;
}

/**
 * @description Resolves the 1-indexed source line a byte offset falls on by counting newlines
 *   before it. @lezer trees carry no line/column info by default, unlike the TS compiler API's
 *   `SourceFile.getLineAndCharacterOfPosition`.
 * @param {string} content - Full source text.
 * @param {number} pos - Byte offset into `content`.
 * @returns {number} The 1-indexed line number containing `pos`.
 */
export function lineAt(content: string, pos: number): number {
  let line = 1;
  for (let i = 0; i < pos && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

/**
 * @description Computes the fraction of `content` covered by error-node spans in `tree` — the
 *   failure-isolation gate a grammar with known scope cuts (e.g. Kotlin's, see
 *   `src/parser/lang/kotlin/PROGRESS.md`) uses to decide whether a parse is trustworthy enough to
 *   drive complexity/call-edge extraction, or should be skipped in favor of a lossless fallback.
 *   A wrong extracted number is worse than a missing one — see
 *   `docs/adr-021-kotlin-parsing.md`.
 * @param {Tree} tree - The parsed tree to inspect.
 * @param {string} content - Full source text the tree was parsed from.
 * @returns {number} Error-span chars divided by total source chars; `0` for empty content.
 */
export function errorRatio(tree: Tree, content: string): number {
  if (content.length === 0) return 0;
  let errorChars = 0;
  tree.iterate({
    enter(node) {
      if (node.type.isError) errorChars += node.to - node.from;
    },
  });
  return errorChars / content.length;
}
