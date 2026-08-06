# ADR-012: Language-Agnostic, Token-Based Duplicate Detection

**Date:** 2026-08-06
**Status:** Accepted

---

## Context

mokosh had no way to find duplicated/copy-pasted code. The obvious first question was whether to
adopt an existing tool rather than build one. `jscpd` is the closest maintained option — an active
npm package, tokenizer-based copy/paste detection across many languages.

Adopting it was rejected:
- It re-implements file discovery and ignore-dir/extension filtering that `GraphBuilder` already
  does; running it would mean maintaining a second, divergent notion of "which files count."
- Its per-language tokenizer coverage doesn't map cleanly onto mokosh's own language set
  (LiveScript and Gherkin parity, in particular, is unclear), so language coverage wouldn't
  actually be uniform even after adopting it.
- It runs as a separate out-of-process tool returning its own report shape, not a `Graph`-derived
  result — every other analysis in mokosh (`find_complex_functions`, `find_unused`, `check_cycles`,
  …) is a pure function over the already-built `Graph`, exposed identically through the CLI and MCP
  server. Shelling out would be the one exception to that pattern.

A second design question, independent of the jscpd decision: mokosh already has one sub-file
entity, `FunctionComplexity` (populated per-function by `collectFunctionComplexity` in
`src/parser/lang/typescript.ts`, `src/parser/complexity/go.ts`, and `src/parser/complexity/python.ts`),
but only for those three languages. An AST-fingerprint approach built on top of that would
therefore only ever cover TypeScript/JavaScript, Go, and Python — not CoffeeScript, LiveScript,
Lua, Gherkin, style files, or Markdown, which was an explicit requirement.

---

## Decision

