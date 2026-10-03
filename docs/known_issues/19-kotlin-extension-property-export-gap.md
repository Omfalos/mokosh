# Issue 19 — Kotlin extension *properties* are silently mis-captured by the export scanner

Status: **open, not started**. Found dogfooding v0.5.5 against ktorio/ktor (Kotlin),
2026-10-03.

## Symptom

`ktor-server-core`'s `ApplicationRequestProperties.kt` defines 23 top-level `fun Receiver.x()`
extension functions and 3 top-level `val Receiver.x: T get() = ...` extension properties (`uri`,
`httpMethod`, `httpVersion`) in the same file. `mokosh`'s `query`/`get_api_surface` exports list for
this file contained all 23 extension functions but **none** of the 3 extension properties by their
real names. `find_symbol({name:"httpVersion"})` correctly returns zero matches as a *consequence*
of this — the symbol is invisible to export/usage tooling even though it's real, public,
widely-used Flask^Wktor API surface (verified: `src/flask/...` — no, verified directly in the real
`.kt` file via `grep`, all 26 top-level declarations present on disk, only the 3 properties missing
from mokosh's `exports`).

## Root cause

`src/parser/lang/kotlin.ts`'s line-scanner regexes for top-level declarations:

```ts
// Correctly skips an optional extension receiver before capturing the real name:
const FUN_DECL_RE = new RegExp(
  `^(?:@[\\w.]+(?:\\([^)]*\\))?\\s+)*${MODIFIERS}fun\\s+(?:<[^>]*>\\s*)?(?:[A-Za-z_][\\w.]*(?:<[^>]*>)?\\.)?([A-Za-z_][A-Za-z0-9_]*)\\s*[(<]`,
);

// Has no equivalent receiver-skip:
const PROP_DECL_RE = new RegExp(
  `^(?:@[\\w.]+(?:\\([^)]*\\))?\\s+)*${MODIFIERS}(?:val|var)\\s+(?:<[^>]*>\\s*)?([A-Za-z_][A-Za-z0-9_]*)`,
);
```

(`src/parser/lang/kotlin.ts:59-69`.) `FUN_DECL_RE` deliberately includes
`(?:[A-Za-z_][\w.]*(?:<[^>]*>)?\.)?` right before the capture group specifically to skip an
extension receiver like `Iterable<T>.` (its own doc comment, line 54-58, calls this out explicitly:
"`fun <T> Iterable<T>.asFlow()` yields `asFlow`, not `Iterable`"). `PROP_DECL_RE` has no such
clause. For a line like `val ApplicationRequest.httpVersion: String`, the capture group
`[A-Za-z_][A-Za-z0-9_]*` (which excludes `.`) matches starting right after `val `+whitespace — i.e.
it captures **`ApplicationRequest`** (the receiver type name, stopping at the dot), not
`httpVersion` (the actual property). The real property name is never captured at all. Since
`exportNames` is a `Map<string, string>` keyed by the captured name
(`src/parser/lang/kotlin.ts:93,121`), multiple extension properties sharing one receiver type
collide into a single spurious `"ApplicationRequest" → "val ApplicationRequest"` entry that
overwrites itself repeatedly — explaining why none of the 3 real property names survive, and why a
bogus `ApplicationRequest`-named export (easy to miss in a quick scan, since a real class or import
of that name is a plausible-looking export too) may be sitting in its place.

Plain (non-extension) top-level `val`/`var` declarations are unaffected — this is specific to the
extension-property shape, which is less common than extension functions but not rare in idiomatic
Kotlin (ktor's own standard library style leans on it for request/response convenience accessors).

## Fix (not started)

Give `PROP_DECL_RE` the same optional-receiver-skip clause `FUN_DECL_RE` already has:

```ts
const PROP_DECL_RE = new RegExp(
  `^(?:@[\\w.]+(?:\\([^)]*\\))?\\s+)*${MODIFIERS}(?:val|var)\\s+(?:<[^>]*>\\s*)?(?:[A-Za-z_][\\w.]*(?:<[^>]*>)?\\.)?([A-Za-z_][A-Za-z0-9_]*)`,
);
```

## Test plan (for whoever picks this up)

- `src/parser/lang/kotlin.test.ts`: a fixture with `val Foo.bar: String get() = "x"` — assert the
  export is named `bar`, not `Foo`, and that a plain `val baz: Int` (no receiver) still works
  unchanged.
- A fixture with two extension properties on the same receiver type (`Foo.bar`, `Foo.baz`) —
  assert both survive as distinct exports (regression check for the `Map` key-collision symptom).
- `example/full-house/conformance.test.ts`'s Kotlin baseline — add an extension-property case if
  the fixture doesn't already have one, so this stays regression-locked going forward (per issue
  8's conformance-harness convention).

## Cross-issue dependencies

- Part of the same umbrella as [issue 8](08-cross-language-reliability.md) (`exportSymbols`
  fidelity, currently documented only at the coarse `full-house` one-file-per-language level, which
  wouldn't have caught this since it needs an idiomatic multi-declaration fixture).
