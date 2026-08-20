/** Computes McCabe cyclomatic complexity and cognitive complexity for Go source, mirroring the
 *  TypeScript algorithm in ../complexity.ts but walking the @lezer/go SyntaxNode tree instead. */
import type { SyntaxNode, Tree } from "@lezer/common";
import type { FunctionComplexity } from "../../types/node";
import { childrenOf, lineAt } from "./lezer-utils";

/**
 * @description Computes McCabe cyclomatic complexity for a Go AST node: every independent
 *   decision point counts (base 1) — `if`, `for`, non-default `switch`/`select` cases, and each
 *   `&&` / `||` operator. Go has no `try`/`catch` or ternary operator, so those TS decision
 *   points have no Go equivalent.
 * @param {SyntaxNode} rootNode - The AST root node to analyse — the whole file's top node for
 *   file-level totals, or a `FunctionDecl`/`MethodDecl`/`FunctionLiteral` node to score it alone.
 * @param {string} content - Full source text, used to read operator token text.
 * @returns {number} The cyclomatic complexity score, minimum 1.
 */
export function computeCyclomaticComplexity(rootNode: SyntaxNode, content: string): number {
  let complexity = 1;

  function walk(node: SyntaxNode): void {
    switch (node.type.name) {
      case "IfStatement":
      case "ForStatement":
        complexity++;
        break;
      case "Case": {
        // Case covers both `case` and `default` clauses; only `case` is a decision point.
        if (node.firstChild?.type.name === "case") complexity++;
        break;
      }
      case "LogicOp": {
        const text = content.slice(node.from, node.to);
        if (text === "&&" || text === "||") complexity++;
        break;
      }
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
 * @description Scores a Go `IfStatement`: an initial `if` adds `1 + depth` and nests its
 *   condition/body at `depth + 1`; a chained `else if` recurses into this same function at the
 *   *same* depth with `isElseIf: true` so it adds only a flat +1 (mirroring how the cognitive
 *   model treats `else if` as a continuation, not new nesting); a bare `else` adds a flat +1 and
 *   nests its body at `depth + 1`.
 * @param {SyntaxNode} node - The `IfStatement` node.
 * @param {number} depth - Current nesting depth.
 * @param {boolean} isElseIf - Whether this `IfStatement` is itself the `else if` continuation of
 *   an enclosing one (so it contributes a flat +1 instead of `1 + depth`).
 * @param {string} content - Full source text, threaded through to {@link walkNode} for reading
 *   operator token text.
 * @returns {number} This node's cognitive complexity contribution, including its branches.
 */
function scoreIfStatement(
  node: SyntaxNode,
  depth: number,
  isElseIf: boolean,
  content: string,
): number {
  let cognitive = isElseIf ? 1 : 1 + depth;
  const kids = childrenOf(node);
  const bodyDepth = isElseIf ? depth : depth + 1;

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
 *   `for`/`switch`/`select` bodies and a `FunctionLiteral` nested inside another function — which
 *   all share the same shape: a flat `1 + depth` for the node itself, then every child walked at
 *   `depth + 1`.
 * @param {SyntaxNode} node - The loop, switch/select, or nested-function-literal node.
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
 *   own (e.g. a block, a plain statement list, a `LogicOp`'s operands).
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
 *   operators that count as cognitive-complexity decision points (Go has no other short-circuit
 *   operators at this grammar node).
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
 *   chained-`else if`-aware handling ({@link scoreIfStatement}); loops, `switch`/`select`, and
 *   nested `FunctionLiteral`s share the same nest-and-recurse shape ({@link scoreNestedBlock});
 *   everything else contributes a flat +1 for `&&`/`||` ({@link isLogicalOperator}), then recurses
 *   into its children at the same depth ({@link walkChildren}).
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
  if (name === "ForStatement" || name === "SwitchStatement" || name === "SelectStatement") {
    return scoreNestedBlock(node, depth, content);
  }

  const own = name === "LogicOp" && isLogicalOperator(node, content) ? 1 : 0;

  const isNestedFunctionLiteral = depth > 0 && name === "FunctionLiteral";
  if (isNestedFunctionLiteral) return own + scoreNestedBlock(node, depth, content);

  return own + walkChildren(node, depth, content);
}

/**
 * @description Computes a simplified SonarSource-style cognitive complexity score for a Go AST
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
 * @description Computes both McCabe cyclomatic complexity and cognitive complexity for a Go AST
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
 * @description Reads the receiver type name off a `MethodDecl` node (e.g. `Receiver` from
 *   `func (r *Receiver) Method()`), unwrapping a pointer receiver if present.
 * @param {SyntaxNode} methodDecl - The `MethodDecl` node.
 * @param {string} content - Full source text, used to slice the type name.
 * @returns {string | undefined} The receiver's bare type name, or `undefined` if not found.
 */
export function receiverTypeName(methodDecl: SyntaxNode, content: string): string | undefined {
  const receiverParams = methodDecl.getChild("Parameters");
  const receiverParam = receiverParams?.getChild("Parameter");
  const typeNode =
    receiverParam?.getChild("TypeName") ??
    receiverParam?.getChild("PointerType")?.getChild("TypeName");
  return typeNode ? content.slice(typeNode.from, typeNode.to) : undefined;
}

/**
 * @description Walks the entire Go source tree and records complexity for every named
 *   `FunctionDecl` and `MethodDecl` — top-level or nested. Methods are qualified as
 *   `ReceiverType.MethodName` to mirror the TS parser's `ClassName.methodName` convention.
 * @param {Tree} tree - The parsed @lezer/go tree.
 * @param {string} content - Full source text.
 * @returns {FunctionComplexity[]} Per-function complexity entries, in traversal order.
 */
export function collectFunctionComplexity(tree: Tree, content: string): FunctionComplexity[] {
  const results: FunctionComplexity[] = [];
  const cursor = tree.cursor();

  do {
    if (cursor.name === "FunctionDecl") {
      const nameNode = cursor.node.getChild("DefName");
      if (nameNode) {
        const name = content.slice(nameNode.from, nameNode.to);
        const { complexity, cognitiveComplexity } = computeComplexity(cursor.node, content);
        results.push({ name, line: lineAt(content, cursor.from), complexity, cognitiveComplexity });
      }
    } else if (cursor.name === "MethodDecl") {
      const nameNode = cursor.node.getChild("FieldName");
      if (nameNode) {
        const methodName = content.slice(nameNode.from, nameNode.to);
        const receiver = receiverTypeName(cursor.node, content);
        const name = receiver ? `${receiver}.${methodName}` : methodName;
        const { complexity, cognitiveComplexity } = computeComplexity(cursor.node, content);
        results.push({ name, line: lineAt(content, cursor.from), complexity, cognitiveComplexity });
      }
    }
  } while (cursor.next());

  return results;
}
