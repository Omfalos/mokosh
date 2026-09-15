/** Call-edge extraction for Kotlin source, walking the first-party @lezer grammar's tree (see
 *  src/parser/lang/kotlin/PROGRESS.md, docs/adr-021-kotlin-parsing.md). Kotlin has no distinct
 *  call-expression node analogous to Java's `MethodInvocation`/`ObjectCreationExpression` split,
 *  and no `new` keyword — every call is a `CallExpression` whose callee shape (bare `Identifier`
 *  vs. single-level `NavigationExpression`) decides whether it's treated as a qualified call or a
 *  constructor call. Mirrors ./java.ts's scope and limitations: only calls against an
 *  imported/aliased simple name resolve; instance calls through a variable/field, multi-level
 *  qualifiers (`a.b.c()`), and virtual dispatch are not attempted. Complexity extraction (Phase 2
 *  of the Kotlin plan) will live in this same file alongside these helpers. */
import type { SyntaxNode, Tree } from "@lezer/common";
import type { RawCallEdge } from "../types";

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
 * @description Recovers qualified calls the grammar mis-nests under `InfixExpression` for
 *   consecutive bare-call statements with no separator (`Foo.stat(1)\nBar.other(2)`) — a known,
 *   grammar-level parse limitation (see `src/parser/lang/kotlin/PROGRESS.md`'s "consecutive
 *   bare-call statements collapse into one garbage InfixExpression" section: this grammar has no
 *   ASI/newline-sensitivity, so `InfixExpression`'s bare-`Identifier` operator swallows the next
 *   statement's qualifier, producing `Identifier("Bar") ⚠(".") CallExpression("other(2)")` as
 *   three siblings instead of one `NavigationExpression`-based `CallExpression`). Three
 *   grammar-level fixes were attempted and reverted (see PROGRESS.md) — each hit a different
 *   Lezer-automaton dead end, so this recovers the specific documented shapes at the tree-walking
 *   level instead:
 *   1. A direct-child `Identifier` immediately followed (skipping only error nodes) by a
 *      `CallExpression` whose own callee is an unqualified bare name — recovered as a qualified
 *      call using the `Identifier` as qualifier.
 *   2. A direct-child capitalized `Identifier` immediately followed by an empty, erroring
 *      `ParenthesizedExpression` (`Bar()` with no arguments swallows the `(`/`)` as a
 *      would-be-parenthesized-expression with nothing inside, since `Bar` itself was already
 *      consumed as the operator slot instead of starting its own `CallExpression`) — recovered as
 *      a bare constructor call, same convention as {@link walkBody}'s capitalized-bare-call
 *      branch. A *non-empty* swallowed constructor call (`Bar(1)`) is **not** recoverable this way
 *      — `(1)` parses as a valid, error-free `ParenthesizedExpression` with no signal distinguishing
 *      it from a real one, so that shape stays an undercount (documented, not silently guessed at).
 *   Both are gated on `localNames` exactly like every other edge here, so a genuinely valid infix
 *   expression whose right operand happens to be a bare call (`x shouldBe someHelper()`) can't be
 *   misread as a qualified call — `"shouldBe"` won't resolve as an import, so nothing is emitted.
 * @param infixNode - An `InfixExpression` node (real or grammar-mis-nested).
 * @param callerName - The already-qualified caller name to attach to every emitted edge.
 * @param content - Full source text.
 * @param localNames - Simple/aliased local name → FQN specifier map.
 * @param edges - Accumulator array, appended to in place.
 */
