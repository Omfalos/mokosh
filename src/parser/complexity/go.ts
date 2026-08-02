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
 * @description Computes a simplified SonarSource-style cognitive complexity score for a Go AST
 *   node, tracking how hard the code is to read by adding a nesting penalty. Mirrors the
 *   TypeScript algorithm: `if`/`for`/`switch` increment by `1 + current nesting depth` and
 *   increase depth for their children; chained `else if` gets +1 flat; a bare `else` gets +1
 *   flat; `&&`/`||` each add +1 flat; nested function literals add `1 + depth`.
 * @param {SyntaxNode} rootNode - The AST root node to analyse (nesting depth resets to 0 here).
 * @param {string} content - Full source text, used to read operator token text.
 * @returns {number} The cognitive complexity score, minimum 0.
 */
export function computeCognitiveComplexity(rootNode: SyntaxNode, content: string): number {
  let cognitive = 0;

  function walk(node: SyntaxNode, depth: number, isElseIf: boolean): void {
    const name = node.type.name;

    if (name === "IfStatement") {
      cognitive += isElseIf ? 1 : 1 + depth;
      const kids = childrenOf(node);
      const bodyDepth = isElseIf ? depth : depth + 1;

      const cond = kids[1];
      if (cond && cond.type.name !== "Block") walk(cond, bodyDepth, false);

      const thenBlock = kids.find((k) => k.type.name === "Block");
      if (thenBlock) walk(thenBlock, bodyDepth, false);

      const elseIndex = kids.findIndex((k) => k.type.name === "else");
      if (elseIndex >= 0) {
        const after = kids[elseIndex + 1];
        if (after?.type.name === "IfStatement") {
          walk(after, depth, true);
        } else if (after) {
          cognitive += 1;
          walk(after, depth + 1, false);
        }
      }
      return;
    }

    if (name === "ForStatement" || name === "SwitchStatement" || name === "SelectStatement") {
      cognitive += 1 + depth;
      let child = node.firstChild;
      while (child) {
        walk(child, depth + 1, false);
        child = child.nextSibling;
      }
      return;
    }

    if (name === "LogicOp") {
      const text = content.slice(node.from, node.to);
      if (text === "&&" || text === "||") cognitive += 1;
    }

    const isNestedFunctionLiteral = depth > 0 && name === "FunctionLiteral";
    if (isNestedFunctionLiteral) {
      cognitive += 1 + depth;
      let child = node.firstChild;
      while (child) {
        walk(child, depth + 1, false);
        child = child.nextSibling;
      }
      return;
    }

    let child = node.firstChild;
    while (child) {
      walk(child, depth, false);
      child = child.nextSibling;
    }
  }

  walk(rootNode, 0, false);
  return cognitive;
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
