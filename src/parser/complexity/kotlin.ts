/** Call-edge extraction for Kotlin source, walking the first-party @lezer grammar's tree (see
 *  src/parser/lang/kotlin/PROGRESS.md, docs/adr-021-kotlin-parsing.md). Kotlin has no distinct
 *  call-expression node analogous to Java's `MethodInvocation`/`ObjectCreationExpression` split,
 *  and no `new` keyword — every call is a `CallExpression` whose callee shape (bare `Identifier`
 *  vs. single-level `NavigationExpression`) decides whether it's a qualified call, a bare call to
 *  an imported function, or (bare + capitalized) a constructor call. Mirrors ./java.ts's scope
 *  and limitations: only calls against an imported/aliased simple name resolve — a bare call to
 *  a same-package (unimported) sibling's function is not attempted (see
 *  docs/known_issues/12-call-edge-same-package-resolution.md); nor are instance calls through a
 *  variable/field, multi-level qualifiers (`a.b.c()`), or virtual dispatch. Complexity extraction
 *  (Phase 2 of the Kotlin plan) will live in this same file alongside these helpers. */
import type { SyntaxNode, Tree } from "@lezer/common";
import type { FunctionComplexity } from "../../types/node";
import { jvmSamePackageCallSpecifier } from "../lang/jvm-scan";
import type { RawCallEdge } from "../types";
import { childrenOf, lineAt, nodeHasError } from "./lezer-utils";

/** Above this error-node-span ratio, the whole-file tree (checked in `src/parser/lang/kotlin.ts`)
 *  is untrustworthy enough that extraction is skipped entirely rather than risk emitting a wrong
 *  result — see `docs/adr-021-kotlin-parsing.md` and the Phase 1 corpus gate result it's based on
 *  (OkHttp: 1.02% overall, worst single-file outliers ~22%, all attributable to documented
 *  grammar scope cuts). `collectFunctionComplexity` below additionally applies a **per-function**
 *  gate via {@link nodeHasError} — zero-tolerance, not a percentage, because a file-wide ratio can
 *  stay low while one function's body alone is severely corrupted with only near-zero-width error
 *  nodes (see {@link nodeHasError}'s doc comment for the real OkHttp case, `DiskLruCache.close`,
 *  that motivated it: cyclomatic complexity inflated from ~4 to 46 with an error ratio of under
 *  1%). `collectCallEdges` does *not* apply that per-function gate: an edge comes from a single
 *  `CallExpression` node, so an error elsewhere in the body can't corrupt it the way it can inflate
 *  a whole-body complexity count. */
export const ERROR_RATIO_THRESHOLD = 0.05;

const TYPE_DECL_NODES = new Set(["ClassDeclaration", "ObjectDeclaration", "CompanionObject"]);

/**
 * @description Reads the name of the nearest enclosing `ClassDeclaration` / `ObjectDeclaration` /
 *   `CompanionObject` for a function/constructor node, so members can be qualified as
 *   `TypeName.functionName` to mirror the TS/Java parsers' convention. Skips past an anonymous
 *   `CompanionObject` (no `Definition`) to the class that owns it.
 * @param node - The `FunctionDeclaration` / `SecondaryConstructor` node.
 * @param content - Full source text, used to slice the type name.
 * @returns The enclosing type's bare name, or `undefined` at file top level.
 */
function enclosingTypeName(node: SyntaxNode, content: string): string | undefined {
  for (let p = node.parent; p; p = p.parent) {
    if (TYPE_DECL_NODES.has(p.type.name)) {
      const nameNode = p.getChild("Definition");
      if (nameNode) return content.slice(nameNode.from, nameNode.to);
    }
  }
  return undefined;
}

/**
 * @description Reads the simple type name out of a `type` position (`ConstructorInvocation`'s
 *   type, or a `new`-equivalent constructor call's callee), unwrapping the shapes the grammar
 *   produces: `TypeName` directly, `GenericType › TypeName` (drops `<...>`), and
 *   `ScopedTypeName` (last dotted segment). Mirrors `java.ts`'s `constructedTypeName`.
 * @param typeNode - The child node in the type position.
 * @param content - Full source text.
 * @returns The simple type name, or `null` for a shape this covers no rule for (e.g. a function
 *   type or nullable type used as a delegation specifier — both rare in practice).
 */