function collectInfixMisparseEdges(
  infixNode: SyntaxNode,
  callerName: string,
  content: string,
  localNames: ReadonlyMap<string, string>,
  edges: RawCallEdge[],
): void {
  for (let child = infixNode.firstChild; child; child = child.nextSibling) {
    if (child.type.name !== "Identifier") continue;
    let next = child.nextSibling;
    while (next?.type.isError) next = next.nextSibling;
    if (!next) continue;
    const qualifier = content.slice(child.from, child.to);
    if (next.type.name === "CallExpression") {
      const bareCallee = readCallee(next, content);
      if (!bareCallee || bareCallee.qualifier) continue;
      const toSpecifier = localNames.get(qualifier);
      if (toSpecifier) edges.push({ from: callerName, to: bareCallee.name, toSpecifier });
    } else if (next.type.name === "ParenthesizedExpression" && /^[A-Z]/.test(qualifier)) {
      const isEmptyErroring =
        next.firstChild != null && [...iterChildren(next)].every((c) => c.type.isError);
      if (!isEmptyErroring) continue;
      const toSpecifier = localNames.get(qualifier);
      if (toSpecifier) edges.push({ from: callerName, to: "new", toSpecifier });
    }
  }
}

function* iterChildren(node: SyntaxNode): Generator<SyntaxNode> {
  for (let child = node.firstChild; child; child = child.nextSibling) yield child;
}

/**
 * @description Walks a function/constructor body and records one `RawCallEdge` per resolvable
 *   call: a qualified call (`Core.shout(x)`, `Core?.shout(x)`) whose qualifier resolves via
 *   `localNames`, or a bare call to a capitalized name that resolves via `localNames` — Kotlin's
 *   constructor-call convention, labeled `"new"` to match Java's (Kotlin has no `new` keyword).
 *   Both a trailing `ArgumentList` and a `TrailingLambda` are children of the same single
 *   `CallExpression` node, so `Core.shout("x") { ... }` naturally yields one edge, not two.
 * @param bodyNode - The function/constructor body (or any subtree) to walk.
 * @param callerName - The already-qualified caller name to attach to every emitted edge.
 * @param content - Full source text.
 * @param localNames - Simple/aliased local name → FQN specifier map (built from the file's own
 *   import lines, including `as` aliases that `ImportEdge` itself never retains).
 * @param edges - Accumulator array, appended to in place.
 */
function walkBody(
  bodyNode: SyntaxNode,
  callerName: string,
  content: string,
  localNames: ReadonlyMap<string, string>,
  edges: RawCallEdge[],
): void {
  if (bodyNode.type.name === "CallExpression") {
    const callee = readCallee(bodyNode, content);
    if (callee) {
      if (callee.qualifier) {
        const toSpecifier = localNames.get(callee.qualifier);
        if (toSpecifier) edges.push({ from: callerName, to: callee.name, toSpecifier });
      } else if (/^[A-Z]/.test(callee.name)) {
        const toSpecifier = localNames.get(callee.name);
        if (toSpecifier) edges.push({ from: callerName, to: "new", toSpecifier });
      }
    }
  } else if (bodyNode.type.name === "InfixExpression") {
    collectInfixMisparseEdges(bodyNode, callerName, content, localNames, edges);
  }
  let child = bodyNode.firstChild;
  while (child) {
    walkBody(child, callerName, content, localNames, edges);
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
 * @returns One edge per resolvable superclass constructor call, `from` the declaring type.
 */
function collectSuperclassCallEdges(
  tree: Tree,
  content: string,
  localNames: ReadonlyMap<string, string>,
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
      if (toSpecifier) edges.push({ from: ownerName, to: "new", toSpecifier });
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
 * @returns All resolvable call edges, function-body edges before superclass-constructor edges.
 */
export function collectCallEdges(
  tree: Tree,
  content: string,
  localNames: ReadonlyMap<string, string>,
): RawCallEdge[] {
  const edges: RawCallEdge[] = [];
  const cursor = tree.cursor();
  do {
    if (cursor.name !== "FunctionDeclaration" && cursor.name !== "SecondaryConstructor") continue;
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
    const body = cursor.node.getChild("Block") ?? cursor.node.getChild("Expression");
    if (body) walkBody(body, callerName, content, localNames, edges);
  } while (cursor.next());

  edges.push(...collectSuperclassCallEdges(tree, content, localNames));
  return edges;
}