Build duplicate detection in-house as a **language-agnostic token-shingling pipeline**
(`src/graph/duplication/`), not an AST-fingerprint approach, and not a wrapped external tool.
Tokenization has no per-language grammar — only a small comment-stripping table
(`tokenizer.ts`'s `COMMENT_SYNTAX`) varies by `FileType` — so the same detector covers every
language in `DEFAULT_EXTENSIONS` uniformly, including the ones with no AST-level parser support
for complexity/call-edges today.

Like `findCycles()`, duplicate data is **not** cached on `FileNode` or the serialized graph — it's
computed on demand from the files already in `graph.nodes`, re-reading their content at query
time. Storing per-file token/shingle data on `FileNode` was considered and rejected for the same
reason [ADR-004](./adr-004-type-graph.md) rejected co-locating the type graph there: it would
inflate every consumer's payload for a feature most callers never invoke.

---

## Design

### Pipeline (`tokenizer.ts` → `shingle.ts` → `index.ts`)

1. **Tokenize** (`tokenizer.ts`): strip comments per `FileType` (masking comment text to spaces
   so line numbers stay accurate, not deleting it), then split what remains with one generic
   regex — identifiers, numbers, quoted strings, a short list of multi-char operators, and
   single-char punctuation. Two normalizations happen here, both aimed at catching
   renamed-variable ("Type-2") clones without any AST work:
   - Every identifier collapses to a placeholder (`ID`) — **except** a shared cross-language
     keyword denylist (`if`, `for`, `return`, `class`, `def`, …). Without excluding keywords,
     an `if` block and a `for` loop would tokenize identically once every identifier-shaped word
     became `ID`, which would make the matcher far too eager. The list is deliberately coarse —
     one shared list, not a per-language keyword table — so keeping a non-keyword in it costs a
     little precision, never correctness.
   - String/number literals also collapse to placeholders (`STR`/`NUM`) by default
     (`ignoreLiterals`, on by default) — set false for stricter, near-Type-1-only matching.
2. **Shingle and chain-merge** (`shingle.ts`): hash every `windowSize`-token sliding window per
   file (a small djb2-style string hash), pair up locations sharing a hash, and — this is the
   part that needs care — extend each pair forward one window at a time for as long as the *next*
   window in both files also hashes identically, so a long duplicated region is reported once as
   one contiguous block instead of once per overlapping window position. `isChainStart` guards
   against reporting the same run once per starting offset. Same-file matches are kept (copy-paste
   within one file is a real finding) but self-overlapping spans are excluded.
3. **Orchestrate** (`index.ts`): read every file in `graph.nodes` from disk in parallel, tokenize
   with that file's `FileType`, shingle, and filter by `minLines` to drop incidental
   boilerplate-sized matches (short getters, repeated import blocks).

### File filtering (independent of the graph's own membership)

`graph.nodes` turned out not to be a reliable "already ignore-rule-filtered" file list, contrary
to this ADR's original assumption. `DEFAULT_IGNORE_DIRS` and extension filtering only gate
`GraphBuilder`'s FS-walk discovery passes — they say nothing about files that become reachable
via a *resolved reference* instead, which happens for any import, and — per
[ADR-009](./adr-009-markdown-parsing.md) — for Markdown code-span file mentions too. In practice
this meant `package-lock.json` and `dist/parse-worker.js` (both merely *mentioned* in project
docs) showed up in `graph.nodes` as real nodes, and their large blocks of repeated
JSON/bundled-output text dominated `find_duplicates`' top results with noise, not genuine code
duplication.

Rather than fix the underlying gap in `GraphBuilder`'s reachability traversal — high blast
radius, and out of scope for this feature — `findDuplicates` applies its own filtering before
reading anything from disk:
- **Lock files** (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml` — the same list
  `src/parser/lockfile.ts` recognizes, exported as `LOCK_FILE_NAMES` so both features share one
  source of truth) are always excluded. Their dependency blocks are genuinely repeated text, but
  not code duplication, and always drowned out real findings by sheer line count.
- **`ignoreDirs`** (default `DEFAULT_IGNORE_DIRS`, matched against any path segment) excludes
  everything else that shouldn't have been reachable in the first place. The CLI command merges
  in the project's configured `ignoreDirs`/`additionalIgnoreDirs` (`ctx.scanOptions`, same as
  `getAllProjectFiles`); the MCP handler merges in `cache.getConfig(root)?.ignoreDirs` when
  `analyze` stored one, and accepts an explicit `ignoreDirs` argument as an override.

### Reporting shape

Each `DuplicateGroup` is a **pair** of occurrences (`[DuplicateOccurrence, DuplicateOccurrence]`),
not an n-way cluster. If the same block appears in three files, that's three pairs (A↔B, A↔C,
B↔C), not one three-way group — simpler to compute and consistent with how most CPD tools report
clone pairs; worth revisiting only if pair-explosion turns out to matter in practice on a real
codebase with widespread duplication.

### Wiring

Follows the same five-layer shape as `find_complex_functions` exactly: `findDuplicates(graph,
rootDir, options)` in `src/graph/duplication/index.ts` → re-exported from `src/index.ts` →
`--find-duplicates`/`--min-duplicate-lines` CLI flags (`src/cli/commands/find-duplicates.ts`) →
`find_duplicates` MCP tool schema (`src/mcp/tools.ts`) → `handleFindDuplicates`
(`src/mcp/handlers.ts`) registered in `src/mcp/server.ts`.

---

## Consequences

**Positive**
- Works uniformly across every language `DEFAULT_EXTENSIONS` covers today, and for any future
  language added — a new row in `COMMENT_SYNTAX` is optional polish, not a prerequisite; an
  unrecognized `FileType` just skips comment stripping and still tokenizes correctly, only
  slightly more noisily.
- No new runtime dependency, no out-of-process tool, no second file-discovery implementation.
- Catches renamed-variable copies (Type-2-ish) "for free" via identifier/literal normalization,
  without needing separate AST-based fingerprinting per language.

**Negative**
- No cross-language matching — a duplicated algorithm expressed in both TS and Python won't be
  found. Not attempted; not meaningful for a token-level approach anyway.
- Purely lexical/structural — it cannot recognize semantically-equivalent-but-differently-shaped
  code (a `for` loop rewritten as `.reduce()`), unlike a true Type-3/4 semantic clone detector.
- Pair-based (not n-way) reporting means a widely-copied block reports one group per file pair,
  which can be verbose for heavily duplicated codebases.
- The keyword denylist is shared across all languages rather than per-language-precise; a
  language-specific keyword absent from the list is treated as an ordinary identifier and
  normalized away, which very occasionally over-matches.