function simpleTypeName(typeNode: SyntaxNode | null, content: string): string | null {
  let node = typeNode;
  if (node?.type.name === "GenericType") node = node.firstChild;
  if (!node) return null;
  if (node.type.name === "TypeName") return content.slice(node.from, node.to);
  if (node.type.name === "ScopedTypeName") {
    let last: SyntaxNode | null = null;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.type.name === "TypeName") last = child;
    }
    return last ? content.slice(last.from, last.to) : null;
  }
  return null;
}

/** A `CallExpression`'s callee, read off its leading `baseExpression` child. `qualifier` is
 *  present only for a single-level `Identifier.Identifier` navigation — deeper chains
 *  (`a.b.c()`) and non-identifier bases (`this.x()`, `list[0]()`) are not resolved. */
interface Callee {
  qualifier?: string;
  name: string;
}

function readCallee(callExpr: SyntaxNode, content: string): Callee | null {
  const base = callExpr.firstChild;
  if (!base) return null;
  if (base.type.name === "Identifier") {
    return { name: content.slice(base.from, base.to) };
  }
  if (base.type.name === "NavigationExpression") {
    const qualifier = base.firstChild;
    const member = base.lastChild;
    if (qualifier?.type.name === "Identifier" && member?.type.name === "Identifier") {
      return {
        qualifier: content.slice(qualifier.from, qualifier.to),
        name: content.slice(member.from, member.to),
      };
    }
  }
  return null;
}

/**
 * @description Walks a function/constructor body and records one `RawCallEdge` per resolvable
 *   call: a qualified call (`Core.shout(x)`, `Core?.shout(x)`) whose qualifier resolves via
 *   `localNames`; or a bare call whose name itself resolves via `localNames` — i.e. it names an
 *   explicitly imported symbol, not a same-package one (see docs/known_issues/12, not fixed
 *   here). A capitalized bare name is Kotlin's constructor-call convention (labeled `"new"` to
 *   match Java's, since Kotlin has no `new` keyword); a lowercase bare name is a direct call to
 *   an imported top-level function (`import pkg.parseThing` then `parseThing()`), labeled with
 *   its own name like the qualified-call case.
 *   Both a trailing `ArgumentList` and a `TrailingLambda` are children of the same single
 *   `CallExpression` node, so `Core.shout("x") { ... }` naturally yields one edge, not two.
 * @param bodyNode - The function/constructor body (or any subtree) to walk.
 * @param callerName - The already-qualified caller name to attach to every emitted edge.
 * @param content - Full source text.
 * @param localNames - Simple/aliased local name → FQN specifier map (built from the file's own
 *   import lines, including `as` aliases that `ImportEdge` itself never retains).
 * @param ownPackage - The file's own declared `package`, or `null` for the default package. A
 *   bare call that misses `localNames` gets a deferred same-package marker instead of being
 *   dropped (see docs/known_issues/12-call-edge-same-package-resolution.md) — resolved later by
 *   `GraphBuilder`'s post-drain pass, never here, since a sibling file's `exports` may not exist
 *   yet while this file is being parsed. No marker is possible without a known package.
 * @param edges - Accumulator array, appended to in place.
 */
function walkBody(
  bodyNode: SyntaxNode,
  callerName: string,
  content: string,
  localNames: ReadonlyMap<string, string>,
  ownPackage: string | null,
  edges: RawCallEdge[],
): void {
  if (bodyNode.type.name === "CallExpression") {
    const callee = readCallee(bodyNode, content);
    if (callee) {
      if (callee.qualifier) {
        const toSpecifier = localNames.get(callee.qualifier);
        if (toSpecifier) edges.push({ from: callerName, to: callee.name, toSpecifier });
      } else {
        const toSpecifier = localNames.get(callee.name);
        const isConstructorCall = /^[A-Z]/.test(callee.name);
        if (toSpecifier) {
          edges.push({
            from: callerName,
            to: isConstructorCall ? "new" : callee.name,
            toSpecifier,
          });
        } else if (ownPackage) {
          // Same-package miss (issue 12): no parse-time filter — every miss (including a bare
          // call to a stdlib function, or to a same-file local declaration, which the post-drain
          // pass's exports-based lookup will simply fail to match against any *other* file and
          // drop) gets a marker. The builder's cheap map lookup absorbs the noise.
          edges.push({
            from: callerName,
            to: isConstructorCall ? "new" : callee.name,
            toSpecifier: jvmSamePackageCallSpecifier(ownPackage, callee.name),
          });
        }
      }
    }
  }
  let child = bodyNode.firstChild;
  while (child) {
    walkBody(child, callerName, content, localNames, ownPackage, edges);
    child = child.nextSibling;
  }
}

