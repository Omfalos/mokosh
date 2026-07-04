/** Computes McCabe cyclomatic complexity and cognitive complexity for TypeScript/JavaScript source files. */
import ts from "typescript";

/**
 * @description Computes McCabe cyclomatic complexity and a simplified SonarSource-style cognitive
 *   complexity for a TypeScript/JavaScript source file.
 *
 *   **Cyclomatic** counts every independent decision point (base 1): `if`, ternary, `for`,
 *   `while`, `do`, `switch case`, `catch`, and each `&&` / `||` / `??` operator.
 *
 *   **Cognitive** tracks how hard the code is to read by adding a nesting penalty.
 *   Structural nodes (`if`, loops, `switch`, `catch`) increment by `1 + current nesting depth`
 *   and increase the depth for their children. Chained `else if` gets +1 (no nesting bonus).
 *   A bare `else` gets +1. Logical operators and ternaries each add +1 without nesting.
 *   Nested functions (lambdas, inner functions) add `1 + depth` and increase nesting.
 * @param node - The AST root node to analyse — a whole `ts.SourceFile` for file-level totals, or
 *   any function-like node to score it in isolation (nesting depth resets to 0 at `node`).
 * @returns `{ complexity, cognitiveComplexity }` — both integers, minimum 1 / 0 respectively.
 */
export function computeComplexity(node: ts.Node): {
  complexity: number;
  cognitiveComplexity: number;
} {
  let complexity = 1;
  let cognitiveComplexity = 0;

  // --- Cyclomatic ---
  function walkCyclomatic(node: ts.Node): void {
    switch (node.kind) {
      case ts.SyntaxKind.IfStatement:
      case ts.SyntaxKind.ConditionalExpression:
      case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.ForOfStatement:
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.DoStatement:
      case ts.SyntaxKind.CatchClause:
      case ts.SyntaxKind.CaseClause:
        complexity++;
        break;
      case ts.SyntaxKind.BinaryExpression: {
        const op = (node as ts.BinaryExpression).operatorToken.kind;
        if (
          op === ts.SyntaxKind.AmpersandAmpersandToken ||
          op === ts.SyntaxKind.BarBarToken ||
          op === ts.SyntaxKind.QuestionQuestionToken
        ) {
          complexity++;
        }
        break;
      }
    }
    ts.forEachChild(node, walkCyclomatic);
  }

  // --- Cognitive ---
  function walkCognitive(node: ts.Node, depth: number, isElseIf: boolean): void {
    if (ts.isIfStatement(node)) {
      // else-if chains: flat +1; fresh if: +1 + nesting
      cognitiveComplexity += isElseIf ? 1 : 1 + depth;
      const bodyDepth = isElseIf ? depth : depth + 1;
      walkCognitive(node.expression, bodyDepth, false);
      walkCognitive(node.thenStatement, bodyDepth, false);
      if (node.elseStatement) {
        if (ts.isIfStatement(node.elseStatement)) {
          walkCognitive(node.elseStatement, depth, true);
        } else {
          cognitiveComplexity += 1; // bare else
          walkCognitive(node.elseStatement, depth + 1, false);
        }
      }
      return;
    }

    if (
      ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node) ||
      ts.isSwitchStatement(node)
    ) {
      cognitiveComplexity += 1 + depth;
      ts.forEachChild(node, (child) => walkCognitive(child, depth + 1, false));
      return;
    }

    if (ts.isCatchClause(node)) {
      cognitiveComplexity += 1 + depth;
      ts.forEachChild(node, (child) => walkCognitive(child, depth, false));
      return;
    }

    if (ts.isConditionalExpression(node)) {
      cognitiveComplexity += 1;
    }

    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (
        op === ts.SyntaxKind.AmpersandAmpersandToken ||
        op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.QuestionQuestionToken
      ) {
        cognitiveComplexity += 1;
      }
    }

    // Nested functions and lambdas increase nesting for their body
    const isNestedFn =
      depth > 0 &&
      (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node));
    if (isNestedFn) {
      cognitiveComplexity += 1 + depth;
      ts.forEachChild(node, (child) => walkCognitive(child, depth + 1, false));
      return;
    }

    ts.forEachChild(node, (child) => walkCognitive(child, depth, false));
  }

  walkCyclomatic(node);
  walkCognitive(node, 0, false);

  return { complexity, cognitiveComplexity };
}
