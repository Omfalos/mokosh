/** Computes McCabe cyclomatic complexity and cognitive complexity for Java source, mirroring the
 *  Go algorithm in ./go.ts but walking the @lezer/java SyntaxNode tree. Java's `if`/`else if`
 *  nests exactly like Go's and TypeScript's, so the cognitive model ports over directly — unlike
 *  Python's flat `elif`/`except` sequences. Java adds two decision points Go lacks: the ternary
 *  `?:` operator and `catch` clauses. */
import type { SyntaxNode, Tree } from "@lezer/common";
import type { FunctionComplexity } from "../../types/node";
import { lineAt } from "./lezer-utils";

/** Loop constructs that each introduce one independent path. */
const LOOP_NODES = new Set([
  "ForStatement",
  "EnhancedForStatement",
  "WhileStatement",
  "DoStatement",
]);

/** Type-declaration nodes a method can be nested in, used to qualify method names. */
const TYPE_DECL_NODES = new Set([
  "ClassDeclaration",
  "InterfaceDeclaration",
  "EnumDeclaration",
  "RecordDeclaration",
  "AnnotationTypeDeclaration",
]);

/**
 * @description Computes McCabe cyclomatic complexity for a Java AST node: every independent
 *   decision point counts (base 1) — `if`, any loop, each non-`default` `switch` label, each
 *   `catch` clause, each ternary `?:`, and each `&&` / `||` operator.
 * @param {SyntaxNode} rootNode - The AST root node to analyse — the whole file's top node for
 *   file-level totals, or a `MethodDeclaration`/`ConstructorDeclaration`/`LambdaExpression` node
 *   to score it alone.
 * @param {string} content - Full source text, used to read operator token text.
 * @returns {number} The cyclomatic complexity score, minimum 1.
 */
export function computeCyclomaticComplexity(rootNode: SyntaxNode, content: string): number {
  let complexity = 1;

  function walk(node: SyntaxNode): void {
    const name = node.type.name;
    if (name === "IfStatement" || name === "CatchClause" || name === "TernaryExpression") {
      complexity++;
    } else if (LOOP_NODES.has(name)) {
      complexity++;
    } else if (name === "SwitchLabel") {
      // A `SwitchLabel` is `case <v>:` or `default:`; only `case` is a decision point.
      if (node.firstChild?.type.name === "case") complexity++;
    } else if (name === "LogicOp") {
      const text = content.slice(node.from, node.to);
      if (text === "&&" || text === "||") complexity++;
    }
    let child = node.firstChild;
    while (child) {
      walk(child);
      child = child.nextSibling;
    }
  }

  walk(rootNode);
  return complexity;
}

/**
 * @description Scores a Java `IfStatement`: an initial `if` adds `1 + depth` and nests its
 *   condition/body at `depth + 1`; a chained `else if` recurses into this same function at the
 *   *same* depth with `isElseIf: true` so it adds only a flat +1 (mirroring how the cognitive
 *   model treats `else if` as a continuation, not new nesting); a bare `else` adds a flat +1 and
 *   nests its body at `depth + 1`.
 * @param {SyntaxNode} node - The `IfStatement` node.
 * @param {number} depth - Current nesting depth.
 * @param {boolean} isElseIf - Whether this `IfStatement` is itself the `else if` continuation of
 *   an enclosing one (so it contributes a flat +1 instead of `1 + depth`).
 * @param {string} content - Full source text, threaded through to {@link walkNode}.
 * @returns {number} This node's cognitive complexity contribution, including its branches.
 */
function scoreIfStatement(
  node: SyntaxNode,
  depth: number,
  isElseIf: boolean,
  content: string,
): number {
  let cognitive = isElseIf ? 1 : 1 + depth;
  const kids: SyntaxNode[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) kids.push(c);
  const bodyDepth = isElseIf ? depth : depth + 1;

  // kids[1] is the `ParenthesizedExpression` condition; walk it for `&&` / `||` inside the test.
  const cond = kids[1];
  if (cond && cond.type.name !== "Block") cognitive += walkNode(cond, bodyDepth, false, content);

  const thenBlock = kids.find((k) => k.type.name === "Block");
  if (thenBlock) cognitive += walkNode(thenBlock, bodyDepth, false, content);

  const elseIndex = kids.findIndex((k) => k.type.name === "else");
  if (elseIndex >= 0) {
    const after = kids[elseIndex + 1];
    if (after?.type.name === "IfStatement") {
      cognitive += scoreIfStatement(after, depth, true, content);
    } else if (after) {
      cognitive += 1 + walkNode(after, depth + 1, false, content);
    }
  }
  return cognitive;
}

