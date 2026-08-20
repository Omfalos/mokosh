/** Computes McCabe cyclomatic complexity and cognitive complexity for TypeScript/JavaScript source files. */
import ts from "typescript";

/**
 * @description Computes McCabe cyclomatic complexity for an AST node: every independent
 *   decision point counts (base 1) — `if`, ternary, `for`, `while`, `do`, `switch case`,
 *   `catch`, and each `&&` / `||` / `??` operator.
 * @param {ts.Node} rootNode - The AST root node to analyse — a whole `ts.SourceFile` for
 *   file-level totals, or any function-like node to score it in isolation.
 * @returns {number} The cyclomatic complexity score, minimum 1.
 */
export function computeCyclomaticComplexity(rootNode: ts.Node): number {
  let complexity = 1;

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
        const operatorKind = (node as ts.BinaryExpression).operatorToken.kind;
        if (
          operatorKind === ts.SyntaxKind.AmpersandAmpersandToken ||
          operatorKind === ts.SyntaxKind.BarBarToken ||
          operatorKind === ts.SyntaxKind.QuestionQuestionToken
        ) {
          complexity++;
        }
        break;
      }
    }
    ts.forEachChild(node, walkCyclomatic);
  }

  walkCyclomatic(rootNode);
  return complexity;
}

/**
 * @description Scores an `if` statement: a fresh `if` adds `1 + depth` and nests its
 *   condition/then-branch at `depth + 1`; a chained `else if` recurses into this same function at
 *   the *same* depth with `isElseIf: true` so it contributes only a flat +1 (mirroring how the
 *   cognitive model treats `else if` as a continuation, not new nesting); a bare `else` adds a
 *   flat +1 and nests its body at `depth + 1`.
 * @param {ts.IfStatement} node - The `if` statement node.
 * @param {number} depth - Current nesting depth.
 * @param {boolean} isElseIf - Whether `node` is itself the `else if` continuation of an
 *   enclosing `if` (so it contributes a flat +1 instead of `1 + depth`).
 * @returns {number} This node's cognitive complexity contribution, including its branches.
 */
function scoreIfStatement(node: ts.IfStatement, depth: number, isElseIf: boolean): number {
  let cognitive = isElseIf ? 1 : 1 + depth;
  const bodyDepth = isElseIf ? depth : depth + 1;
  cognitive += walkNode(node.expression, bodyDepth, false);
  cognitive += walkNode(node.thenStatement, bodyDepth, false);
  if (node.elseStatement) {
    if (ts.isIfStatement(node.elseStatement)) {
      cognitive += scoreIfStatement(node.elseStatement, depth, true);
    } else {
      cognitive += 1 + walkNode(node.elseStatement, depth + 1, false); // bare else
    }
  }
  return cognitive;
}

/**
 * @description Scores a node whose own children are strictly more deeply nested than itself —
 *   `for`/`while`/`do`/`switch` bodies and a function/lambda nested inside another function —
 *   which all share the same shape: a flat `1 + depth` for the node itself, then every child
 *   walked at `depth + 1`.
 * @param {ts.Node} node - The loop, switch, or nested-function node.
 * @param {number} depth - Current nesting depth (the node's own, not its children's).
 * @returns {number} This node's cognitive complexity contribution, including its body.
 */
function scoreNestedBlock(node: ts.Node, depth: number): number {
  let cognitive = 1 + depth;
  ts.forEachChild(node, (child) => {
    cognitive += walkNode(child, depth + 1, false);
  });
  return cognitive;
}

/**
 * @description Scores a `catch` clause: adds a flat `1 + depth` for the clause itself, but —
 *   unlike loops/`switch` — walks its children at the *same* depth rather than nesting them,
 *   matching the original algorithm's treatment of `catch` bodies as not adding indentation.
 * @param {ts.Node} node - The `catch` clause node.
 * @param {number} depth - Current nesting depth.
 * @returns {number} This node's cognitive complexity contribution, including its body.
 */
function scoreCatchClause(node: ts.Node, depth: number): number {
  let cognitive = 1 + depth;
  ts.forEachChild(node, (child) => {
    cognitive += walkNode(child, depth, false);
  });
  return cognitive;
}

