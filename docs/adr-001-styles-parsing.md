# ADR-001: AST Libraries for Style Parsers

**Date:** 2026-04-26 (revised 2026-04-29)
**Status:** Accepted

---

## Context

Style parsers (CSS, Less, SCSS, Sass, Stylus) were originally implemented as regex over comment-stripped text. This is sufficient for simple `@import` extraction but becomes unreliable for:

- Strings or `url()` values containing `@import`-like tokens that confuse regex
- Less keyword modifiers (`@import (reference) "file"`) with edge cases
- SCSS module system semantics (`@use` namespaces, `@forward` prefixes) that require structural understanding
- Detecting whether an import path resolves into `node_modules` vs. a local file
- Barrel detection: the brace-counting heuristic is explicitly broken for Stylus and fragile for SCSS files that mix directives and rule blocks
- Hub detection: identifying which style files are imported by many others depends on accurate import resolution, which regex cannot guarantee

---

## Decision

Replace regex parsers with purpose-built style AST libraries:

| Dialect | Library | Notes |
|---------|---------|-------|
| CSS | `postcss` | Full AST; accurate `@import`, `url()`, and at-rule parsing |
| Less | `postcss` + `postcss-less` | PostCSS syntax plugin; handles Less keyword modifiers |
| SCSS / Sass | `postcss` + `postcss-scss` | PostCSS syntax plugin; understands `@use`/`@forward` semantics including namespace aliases and prefixes |
| Stylus | `stylus` (AST mode) | Fallback to regex if AST mode unavailable |

Tree-sitter grammars exist for CSS and SCSS but are oriented toward syntax highlighting and do not expose the semantic APIs needed for hub/barrel detection (e.g., whether a `url()` is a local file reference vs. a data URI, or whether `@use "sass:color"` is a built-in vs. an npm package).

---

## What AST parsing unlocks over regex

**Accurate `node_modules` classification**
PostCSS and postcss-scss resolve import paths at AST level, making it straightforward to test whether a specifier starts with `~`, `@scope/`, or a known built-in namespace (`sass:color`, `sass:math`) and classify it as `isExternal: true`.

**Reliable barrel detection**
A PostCSS AST walk can confirm that a file contains *only* at-rules with no rule declarations. The brace-counting heuristic cannot do this for Stylus and produces false negatives for SCSS files with complex at-rule nesting.

**Hub detection**
Accurate import edges (including `url()` references to shared asset files) give hub detection a correct in-degree count. Regex misses or double-counts in edge cases.

**`url()` references**
Shared font or image files pulled in by many component stylesheets are hubs worth surfacing. PostCSS parses `url()` values inside declarations; regex targeting `@import` only misses these entirely.

**`@forward` prefix bindings**
The SCSS `@forward "path" as prefix-*` pattern is a re-export barrel. The postcss-scss AST exposes the prefix string directly; the current regex strips it correctly only when it follows the simple `as X` form and breaks on multi-token forms.

---

## Extensibility model

### Adding a style dialect

1. Install the relevant PostCSS syntax plugin or standalone parser:
   ```bash
   npm install postcss postcss-<dialect>   # or: npm install sass
   ```

2. Create `src/parser/style/<dialect>.ts` implementing:
   - `parse(filePath, content): ImportEdge[]` — extract all import edges using the AST walker
   - Mark each edge `isExternal: true` when the specifier resolves to `node_modules`
   - Use `type: "re-export"` for `@forward` directives; `type: "side-effect"` for Less `(reference)` / `(inline)` imports

3. Update `src/parser/style/barrel.ts` to use AST-level detection (no rule declarations present) instead of brace counting.

4. Register the new dialect in `src/parser/style/index.ts`.

### Exports and tags for SCSS/Less

SCSS and Less files were originally treated as import-only for `exports`/`tags` purposes. Since the AST is already available for barrel detection, `parseScssContent` and `parseLessContent` also extract the file's exported surface:

- **SCSS**: root-level `$variable: value;` declarations, and `@mixin name(...)` / `@function name(...)` at-rules (their parenthesized argument list becomes the `signature`, when present). Names following Sass's own privacy convention (leading `_` or `-`) are excluded — they are never reachable from another file via `@use` and so aren't part of the module's public surface. Only root-level declarations count; anything scoped inside a rule or mixin body is local, not exported.
- **Less**: root-level `@variable: value;` declarations only. `postcss-less` represents these as `atrule` nodes carrying a non-standard `value` property — that's what distinguishes a variable from a real at-rule such as `@media`/`@import` (which never has one).
- Extracted names are also emitted as `StructuredTag`s, reusing the existing `variable`/`function` kinds — no new `TagKind` was introduced.

Tags reuse `variable`/`function` — the same `TagKind` values TS declarations use — so tag-based queries (`tag:`) work uniformly across languages without a style-specific kind.

**Deliberately out of scope for this pass** (candidates for follow-up ADRs, not silently half-done):
- **Less mixin definitions** (`.name(...) { }`). Telling a mixin definition apart from an ordinary rule with a parenthesized selector, or from a mixin *call* (`.name();`), needs deeper Less semantics than a straight AST walk provides for free.
- **Stylus exports.** `parseStylusImports` has no shared AST reuse point today (regex-only); adding export extraction means a separate AST pass, not a small addition to existing code.
- **CSS custom properties** (`--color-primary`). These are consumed via `var()` inside declaration values, not through the import/symbol mechanism the rest of this feature plugs into, so they don't yet have anywhere to attach usage tracking.
- **Export usage tracking** (`exportUsageRatio` on style import edges). Populating it correctly requires walking each *importing* file's body for `alias.$var` / `alias.mixin-name(...)` references, since Sass has no `@use "x" show $var` selective-import syntax to read the consumed symbols off the import statement itself the way TS import specifiers allow.
- **Mixin/function call edges** (a style analog to `CallEdge`) for `get_call_graph`.

---

## Consequences

**Positive**
- Style import graphs are accurate and complete, enabling reliable hub and barrel detection
- `node_modules` imports correctly classified as external edges
- `url()` asset references surfaced as dependency edges
- Parser integrity covered by npm lockfile + registry checksums

**Negative**
- PostCSS adds a small parse-time overhead vs. regex, negligible for typical file sizes.