/**
 * @description Scores a node whose own children are strictly more deeply nested than itself —
 *   loop bodies, `switch` blocks, `catch` clauses, ternary branches, and a `LambdaExpression`
 *   nested inside another function — which all share the same shape: a flat `1 + depth` for the
 *   node itself, then every child walked at `depth + 1`.
 * @param {SyntaxNode} node - The loop / switch / catch / ternary / nested-lambda node.
 * @param {number} depth - Current nesting depth (the node's own, not its children's).
 * @param {string} content - Full source text, threaded through to {@link walkNode}.
 * @returns {number} This node's cognitive complexity contribution, including its body.
 */
function scoreNestedBlock(node: SyntaxNode, depth: number, content: string): number {
  let cognitive = 1 + depth;
  let child = node.firstChild;
  while (child) {
    cognitive += walkNode(child, depth + 1, false, content);
    child = child.nextSibling;
  }
  return cognitive;
}

/**
 * @description Sums the cognitive complexity of every direct child of `node`, each walked at the
 *   same depth as `node` itself — the fallthrough case for nodes with no scoring rule of their
 *   own (e.g. a block, a plain statement list, a `BinaryExpression`'s operands).
 * @param {SyntaxNode} node - The node whose children should be walked.
 * @param {number} depth - Nesting depth to walk the children at.
 * @param {string} content - Full source text, threaded through to {@link walkNode}.
 * @returns {number} The summed cognitive complexity of all direct children.
 */
function walkChildren(node: SyntaxNode, depth: number, content: string): number {
  let cognitive = 0;
  let child = node.firstChild;
  while (child) {
    cognitive += walkNode(child, depth, false, content);
    child = child.nextSibling;
  }
  return cognitive;
}

/**
 * @description Reports whether a `LogicOp` node's token text is `&&` or `||` — the only two
 *   operators that count as cognitive-complexity decision points. The Java grammar also emits a
 *   `LogicOp` for the ternary `?`, which is excluded here (the enclosing `TernaryExpression`
 *   node carries that cost instead).
 * @param {SyntaxNode} node - The `LogicOp` node.
 * @param {string} content - Full source text, used to slice the operator token.
 * @returns {boolean} `true` if the operator is `&&` or `||`.
 */
function isLogicalOperator(node: SyntaxNode, content: string): boolean {
  const text = content.slice(node.from, node.to);
  return text === "&&" || text === "||";
}

/**
 * @description Dispatches one AST node to its scoring rule by node type — `IfStatement` needs its
 *   chained-`else if`-aware handling ({@link scoreIfStatement}); loops, `switch`, `catch`, and
 *   ternary branches share the same nest-and-recurse shape ({@link scoreNestedBlock}); a nested
 *   `LambdaExpression` adds a nesting level; everything else contributes a flat +1 for `&&`/`||`
 *   ({@link isLogicalOperator}), then recurses into its children at the same depth
 *   ({@link walkChildren}).
 * @param {SyntaxNode} node - The AST node to score.
 * @param {number} depth - Current nesting depth.
 * @param {boolean} isElseIf - Whether `node` is itself an `else if` continuation (only meaningful
 *   when `node` is an `IfStatement`; see {@link scoreIfStatement}).
 * @param {string} content - Full source text, used to read operator token text.
 * @returns {number} This node's cognitive complexity contribution, including its subtree.
 */
