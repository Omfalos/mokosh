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
 * @description Computes a simplified SonarSource-style cognitive complexity score for a Python
 *   AST node, tracking how hard the code is to read by adding a nesting penalty. Since Python's
 *   `if`/`elif`/`else` chain is one flat `IfStatement` node (not nested, unlike TS/Go), this walks
 *   its direct children in groups: each fresh `if` adds `1 + depth` and nests its body; each
 *   `elif` adds a flat +1 at the same depth as the original `if`; a bare `else` adds a flat +1 and
 *   nests its body. `for`/`while` add `1 + depth` and nest their body. Each `except` clause adds
 *   `1 + depth` without increasing nesting for its own body (mirroring how the TS parser scores
 *   `catch`). Ternaries and `and`/`or` each add a flat +1. Nested `def`/`lambda` add `1 + depth`.
 * @param {SyntaxNode} rootNode - The AST root node to analyse (nesting depth resets to 0 here).
 * @returns {number} The cognitive complexity score, minimum 0.
 */
export function computeCognitiveComplexity(rootNode: SyntaxNode): number {
  let cognitive = 0;

  function walk(node: SyntaxNode, depth: number): void {
    const name = node.type.name;

    if (name === "IfStatement") {
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
          if (cond) walk(cond, bodyDepth);
          if (body) walk(body, bodyDepth);
          branchIndex++;
          i += 3;
        } else if (kw?.type.name === "else") {
          cognitive += 1;
          const body = kids[i + 1];
          if (body) walk(body, depth + 1);
          i += 2;
        } else {
          i++;
        }
      }
      return;
    }

    if (name === "TryStatement") {
      const kids = childrenOf(node);
      let i = 0;
      while (i < kids.length) {
        const kw = kids[i];
        if (kw?.type.name === "except") {
          cognitive += 1 + depth;
          i++;
          while (i < kids.length && kids[i]?.type.name !== "Body") {
            walk(kids[i] as SyntaxNode, depth);
            i++;
          }
          if (i < kids.length) {
            walk(kids[i] as SyntaxNode, depth);
            i++;
          }
        } else if (kw?.type.name === "Body") {
          walk(kw, depth);
          i++;
        } else {
          i++;
        }
      }
      return;
    }

    if (name === "ForStatement" || name === "WhileStatement") {
      cognitive += 1 + depth;
      let child = node.firstChild;
      while (child) {
        walk(child, depth + 1);
        child = child.nextSibling;
      }
      return;
    }

    if (name === "ConditionalExpression" || name === "and" || name === "or") {
      cognitive += 1;
    }

    const isNestedFunction =
      depth > 0 && (name === "FunctionDefinition" || name === "LambdaExpression");
    if (isNestedFunction) {
      cognitive += 1 + depth;
      let child = node.firstChild;
      while (child) {
        walk(child, depth + 1);
        child = child.nextSibling;
      }
      return;
    }

    let child = node.firstChild;
    while (child) {
      walk(child, depth);
      child = child.nextSibling;
    }
  }

  walk(rootNode, 0);
  return cognitive;
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
