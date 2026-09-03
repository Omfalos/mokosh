# Issue 4 — Java generics drop call edges (`new Foo<T>()`), breaking `get_call_graph` / `get_callers`

Status: fixed (2026-09-03). Found dogfooding v0.5.0. Root cause verified against the live
`@lezer/java` parse tree; `constructedTypeName` unwrap helper added in
`src/parser/lang/java.ts` with regression tests in `java.call-edges.test.ts` and
`java.complexity.test.ts`. Kotlin/Scala/Groovy have no call-edge extraction yet, so the
analogous wrapper problem does not exist there.

## Symptom

On Java code, `get_call_graph` / `get_callers` miss constructor calls whenever the type is
written with type arguments — i.e. most real Java (`new ArrayList<>()`, `new Repository<User>()`).
Plain `new Bar()` is captured, so the feature looks half-working. The user also reported
"deps not working properly" with generics (see Scope below).

## Root cause

`collectRawCallEdges` in `src/parser/lang/java.ts:82-133` reads the constructed type with:

```ts
const typeNode = node.getChild("TypeName");   // java.ts:106
```

For `new Foo<String>()` the `@lezer/java` tree is:

```
ObjectCreationExpression "new Foo<String>()"
  new
  GenericType "Foo<String>"          ← wrapper
    TypeName "Foo"                    ← the name we want, one level down
    TypeArguments "<String>"
  ArgumentList "()"
```

`node.getChild("TypeName")` only inspects **direct** children, so it returns `null` when a
`GenericType` wrapper is present → the `new` call edge is never emitted. Non-generic
`new Bar()` has `TypeName` as a direct child, so it works — hence the partial behaviour.

Related shapes, same bug:

- `new outer.Inner<T>()` → `GenericType › ScopedTypeName › TypeName…` (also missed; less
  common for imported types).
- `new outer.Inner()` (no generics) → `ScopedTypeName` direct child, also not a `TypeName`
  (already missed today, pre-existing).

### Not broken (verified — add regression tests anyway)

- `Foo.<String>make()` (explicit type witness): `MethodInvocation` first child is still
  `Identifier "Foo"` and `getChild("MethodName")` skips the intervening `TypeArguments`, so
  the static-call edge is emitted correctly.
- Generic **method declarations** `<T> T foo(T in)`: `MethodDeclaration`'s direct children
  are `TypeParameters`, `TypeName` (return), `Definition "foo"`, `FormalParameters`, `Block`.
  The `TypeParameter`'s own `Definition "T"` is nested inside `TypeParameters`, so
  `getChild("Definition")` (`java.ts:121`, `complexity/java.ts:253`) correctly returns
  `foo`. Complexity and caller-name qualification are unaffected.

## Fix plan

Add a small type-unwrap helper in `src/parser/lang/java.ts` and use it in both call-edge
branches:

```ts
/** GenericType › TypeName → TypeName; ScopedTypeName → its last TypeName segment. */
function constructedTypeName(node: SyntaxNode, src: string): string | null {
  let n: SyntaxNode | null = node;
  if (n.name === "GenericType") n = n.firstChild;               // unwrap <…>
  if (!n) return null;
  if (n.name === "TypeName") return src.slice(n.from, n.to);
  if (n.name === "ScopedTypeName") {
    // last dotted segment is the simple type name used for the importedTypes lookup
    let last: SyntaxNode | null = null;
    for (let c = n.firstChild; c; c = c.nextSibling) if (c.name === "TypeName") last = c;
    return last ? src.slice(last.from, last.to) : null;
  }
  return null;
}
```

- `ObjectCreationExpression` branch (`java.ts:104-110`): replace
  `node.getChild("TypeName")` with `constructedTypeName(node.firstChild-after-'new', content)`
  (skip the `new` keyword child), then look the simple name up in `importedTypes`.
- `MethodInvocation` branch (`java.ts:91-103`): no change needed for the qualifier, but add a
  guard/test for a `GenericType` qualifier just in case (`((List<X>) y).foo()` style casts
  are already outside scope — instance-call limitation noted in `adr-017`).

## Scope note — "deps not working with generics"

`get_dependencies` is driven by `import` edges, which are emitted at import time regardless of
how the type is later used generically — so imported-type deps are **not** affected by this
bug. The genuine gaps are:

1. call-edge-derived views (`get_call_graph`, `get_callers`) — fixed here;
2. **same-package** types referenced only generically and with no `import` line — covered by
   the synthetic same-package edge, whose correctness is
   [issue 3](03-jvm-cycle-detection-noise.md).

Confirm with the reporter which of the two they hit; the concrete code fix for generics is
the `GenericType` unwrap above.

## Test plan

New cases in `src/parser/lang/java.call-edges.test.ts`:

- `new Foo<String>()` → constructor edge to `Foo` emitted.
- `new Foo<Map<K, V>>()` (nested type args) → single edge to `Foo`.
- `new outer.Inner<T>()` with `import outer.Inner` → edge to `Inner`.
- `Foo.<String>make()` → static-call edge to `Foo.make` (regression guard).
- diamond `new Foo<>()` → edge to `Foo`.

New case in `src/parser/lang/java.complexity.test.ts`:

- `<T> T generic(T in) { … }` → method recorded as `Owner.generic` with correct complexity
  (regression guard).

## Files touched

`src/parser/lang/java.ts`, `src/parser/lang/java.call-edges.test.ts`,
`src/parser/lang/java.complexity.test.ts`. Check whether `kotlin.ts` / `scala.ts` /
`groovy.ts` call-edge extraction has the analogous wrapper problem and file follow-ups if so.

## Dependencies

None. Smallest and most isolated of the four — do it first.