/**
 * @description Sums the cognitive complexity of every direct child of `node`, each walked at the
 *   same depth as `node` itself — the fallthrough case for nodes with no scoring rule of their
 *   own (e.g. a block, a plain statement, a binary expression's operands).
 * @param {ts.Node} node - The node whose children should be walked.
 * @param {number} depth - Nesting depth to walk the children at.
 * @returns {number} The summed cognitive complexity of all direct children.
 */
function walkChildren(node: ts.Node, depth: number): number {
  let cognitive = 0;
  ts.forEachChild(node, (child) => {
    cognitive += walkNode(child, depth, false);
  });
  return cognitive;
}

/**
 * @description Reports whether a binary expression's operator is `&&`, `||`, or `??` — the only
 *   operators that count as cognitive-complexity decision points.
 * @param {ts.BinaryExpression} node - The binary expression node.
 * @returns {boolean} `true` if the operator is `&&`, `||`, or `??`.
 */
function isLogicalOrNullishBinary(node: ts.BinaryExpression): boolean {
  const operatorKind = node.operatorToken.kind;
  return (
    operatorKind === ts.SyntaxKind.AmpersandAmpersandToken ||
    operatorKind === ts.SyntaxKind.BarBarToken ||
    operatorKind === ts.SyntaxKind.QuestionQuestionToken
  );
}

/**
 * @description Dispatches one AST node to its scoring rule by node kind — `if` statements need
 *   their chained-`else if`-aware handling ({@link scoreIfStatement}); loops, `switch`, and
 *   nested functions/lambdas share the same nest-and-recurse shape ({@link scoreNestedBlock});
 *   `catch` clauses nest their own +1 but not their children ({@link scoreCatchClause});
 *   everything else contributes a flat +1 for ternaries and `&&`/`||`/`??`
 *   ({@link isLogicalOrNullishBinary}), then recurses into its children at the same depth
 *   ({@link walkChildren}).
 * @param {ts.Node} node - The AST node to score.
 * @param {number} depth - Current nesting depth.
 * @param {boolean} isElseIf - Whether `node` is itself an `else if` continuation (only meaningful
 *   when `node` is an `if` statement; see {@link scoreIfStatement}).
 * @returns {number} This node's cognitive complexity contribution, including its subtree.
 */
function walkNode(node: ts.Node, depth: number, isElseIf: boolean): number {
  if (ts.isIfStatement(node)) return scoreIfStatement(node, depth, isElseIf);

  if (
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node) ||
    ts.isSwitchStatement(node)
  ) {
    return scoreNestedBlock(node, depth);
  }

  if (ts.isCatchClause(node)) return scoreCatchClause(node, depth);

  let own = 0;
  if (ts.isConditionalExpression(node)) own += 1;
  if (ts.isBinaryExpression(node) && isLogicalOrNullishBinary(node)) own += 1;

  const isNestedFunction =
    depth > 0 &&
    (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node));
  if (isNestedFunction) return own + scoreNestedBlock(node, depth);

  return own + walkChildren(node, depth);
}

/**
 * @description Computes a simplified SonarSource-style cognitive complexity score for an AST
 *   node, tracking how hard the code is to read by adding a nesting penalty. See {@link walkNode}
 *   and its per-node-kind scoring functions for the rules applied.
 * @param {ts.Node} rootNode - The AST root node to analyse — a whole `ts.SourceFile` for
 *   file-level totals, or any function-like node to score it in isolation (nesting depth
 *   resets to 0 at `rootNode`).
 * @returns {number} The cognitive complexity score, minimum 0.
 */
export function computeCognitiveComplexity(rootNode: ts.Node): number {
  return walkNode(rootNode, 0, false);
}

/**
 * @description Computes both McCabe cyclomatic complexity and a simplified SonarSource-style
 *   cognitive complexity for a TypeScript/JavaScript AST node, by composing
 *   `computeCyclomaticComplexity` and `computeCognitiveComplexity`.
 * @param {ts.Node} node - The AST root node to analyse — a whole `ts.SourceFile` for file-level
 *   totals, or any function-like node to score it in isolation.
 * @returns {{ complexity: number; cognitiveComplexity: number }} Both scores, minimum 1 / 0 respectively.
 */
export function computeComplexity(node: ts.Node): {
  complexity: number;
  cognitiveComplexity: number;
} {
  return {
    complexity: computeCyclomaticComplexity(node),
    cognitiveComplexity: computeCognitiveComplexity(node),
  };
}