function walkNode(node: SyntaxNode, depth: number, isElseIf: boolean, content: string): number {
  const name = node.type.name;

  if (name === "IfStatement") return scoreIfStatement(node, depth, isElseIf, content);
  if (LOOP_NODES.has(name) || name === "SwitchStatement" || name === "CatchClause") {
    return scoreNestedBlock(node, depth, content);
  }
  if (name === "TernaryExpression") return scoreNestedBlock(node, depth, content);

  const own = name === "LogicOp" && isLogicalOperator(node, content) ? 1 : 0;

  const isNestedLambda = depth > 0 && name === "LambdaExpression";
  if (isNestedLambda) return own + scoreNestedBlock(node, depth, content);

  return own + walkChildren(node, depth, content);
}

/**
 * @description Computes a simplified SonarSource-style cognitive complexity score for a Java AST
 *   node, tracking how hard the code is to read by adding a nesting penalty. See {@link walkNode}
 *   and its per-node-type scoring functions for the rules applied.
 * @param {SyntaxNode} rootNode - The AST root node to analyse (nesting depth resets to 0 here).
 * @param {string} content - Full source text, used to read operator token text.
 * @returns {number} The cognitive complexity score, minimum 0.
 */
export function computeCognitiveComplexity(rootNode: SyntaxNode, content: string): number {
  return walkNode(rootNode, 0, false, content);
}

/**
 * @description Computes both McCabe cyclomatic complexity and cognitive complexity for a Java AST
 *   node by composing `computeCyclomaticComplexity` and `computeCognitiveComplexity`.
 * @param {SyntaxNode} node - The AST root node to analyse.
 * @param {string} content - Full source text.
 * @returns {{ complexity: number; cognitiveComplexity: number }} Both scores.
 */
export function computeComplexity(
  node: SyntaxNode,
  content: string,
): { complexity: number; cognitiveComplexity: number } {
  return {
    complexity: computeCyclomaticComplexity(node, content),
    cognitiveComplexity: computeCognitiveComplexity(node, content),
  };
}

/**
 * @description Reads the name of the nearest enclosing `ClassDeclaration` / `InterfaceDeclaration`
 *   / `EnumDeclaration` / `RecordDeclaration` for a method node, so methods can be qualified as
 *   `ClassName.methodName` to mirror the TypeScript parser's convention.
 * @param {SyntaxNode} methodNode - The `MethodDeclaration` / `ConstructorDeclaration` node.
 * @param {string} content - Full source text, used to slice the type name.
 * @returns {string | undefined} The enclosing type's bare name, or `undefined` at file top level.
 */
export function enclosingTypeName(methodNode: SyntaxNode, content: string): string | undefined {
  for (let p = methodNode.parent; p; p = p.parent) {
    if (TYPE_DECL_NODES.has(p.type.name)) {
      const nameNode = p.getChild("Definition");
      if (nameNode) return content.slice(nameNode.from, nameNode.to);
    }
  }
  return undefined;
}

/**
 * @description Walks the entire Java source tree and records complexity for every
 *   `MethodDeclaration` and `ConstructorDeclaration` — top-level or nested in an inner class.
 *   Methods are qualified as `EnclosingType.name` to mirror the TS parser's `ClassName.methodName`
 *   convention; a constructor uses its type name as-is.
 * @param {Tree} tree - The parsed @lezer/java tree.
 * @param {string} content - Full source text.
 * @returns {FunctionComplexity[]} Per-method complexity entries, in traversal order.
 */
export function collectFunctionComplexity(tree: Tree, content: string): FunctionComplexity[] {
  const results: FunctionComplexity[] = [];
  const cursor = tree.cursor();

  do {
    if (cursor.name === "MethodDeclaration" || cursor.name === "ConstructorDeclaration") {
      const nameNode = cursor.node.getChild("Definition");
      if (nameNode) {
        const bare = content.slice(nameNode.from, nameNode.to);
        const owner = enclosingTypeName(cursor.node, content);
        const name = owner && cursor.name === "MethodDeclaration" ? `${owner}.${bare}` : bare;
        const { complexity, cognitiveComplexity } = computeComplexity(cursor.node, content);
        results.push({ name, line: lineAt(content, cursor.from), complexity, cognitiveComplexity });
      }
    }
  } while (cursor.next());

  return results;
}