/**
 * @description Records one `RawCallEdge` per superclass/interface constructor call in a
 *   `class Foo : Base(args)` (or `object`/`companion object`) delegation list, when `Base`
 *   resolves via `localNames`. Kotlin's `ConstructorInvocation` (`type ArgumentList`) is the
 *   direct analogue of Java's `extends Base(...)` constructor-call shape.
 * @param tree - The parsed Kotlin tree.
 * @param content - Full source text.
 * @param localNames - Simple/aliased local name → FQN specifier map.
 * @param ownPackage - The file's own declared `package`, or `null` — see {@link walkBody}'s
 *   matching parameter doc comment.
 * @returns One edge per resolvable superclass constructor call, `from` the declaring type.
 */
function collectSuperclassCallEdges(
  tree: Tree,
  content: string,
  localNames: ReadonlyMap<string, string>,
  ownPackage: string | null,
): RawCallEdge[] {
  const edges: RawCallEdge[] = [];
  const cursor = tree.cursor();
  do {
    if (!TYPE_DECL_NODES.has(cursor.name)) continue;
    const defNode = cursor.node.getChild("Definition");
    const delegations = cursor.node.getChild("DelegationSpecifiers");
    if (!defNode || !delegations) continue;
    const ownerName = content.slice(defNode.from, defNode.to);
    // Each list entry is a `DelegationSpecifier` wrapper, not a `ConstructorInvocation` directly
    // (`DelegationSpecifier { ConstructorInvocation | ExplicitDelegation | type }`) — unwrap one
    // level before checking the shape.
    for (let child = delegations.firstChild; child; child = child.nextSibling) {
      if (child.type.name !== "DelegationSpecifier") continue;
      const inv = child.firstChild;
      if (inv?.type.name !== "ConstructorInvocation") continue;
      const simpleName = simpleTypeName(inv.firstChild, content);
      if (!simpleName) continue;
      const toSpecifier = localNames.get(simpleName);
      if (toSpecifier) {
        edges.push({ from: ownerName, to: "new", toSpecifier });
      } else if (ownPackage) {
        edges.push({
          from: ownerName,
          to: "new",
          toSpecifier: jvmSamePackageCallSpecifier(ownPackage, simpleName),
        });
      }
    }
  } while (cursor.next());
  return edges;
}

/**
 * @description Walks every `FunctionDeclaration` and `SecondaryConstructor` body plus every
 *   class/object/companion-object superclass delegation list, and returns the resolvable call
 *   edges found — see {@link walkBody} and {@link collectSuperclassCallEdges}. The caller (Kotlin's
 *   line-scanner parser) is responsible for skipping this entirely for test files and for gating
 *   it on the tree's error ratio, since a high-error-density parse would silently corrupt edges
 *   rather than just miss them.
 * @param tree - The parsed Kotlin tree.
 * @param content - Full source text.
 * @param localNames - Simple/aliased local name → FQN specifier map, built from the file's
 *   `import ... as ...` lines (see `src/parser/lang/kotlin.ts`).
 * @param ownPackage - The file's own declared `package`, or `null` for the default package —
 *   threaded through to {@link walkBody}/{@link collectSuperclassCallEdges} so a same-package miss
 *   gets a deferred marker instead of being dropped (docs/known_issues/12).
 * @returns All resolvable call edges, function-body edges before superclass-constructor edges.
 */
