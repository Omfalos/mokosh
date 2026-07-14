# ADR-009: AST Library for Markdown Parsing

**Date:** 2026-07-13
**Status:** Accepted

---

## Context

Mokosh gained a `markdown`/`.md`/`.mdx` `FileType` to support doc-drift detection: linking markdown docs to the code files they reference, then flagging docs whose referenced code changed more recently than the doc itself (`enrichDocDrift` in `src/graph/enrichment.ts`). This requires extracting candidate file references from markdown source — links (`[text](path)`, including reference-style `[text][ref]`) and code spans/blocks (inline `` `path` `` and fenced blocks), since docs commonly reference files both ways.

The goal was an extraction approach that:
- Handles nested brackets in link text and reference-style links correctly
- Distinguishes local file references from external URLs, anchors, and `mailto:` links
- Works on Node with no native or WASM compilation step, consistent with the rest of mokosh's parser stack

---

## Options considered

### 1. Regex over raw markdown text — rejected

The precedent set by `src/parser/style/css.ts` (regex-based `@import`/`url()` extraction) was considered, since CSS's import syntax is simple enough for regex to handle reliably.

Markdown's link syntax isn't: `[text](path)` breaks under nested brackets in link text (`[the `foo()` function](./foo.ts)`), reference-style links (`[text][ref]` + a separate `[ref]: path` definition elsewhere in the document) require matching two separate constructs, and distinguishing a link from a code span that merely contains bracket-like characters requires knowing which markdown construct you're inside — exactly what a real parser tracks and regex does not.

### 2. `markdown-it` / `marked` (token stream) — considered

Both are pure JS, mature, and widely used. They tokenize markdown into a flat/token-tree structure rather than a full AST — enough to distinguish link tokens from code tokens, but with less structural guarantee than a proper tree for edge cases like nested inline formatting inside link text.

**Pros:** lighter weight than `unified`, simpler API for straightforward extraction.
**Cons:** less standard for programmatic AST consumption than the remark/mdast ecosystem; would still require some manual bookkeping to reconstruct reference-style link definitions.

### 3. `remark` / `unified` (mdast) — **chosen**

`remark-parse` (via `unified`) produces `mdast`, a well-specified markdown AST, and is the standard choice across the JS ecosystem for programmatic markdown analysis (used by MDX, Docusaurus, Gatsby, etc.).

---

## Decision

Use `unified` + `remark-parse` to parse markdown into an mdast tree, walked manually (no `unist-util-visit` dependency — the walk needed is a simple recursive `children` traversal, so an extra dependency wasn't justified).

---

## Why remark/mdast

| Property | Value |
|---|---|
| Runtime | Pure JavaScript — no native addons, no WASM |
| Node compatibility | Any version (no ABI dependency), consistent with the precedent in `docs/adr-002-python-parsing.md` (tree-sitter dropped project-wide for exactly this reason) |
| Direct dependencies | `unified`, `remark-parse` |
| Ecosystem | De facto standard for programmatic markdown (MDX, Docusaurus, Gatsby) |
| License | MIT |

### What the AST gives over regex

| Case | How resolved |
|---|---|
| `[the `foo()` function](./foo.ts)` | Link text is a nested `inlineCode` child of the `link` node; the `url` field is read directly, unaffected by brackets in the text |
| Reference-style `[text][ref]` | Not currently resolved to its `[ref]: path` definition — mdast represents this as a `linkReference` node, which the current walker doesn't visit. Direct inline links and code-span path mentions are the supported cases for v1; see Consequences. |
| `` `src/auth/reset.ts` `` (inline code) | `inlineCode` node's `value` field is scanned for path-like tokens with a small regex — safe here since it's a much narrower surface (already-isolated code text) than parsing raw markdown |
| Fenced code blocks | Same as inline code, via the `code` node's `value` |
| External/anchor links | Filtered by a URL-prefix check (`http://`, `https://`, `mailto:`, `//`, `#`) before emitting an edge — same pattern as `isExternalCss`/`isLocalUrl` in `css.ts` |

### Module loading note

`unified` and `remark-parse` are ESM-only; mokosh's package is `"type": "commonjs"`. `src/parser/lang/markdown.ts` loads both via a cached `import()` inside an async `getProcessor()` function — Node's dynamic `import()` from CommonJS works for ESM-only packages, so no bundler changes were needed. The processor's own `.parse()` call is synchronous once loaded, so only the one-time module load pays the async cost.

### Bare project-relative paths

Docs conventionally reference files as project-root-relative (e.g. `src/graph/builder.ts`, the convention used throughout `CLAUDE.md`), not relative to the doc's own directory. Since these don't start with `.` or `/`, `DefaultResolver` would otherwise treat them as external. A `MarkdownLangResolver` (`src/graph/lang-resolvers/markdown.ts`) was added — the same per-extension "lang resolver" extension point used for Python/Lua/Go/style bare-specifier handling — so `.md`/`.mdx` source files get bare specifiers resolved relative to `rootDir` instead of falling through to external.

---

## Consequences

**Positive**
- Reliable extraction of both link- and code-span-referenced files, unaffected by nested brackets in link text
- Zero native/WASM compilation — works on any Node version and architecture
- Minimal dependency footprint (two packages, both from the `unified` collective)

**Negative**
- Reference-style links (`[text][ref]`) are not resolved in v1 — only direct inline links and code-span mentions are extracted. This is a known gap, not a design dead-end: supporting it means visiting `linkReference`/`definition` node pairs, deferred since docs overwhelmingly use inline link syntax.
- The code-span path-token regex can produce false positives on any text matching `word/word.ext` inside a code block that isn't actually a project file reference (e.g. an example command's argument). These become no-op import edges (the resolver simply fails to resolve them and drops them), not incorrect graph edges — see `resolveLocalPath` in `src/graph/resolver.ts`.
- Doc-drift detection itself (the reason this parser exists) is a commit-recency heuristic, not a content diff — see the enrichment doc comment in `src/graph/enrichment.ts` (`enrichDocDrift`) for that separate, more significant limitation.
- First real-world run against this repo's own docs flagged all 17 markdown files, almost entirely because every doc mentioned `src/index.ts` (a barrel re-exporting the public API, touched on nearly every commit), `package.json`/lockfiles, or `CHANGELOG.md` — none of which reflect content going stale. `enrichDocDrift` now scopes the staleness comparison to `category: "logic"` targets only, since barrels/config/non-code files churn for reasons unrelated to documented behavior.
