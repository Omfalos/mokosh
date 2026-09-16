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

/**
 * @description Reports whether a subtree contains *any* error node — the localized, zero-
 *   tolerance twin of {@link errorRatio}'s whole-file percentage threshold. A percentage doesn't
 *   work at function scope: dogfooding OkHttp surfaced a real Kotlin case
 *   (`DiskLruCache.close`) where a `Block` failed to close at its own `}` and silently swallowed
 *   several subsequent sibling declarations — including one hitting this grammar's documented
 *   "no local classes" gap — inflating that one function's cyclomatic complexity from ~4 to 46.
 *   The error nodes involved were real but nearly zero-width (the generator's recovery inserts a
 *   point error rather than marking a wide span), so a *ratio* against that swallowed span's
 *   length stayed under 1% — well under any file-level threshold — even though the shape was
 *   completely wrong. A function body is small enough that *any* error node inside it is already
 *   a reliable "don't trust this" signal, unlike a whole file where one unrelated gap elsewhere
 *   shouldn't void every other function.
 * @param {SyntaxNode} node - The subtree to inspect (typically a function/method body).
 * @returns {boolean} `true` if any descendant (or the node itself) is an error node.
 */
export function nodeHasError(node: SyntaxNode): boolean {
  let found = false;
  node.cursor().iterate((n) => {
    if (n.type.isError) found = true;
  });
  return found;
}