export function collectCallEdges(
  tree: Tree,
  content: string,
  localNames: ReadonlyMap<string, string>,
  ownPackage: string | null = null,
): RawCallEdge[] {
  const edges: RawCallEdge[] = [];
  const cursor = tree.cursor();
  do {
    if (cursor.name !== "FunctionDeclaration" && cursor.name !== "SecondaryConstructor") continue;
    // Error recovery (notably in `.kts` scripts, whose top-level statements the grammar can't
    // parse) can fabricate a `FunctionDeclaration` around a call like `kotlin("multiplatform")`.
    // A real declaration always carries its `fun` keyword token.
    if (cursor.name === "FunctionDeclaration" && !cursor.node.getChild("fun")) continue;
    const owner = enclosingTypeName(cursor.node, content);
    let callerName: string;
    if (cursor.name === "SecondaryConstructor") {
      callerName = owner ?? "constructor";
    } else {
      const nameNode = cursor.node.getChild("Definition");
      if (!nameNode) continue;
      const bare = content.slice(nameNode.from, nameNode.to);
      callerName = owner ? `${owner}.${bare}` : bare;
    }
    // `functionBody` is a lowercase (inline) rule with no node of its own; its two alternatives
    // surface directly as a child: a real `Block` node, or (for `fun f() = expr()`) whichever
    // concrete node `expression`'s `[@isGroup=Expression]` tag lets `getChild` find generically.
    // No per-function error gate here (unlike collectFunctionComplexity below): an edge is read
    // from one `CallExpression` node, so an error elsewhere in the body can't corrupt it.
    const body = cursor.node.getChild("Block") ?? cursor.node.getChild("Expression");
    if (body) walkBody(body, callerName, content, localNames, ownPackage, edges);
  } while (cursor.next());

  edges.push(...collectSuperclassCallEdges(tree, content, localNames, ownPackage));
  return edges;
}

/* ------------------------------------------------------------------------------------------- *
 * Complexity (Phase 2 of the Kotlin plan — see src/parser/lang/kotlin/PROGRESS.md's "How to
 * resume" section). Mirrors ./java.ts's shape (cyclomatic + a nesting-aware cognitive score), but
 * the node names below are this grammar's own, not Java's — several differ in ways that matter:
 *
 * - `op<tag, expr> { expr }` (kotlin.grammar) is a pass-through macro: `&&`/`||` never get a
 *   wrapping node the way Java's `LogicOp` does. They surface as bare literal-token nodes whose
 *   own `type.name` *is* the operator text (Lezer's standard convention for anonymous literals —
 *   the same convention already relied on elsewhere in this grammar, e.g. `"if"`/`"else"` as
 *   plain keyword-token names). `Elvis` (`?:`) *is* a named external token, so it's checked by
 *   name instead of by slicing text.
 * - A chained `else if` is *not* a direct `IfExpression` child the way Java's is: Kotlin has no
 *   separate if-statement node (`if` is always an expression, see kotlin.grammar's `statement`
 *   rule comment), so `else if (...) { ... }` reaches the tree as
 *   `ExpressionStatement > IfExpression`, one level deeper than Java's shape.
 * - This grammar tags **every** brace body — including a plain `if`/`while`/`for`/`when`
 *   control-flow body — as `LambdaLiteral`, not `Block` (kotlin.grammar's `controlBody` comment:
 *   a bare `Block` and a bare `LambdaLiteral` are structurally identical, so only one is kept).
 *   Java's "a nested `LambdaExpression` adds a closure-nesting penalty" rule can't port as-is: a
 *   `LambdaLiteral` must be excluded from that penalty whenever it's actually serving as a
 *   control-flow body brace, or every ordinary `if (x) { ... }` would be miscounted as a closure.
 *   {@link isControlFlowBodyBrace} is the exclusion check.
 * ------------------------------------------------------------------------------------------- */

/** Loop constructs that each introduce one independent path. */
const LOOP_NODES = new Set(["ForStatement", "WhileStatement", "DoWhileStatement"]);

/** `IfExpression`/`WhileStatement`/`ForStatement`/`DoWhileStatement`/`WhenEntry` all reach their
 *  brace body via an inlined `controlBody -> statement` chain that (for a bare `{ ... }`) bottoms
 *  out at `ExpressionStatement > LambdaLiteral` — see the module doc comment above. */
const CONTROL_BODY_HOSTS = new Set([
  "IfExpression",
  "WhileStatement",
  "ForStatement",
  "DoWhileStatement",
  "WhenEntry",
]);

/**
 * @description Reports whether a `LambdaLiteral` is actually a control-flow body brace (an `if`/
 *   `while`/`for`/`when-entry`'s `{ ... }`) rather than a genuine closure — see the module doc
 *   comment above for why this grammar can't tell the two apart structurally on its own.
 * @param node - The `LambdaLiteral` node.
 * @returns `true` when this brace is a control-flow body, not a real lambda.
 */
