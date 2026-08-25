/** Computes McCabe cyclomatic complexity and cognitive complexity for Python source, mirroring
 *  the TypeScript algorithm in ../complexity.ts but walking the @lezer/python SyntaxNode tree.
 *  Python's grammar represents `if`/`elif`/`else` and `try`/`except`/`else`/`finally` as flat
 *  sibling sequences within a single node, unlike TS/Go's nested representation, so the
 *  branch-chain walking logic differs from ../complexity.ts and ./go.ts even though the overall
 *  scoring model (decision points, nesting-aware cognitive penalty) is the same. */
import type { SyntaxNode, Tree } from "@lezer/common";
import type { FunctionComplexity } from "../../types/node";
import { childrenOf, lineAt } from "./lezer-utils";

/**
 * @description Computes McCabe cyclomatic complexity for a Python AST node: every independent
 *   decision point counts (base 1) — each `if`/`elif` branch, `for`, `while`, each `except`
 *   clause, ternary (`ConditionalExpression`), and each `and`/`or` operator.
 * @param {SyntaxNode} rootNode - The AST root node to analyse — the whole file's top node for
 *   file-level totals, or a `FunctionDefinition`/`LambdaExpression` node to score it alone.
 * @returns {number} The cyclomatic complexity score, minimum 1.
 */