function isControlFlowBodyBrace(node: SyntaxNode): boolean {
  const parent = node.parent;
  if (parent?.type.name !== "ExpressionStatement") return false;
  const grandparent = parent.parent;
  return !!grandparent && CONTROL_BODY_HOSTS.has(grandparent.type.name);
}

/**
 * @description Reads a `BinaryExpression`'s operator text when it's one of the operators this
 *   grammar gives no dedicated child node (`&&`, `||`, and every other `op<>`-macro operator
 *   except `Elvis` — see the module doc comment above: `op<tag, expr> { expr }` inlines a bare
 *   string-literal token, and **@lezer/generator never emits a tree node for an unnamed literal
 *   token** — confirmed empirically: `a && b` parses as `BinaryExpression { Identifier, Identifier }`,
 *   two children with nothing between them, not three). Only fires for that exact two-child shape;
 *   a three-child `BinaryExpression` is an Elvis expression, whose middle child is already a
 *   genuinely named (and therefore visible) `Elvis` node, checked separately by both callers.
 * @param node - A `BinaryExpression` node.
 * @param content - Full source text, sliced between the two operand children.
 * @returns The operator text (`"&&"`, `"||"`, `"+"`, `"<"`, …), or `null` for any other shape.
 */
function invisibleBinaryOperator(node: SyntaxNode, content: string): string | null {
  const kids = childrenOf(node);
  if (kids.length !== 2) return null;
  const [left, right] = kids;
  if (!left || !right) return null;
  return content.slice(left.to, right.from).trim();
}

/**
 * @description Computes McCabe cyclomatic complexity for a Kotlin AST node: every independent
 *   decision point counts (base 1) — `IfExpression`, any loop, each non-`else` `WhenEntry`, each
 *   `CatchClause`, and each `&&`/`||`/`?:` occurrence.
 * @param rootNode - The AST root node to analyse — the whole file's top node for file-level
 *   totals, or a `FunctionDeclaration`/`SecondaryConstructor` body to score it alone.
 * @param content - Full source text, needed to read `&&`/`||` (see {@link invisibleBinaryOperator}).
 * @returns The cyclomatic complexity score, minimum 1.
 */
export function computeCyclomaticComplexity(rootNode: SyntaxNode, content: string): number {
  let complexity = 1;

  function walk(node: SyntaxNode): void {
    const name = node.type.name;
    if (name === "IfExpression" || name === "CatchClause" || name === "Elvis") {
      complexity++;
    } else if (LOOP_NODES.has(name)) {
      complexity++;
    } else if (name === "WhenEntry") {
      if (node.firstChild?.type.name !== "else") complexity++;
    } else if (name === "BinaryExpression") {
      const op = invisibleBinaryOperator(node, content);
      if (op === "&&" || op === "||") complexity++;
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
 * @description Scores an `IfExpression`: an initial `if` adds `1 + depth` and nests its condition/
 *   body at `depth + 1`; a chained `else if` — reached as `ExpressionStatement > IfExpression`,
 *   see the module doc comment above — recurses into this same function at the *same* depth with
 *   `isElseIf: true` so it adds only a flat +1; a bare `else` adds a flat +1 and nests its body at
 *   `depth + 1`.
 * @param node - The `IfExpression` node.
 * @param depth - Current nesting depth.
 * @param isElseIf - Whether this `IfExpression` is itself the `else if` continuation of an
 *   enclosing one (so it contributes a flat +1 instead of `1 + depth`).
 * @param content - Full source text, threaded through to {@link walkNode}.
 * @returns This node's cognitive complexity contribution, including its branches.
 */
function scoreIfExpression(
  node: SyntaxNode,
  depth: number,
  isElseIf: boolean,
  content: string,
): number {
  let cognitive = isElseIf ? 1 : 1 + depth;
  const kids = childrenOf(node);
  const bodyDepth = isElseIf ? depth : depth + 1;

  // `(`/`)` are unnamed literal tokens and never reach the tree (see invisibleBinaryOperator's
  // doc comment for the same phenomenon) — kids are simply "if" condition body ["else" elseBody].
  const cond = kids[1];
  if (cond) cognitive += walkNode(cond, bodyDepth, false, content);

  const body = kids[2];
  if (body) cognitive += walkNode(body, bodyDepth, false, content);

  const elseIndex = kids.findIndex((k) => k.type.name === "else");
  if (elseIndex >= 0) {
    const elseBody = kids[elseIndex + 1];
    if (
      elseBody?.type.name === "ExpressionStatement" &&
      elseBody.firstChild?.type.name === "IfExpression"
    ) {
      cognitive += scoreIfExpression(elseBody.firstChild, depth, true, content);
    } else if (elseBody) {
      cognitive += 1 + walkNode(elseBody, depth + 1, false, content);
    }
  }
  return cognitive;
}

/**
 * @description Scores a node whose own children are strictly more deeply nested than itself —
 *   loops, `WhenExpression`, and `CatchClause` — which all share the same shape: a flat
 *   `1 + depth` for the node itself, then every child walked at `depth + 1`.
 * @param node - The loop / `WhenExpression` / `CatchClause` node.
 * @param depth - Current nesting depth (the node's own, not its children's).
 * @param content - Full source text, threaded through to {@link walkNode}.
 * @returns This node's cognitive complexity contribution, including its body.
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
 *   own, and also how a control-flow-body `LambdaLiteral` (see the module doc comment above) is
 *   walked transparently: its statements count at the same depth its enclosing `if`/loop/`when`
 *   already nested them to, not one level deeper.
 * @param node - The node whose children should be walked.
 * @param depth - Nesting depth to walk the children at.
 * @param content - Full source text, threaded through to {@link walkNode}.
 * @returns The summed cognitive complexity of all direct children.
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
 * @description Dispatches one AST node to its scoring rule by node type — `IfExpression` needs its
 *   chained-`else if`-aware handling ({@link scoreIfExpression}); loops, `WhenExpression`, and
 *   `CatchClause` share the same nest-and-recurse shape ({@link scoreNestedBlock}); a genuine
 *   nested `LambdaLiteral` (excluding a control-flow body brace, see
 *   {@link isControlFlowBodyBrace}) adds a nesting level; everything else contributes a flat +1
 *   for `&&`/`||`/`?:` ({@link invisibleBinaryOperator}), then recurses into its children at the
 *   same depth ({@link walkChildren}).
 * @param node - The AST node to score.
 * @param depth - Current nesting depth.
 * @param isElseIf - Whether `node` is itself an `else if` continuation (only meaningful when
 *   `node` is an `IfExpression`; see {@link scoreIfExpression}).
 * @param content - Full source text, used to read operator token text.
 * @returns This node's cognitive complexity contribution, including its subtree.
 */
function walkNode(node: SyntaxNode, depth: number, isElseIf: boolean, content: string): number {
  const name = node.type.name;

  if (name === "IfExpression") return scoreIfExpression(node, depth, isElseIf, content);
  if (LOOP_NODES.has(name) || name === "WhenExpression" || name === "CatchClause") {
    return scoreNestedBlock(node, depth, content);
  }

  let own = 0;
  if (name === "Elvis") own = 1;
  else if (name === "BinaryExpression") {
    const op = invisibleBinaryOperator(node, content);
    if (op === "&&" || op === "||") own = 1;
  }

  const isNestedLambda = depth > 0 && name === "LambdaLiteral" && !isControlFlowBodyBrace(node);
  if (isNestedLambda) return own + scoreNestedBlock(node, depth, content);

  return own + walkChildren(node, depth, content);
}

/**
 * @description Computes a simplified SonarSource-style cognitive complexity score for a Kotlin AST
 *   node, tracking how hard the code is to read by adding a nesting penalty. See {@link walkNode}
 *   and its per-node-type scoring functions for the rules applied.
 * @param rootNode - The AST root node to analyse (nesting depth resets to 0 here).
 * @param content - Full source text, used to read operator token text.
 * @returns The cognitive complexity score, minimum 0.
 */
export function computeCognitiveComplexity(rootNode: SyntaxNode, content: string): number {
  return walkNode(rootNode, 0, false, content);
}

/**
 * @description Computes both McCabe cyclomatic complexity and cognitive complexity for a Kotlin
 *   AST node by composing {@link computeCyclomaticComplexity} and {@link computeCognitiveComplexity}.
 * @param node - The AST root node to analyse.
 * @param content - Full source text.
 * @returns Both scores.
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
 * @description Walks every `FunctionDeclaration` and `SecondaryConstructor` body and records its
 *   complexity, qualified as `EnclosingType.name` (mirroring {@link collectCallEdges}'s own
 *   caller-naming convention) or just the type name for a constructor.
 * @param tree - The parsed Kotlin tree.
 * @param content - Full source text.
 * @returns Per-function complexity entries, in traversal order.
 */
/**
 * @description Reports whether any node in `body` is a construct `computeCyclomaticComplexity`
 *   would count (`IfExpression`, `CatchClause`, `Elvis`, a loop, a non-`else` `WhenEntry`, or a
 *   `&&`/`||` `BinaryExpression`) — the same node-type checks as that function, mirrored here as a
 *   boolean short-circuit. Used to narrow {@link collectFunctionComplexity}'s per-function error
 *   gate: a body with an error node is trusted only when it *also* has none of these constructs
 *   anywhere in it, so a genuinely wrong count (a swallowed sibling `if`/loop counted as this
 *   function's own, the original `DiskLruCache.close` bug this gate was built for) still can't slip
 *   through, while a body whose error nodes sit only among plain assignment/call statements is
 *   safe to trust — such a region can't introduce or hide a decision point, so the type-agnostic
 *   complexity walk is unaffected regardless of the malformed tree shape around it. (This gate was
 *   originally motivated by the grammar's old no-ASI `InfixExpression` collapse, since fixed by the
 *   `Nl` statement separators; it still applies to any remaining unsupported construct.)
 * @param body - The function/constructor body to inspect.
 * @param content - Full source text, needed to read `&&`/`||` operator text (see
 *   {@link invisibleBinaryOperator}).
 * @returns `true` if any complexity-relevant construct exists anywhere in `body`.
 */
function hasComplexityRelevantConstruct(body: SyntaxNode, content: string): boolean {
  let found = false;
  body.cursor().iterate((ref) => {
    if (found) return false;
    const name = ref.type.name;
    if (name === "IfExpression" || name === "CatchClause" || name === "Elvis") {
      found = true;
    } else if (LOOP_NODES.has(name)) {
      found = true;
    } else if (name === "WhenEntry") {
      if (ref.node.firstChild?.type.name !== "else") found = true;
    } else if (name === "BinaryExpression") {
      const op = invisibleBinaryOperator(ref.node, content);
      if (op === "&&" || op === "||") found = true;
    }
    return !found;
  });
  return found;
}

export function collectFunctionComplexity(tree: Tree, content: string): FunctionComplexity[] {
  const results: FunctionComplexity[] = [];
  const cursor = tree.cursor();

  do {
    if (cursor.name !== "FunctionDeclaration" && cursor.name !== "SecondaryConstructor") continue;
    // Error recovery (notably in `.kts` scripts, whose top-level statements the grammar can't
    // parse) can fabricate a `FunctionDeclaration` around a call like `kotlin("multiplatform")`.
    // A real declaration always carries its `fun` keyword token.
    if (cursor.name === "FunctionDeclaration" && !cursor.node.getChild("fun")) continue;
    const owner = enclosingTypeName(cursor.node, content);
    let name: string;
    if (cursor.name === "SecondaryConstructor") {
      name = owner ?? "constructor";
    } else {
      const nameNode = cursor.node.getChild("Definition");
      if (!nameNode) continue;
      const bare = content.slice(nameNode.from, nameNode.to);
      name = owner ? `${owner}.${bare}` : bare;
    }
    // Same functionBody lookup as collectCallEdges: a real `Block`, or (for `fun f() = expr()`)
    // whichever concrete node `expression`'s `[@isGroup=Expression]` tag lets getChild find.
    const body = cursor.node.getChild("Block") ?? cursor.node.getChild("Expression");
    // Per-function gate — see ERROR_RATIO_THRESHOLD's doc comment: this is what actually caught
    // the OkHttp `DiskLruCache.close` case (complexity 46 instead of ~4). Narrowed via
    // {@link hasComplexityRelevantConstruct} so a body whose errors can't hide a decision point
    // isn't skipped unnecessarily — see that function's doc comment.
    if (body && (!nodeHasError(body) || !hasComplexityRelevantConstruct(body, content))) {
      const { complexity, cognitiveComplexity } = computeComplexity(body, content);
      results.push({ name, line: lineAt(content, cursor.from), complexity, cognitiveComplexity });
    }
  } while (cursor.next());

  return results;
}