export function computeCyclomaticComplexity(rootNode: SyntaxNode): number {
  let complexity = 1;

  function walk(node: SyntaxNode): void {
    switch (node.type.name) {
      case "IfStatement": {
        complexity += childrenOf(node).filter(
          (k) => k.type.name === "if" || k.type.name === "elif",
        ).length;
        break;
      }
      case "TryStatement": {
        complexity += childrenOf(node).filter((k) => k.type.name === "except").length;
        break;
      }
      case "ForStatement":
      case "WhileStatement":
      case "ConditionalExpression":
        complexity++;
        break;
      case "and":
      case "or":
        complexity++;
        break;
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
 * @description Scores a Python `IfStatement`: since Python represents an entire `if`/`elif`/
 *   `else` chain as one flat node (unlike TS/Go's nesting), this walks its direct children in
 *   groups — each fresh `if` adds `1 + depth` and nests its body; each `elif` adds a flat +1 at
 *   the same depth as the original `if`; a bare `else` adds a flat +1 and nests its body.
 * @param {SyntaxNode} node - The `IfStatement` node.
 * @param {number} depth - Current nesting depth.
 * @returns {number} This node's cognitive complexity contribution, including its branches.
 */
function scoreIfStatement(node: SyntaxNode, depth: number): number {
  let cognitive = 0;
  const kids = childrenOf(node);
  let branchIndex = 0;
  let i = 0;
  while (i < kids.length) {
    const kw = kids[i];
    if (kw?.type.name === "if" || kw?.type.name === "elif") {
      const isElseIf = branchIndex > 0;
      cognitive += isElseIf ? 1 : 1 + depth;
      const bodyDepth = isElseIf ? depth : depth + 1;
      const cond = kids[i + 1];
      const body = kids[i + 2];
      if (cond) cognitive += walkNode(cond, bodyDepth);
      if (body) cognitive += walkNode(body, bodyDepth);
      branchIndex++;
      i += 3;
    } else if (kw?.type.name === "else") {
      cognitive += 1;
      const body = kids[i + 1];
      if (body) cognitive += walkNode(body, depth + 1);
      i += 2;
    } else {
      i++;
    }
  }
  return cognitive;
}

/**
 * @description Scores a Python `TryStatement`: each `except` clause adds `1 + depth` without
 *   increasing nesting for its own body (mirroring how the TS parser scores `catch`); the
 *   trailing `Body`/`else`/`finally` sections are walked at the same depth as the statement.
 * @param {SyntaxNode} node - The `TryStatement` node.
 * @param {number} depth - Current nesting depth.
 * @returns {number} This node's cognitive complexity contribution, including its clauses.
 */
function scoreTryStatement(node: SyntaxNode, depth: number): number {
  let cognitive = 0;
  const kids = childrenOf(node);
  let i = 0;
  while (i < kids.length) {
    const kw = kids[i];
    if (kw?.type.name === "except") {
      cognitive += 1 + depth;
      i++;
      while (i < kids.length && kids[i]?.type.name !== "Body") {
        cognitive += walkNode(kids[i] as SyntaxNode, depth);
        i++;
      }
      if (i < kids.length) {
        cognitive += walkNode(kids[i] as SyntaxNode, depth);
        i++;
      }
    } else if (kw?.type.name === "Body") {
      cognitive += walkNode(kw, depth);
      i++;
    } else {
      i++;
    }
  }
  return cognitive;
}

/**
 * @description Scores a node whose own children are strictly more deeply nested than itself —
 *   `for`/`while` loops and `def`/`lambda` nested inside another function — which all share the
 *   same shape: a flat `1 + depth` for the node itself, then every child walked at `depth + 1`.
 * @param {SyntaxNode} node - The loop or nested-function node.
 * @param {number} depth - Current nesting depth (the node's own, not its children's).
 * @returns {number} This node's cognitive complexity contribution, including its body.
 */
function scoreNestedBlock(node: SyntaxNode, depth: number): number {
  let cognitive = 1 + depth;
  let child = node.firstChild;
  while (child) {
    cognitive += walkNode(child, depth + 1);
    child = child.nextSibling;
  }
  return cognitive;
}

/**
 * @description Sums the cognitive complexity of every direct child of `node`, each walked at the
 *   same depth as `node` itself — the fallthrough case for nodes with no scoring rule of their
 *   own (e.g. a module body, a plain statement list).
 * @param {SyntaxNode} node - The node whose children should be walked.
 * @param {number} depth - Nesting depth to walk the children at.
 * @returns {number} The summed cognitive complexity of all direct children.
 */
function walkChildren(node: SyntaxNode, depth: number): number {
  let cognitive = 0;
  let child = node.firstChild;
  while (child) {
    cognitive += walkNode(child, depth);
    child = child.nextSibling;
  }
  return cognitive;
}

/**
 * @description Dispatches one AST node to its scoring rule by node type — `IfStatement` and
 *   `TryStatement` each need their flat-children-list handling ({@link scoreIfStatement},
 *   {@link scoreTryStatement}); loops and nested `def`/`lambda` share the same nest-and-recurse
 *   shape ({@link scoreNestedBlock}); everything else contributes a flat +1 for ternaries and
 *   `and`/`or`, then recurses into its children at the same depth ({@link walkChildren}).
 * @param {SyntaxNode} node - The AST node to score.
 * @param {number} depth - Current nesting depth.
 * @returns {number} This node's cognitive complexity contribution, including its subtree.
 */
function walkNode(node: SyntaxNode, depth: number): number {
  const name = node.type.name;

  switch (name) {
    case "IfStatement":
      return scoreIfStatement(node, depth);
    case "TryStatement":
      return scoreTryStatement(node, depth);
    case "ForStatement":
    case "WhileStatement":
      return scoreNestedBlock(node, depth);
    default: {
      const own = name === "ConditionalExpression" || name === "and" || name === "or" ? 1 : 0;
      const isNestedFunction =
        depth > 0 && (name === "FunctionDefinition" || name === "LambdaExpression");
      if (isNestedFunction) return own + scoreNestedBlock(node, depth);

      return own + walkChildren(node, depth);
    }
  }
}

/**
 * @description Computes a simplified SonarSource-style cognitive complexity score for a Python
 *   AST node, tracking how hard the code is to read by adding a nesting penalty. See
 *   {@link walkNode} and its per-node-type scoring functions for the rules applied.
 * @param {SyntaxNode} rootNode - The AST root node to analyse (nesting depth resets to 0 here).
 * @returns {number} The cognitive complexity score, minimum 0.
 */
export function computeCognitiveComplexity(rootNode: SyntaxNode): number {
  return walkNode(rootNode, 0);
}

/**
 * @description Computes both McCabe cyclomatic complexity and cognitive complexity for a Python
 *   AST node by composing `computeCyclomaticComplexity` and `computeCognitiveComplexity`.
 * @param {SyntaxNode} node - The AST root node to analyse.
 * @returns {{ complexity: number; cognitiveComplexity: number }} Both scores.
 */
export function computeComplexity(node: SyntaxNode): {
  complexity: number;
  cognitiveComplexity: number;
} {
  return {
    complexity: computeCyclomaticComplexity(node),
    cognitiveComplexity: computeCognitiveComplexity(node),
  };
}

/**
 * @description Walks the entire Python source tree and records complexity for every named
 *   `def`: top-level functions, and class methods qualified as `ClassName.methodName` (mirroring
 *   the TS parser's convention). Functions nested inside another function or method are recorded
 *   with their own bare name, unqualified — matching the TS parser, which never prefixes plain
 *   nested function declarations with an enclosing class name either.
 * @param {Tree} tree - The parsed @lezer/python tree.
 * @param {string} content - Full source text.
 * @returns {FunctionComplexity[]} Per-function complexity entries, in traversal order.
 */
export function collectFunctionComplexity(tree: Tree, content: string): FunctionComplexity[] {
  const results: FunctionComplexity[] = [];

  function recordFunction(node: SyntaxNode, name: string): void {
    const { complexity, cognitiveComplexity } = computeComplexity(node);
    results.push({ name, line: lineAt(content, node.from), complexity, cognitiveComplexity });
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
            if (fnName) recordFunction(child, className ? `${className}.${fnName}` : fnName);
            walkChildren(child);
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
      if (nameNode) recordFunction(node, content.slice(nameNode.from, nameNode.to));
      walkChildren(node);
      return;
    }

    walkChildren(node);
  }

  walk(tree.topNode);
  return results;
}
