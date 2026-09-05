# Plan: duplicate-detection & cycle noise reduction

Status: in progress on branch `fix/cycle-scc-dedup` (3 of 8 items landed). Source: repeated
dogfood audits of `find_duplicates` / `--check-cycles` against `box-ui-elements` (3,474 nodes,
pure TS/JS/SCSS/Markdown) through 2026-09-05, building on the SVG-noise work in
`4b527ec` and the clone-family work in `docs/known_issues/09-duplicate-clone-family-noise.md`.

## Context

A no-limit `find_duplicates` run on `box-ui-elements` started at **11,300 groups / 8,794
clusters**, of which maybe ~40 were genuinely actionable. Root cause across every noise class:
**the matcher measures block _size_ (lines, raw token count) but not _information_ (logic-bearing
tokens)**, and it had no notion of which files (tests, generated, docs) or which languages
carry actionable copy-paste. Each item below is separable.

Progression measured on `box-ui-elements` (`--min-duplicate-lines 6`, no limit):

| after | groups | clusters | cycles |
|---|---|---|---|
| first audit (post `c716f84`) | 11,300 | 8,794 | 10 |
| SVG-noise fix (`4b527ec`) | 10,732 | 8,354 | 10 |
| **F** — SCC cycle collapse (`3c9d041`) | 10,733 | 8,355 | **7** |
| **H** — language-family split (`7780061`) | 10,733 | 8,355 | 7 |
| **C** — `scope` / test signal (`a22fdfa`) | **4,525** | **3,604** | 7 |

`--scope tests` surfaces 331 substantive shared-test-logic clusters that were previously buried.

---

## Done

### F — collapse cycles that share a strongly-connected component (`3c9d041`)

`findCycles`' DFS emitted one back-edge cycle per sibling when a hub file was cyclically bound
to N peers (`ItemList.tsx` ↔ four `*CellRenderer.tsx`, all via one
`import { cellRendererProps } from './ItemList'` = 4 findings for 1 knot). Now runs iterative
Tarjan after the DFS and keeps one representative cycle per SCC (shortest, lexicographic
tie-break); `expandComponents: true` opts out. Return type unchanged (`string[][]`), so no
consumer breaks. Files: `src/graph/analyzer.ts`. Effect: 10 → 7 cycles.

### H — split the `code` family by language paradigm (`7780061`)

One `code` family compared Java/Go/Python/TS against each other; a `for` loop tokenizes almost
identically in all of them once identifiers collapse to `ID`, so polyglot repos reported phantom
cross-language matches. `getDuplicateFamily` now returns `js` (js/ts/coffee/ls — JS↔TS and
Coffee→JS ports are real cross-`FileType` duplication worth keeping), `jvm`
(java/kotlin/scala/groovy — interop, never compared against `js`), and one family each for
`python`, `go`, `lua`, `markdown`, `gherkin`. `style` unchanged. Files:
`src/graph/duplication/families.ts`. No measurable effect on `box-ui-elements` (pure TS/JS) —
payoff is on polyglot repos; validate against `square/okhttp`, `pallets/flask`, `gin-gonic/gin`.

### C — `scope` option: separate substantive test duplication from skeletons (`a22fdfa`)

Test-file duplication was lumped in with product code — ~57% of all clusters on an icon-heavy
repo, almost all of it the `render(<X/>); expect(…).toMatchSnapshot()` skeleton. Every group
with a test-path occurrence (`__tests__`/`__mocks__`/`__snapshots__`/`test`/`tests`/`e2e` dirs,
`*.test.*`/`*.spec.*` basenames, `*.snap`) is now tagged `signals: ["test"]`. New
`scope: "src" | "tests" | "all"` (CLI `--scope`, `mokosh.config` `duplication.scope`, MCP
schema): `"src"` (default) drops every cluster touching a test file; `"tests"` returns only
substantive test clusters (≥3 distinct shared blocks across ≤6 files, or one ≥120-token block);
`"all"` is the previous behaviour. Applied post-clustering ("substantive" is cluster-level);
`groups` is narrowed to surviving clusters' members. Files: `src/graph/duplication/{index,shingle}.ts`,
`src/cli/{args,help,runner}.ts`, `src/cli/commands/{find-duplicates,types,test-context}.ts`,
`src/config.ts`, `src/mcp/{tools,handlers}.ts`. Effect: 8,355 → 3,604 clusters.

---

## Remaining, roughly ordered by leverage

### A — rank and threshold by a logic-token score (highest leverage)

**Problem.** Sort and the `minLines` threshold both use block _size_. A 137-line Markdown copy
(`tokens: 33`) outranks a 40-line logic dup. After `scope=src`, the residual visible noise is:
- icon-component wrappers — the 13-file `left-sidebar/icons/*` cluster is a shared Flow
  `type Props` + `const Icon = ({…}) => (<AccessibleSVG …><path d="…"/></AccessibleSVG>)`
  wrapper (~138 raw tokens, `L=30`), reported as a top finding;
- `mdx` doc pages whose fenced code blocks tokenize (`README.md ↔ ContentX.mdx` at 449
  tokens — new #1 by token count once volume dropped);
- ~184 groups ≥15 lines in the 40–90 raw-token band that are mostly attribute/punctuation shape.

**Fix.** Add `DuplicateGroup.score` = count of _logic-bearing_ tokens in the verified block:
keywords ∪ multi-char operators ∪ arithmetic/logic single-char operators (`+ - * % & | ! ^ ~ ?`),
**excluding** `ID`, `NUM`, `STR`, and pure structure (`( ) { } [ ] ; , : . < > / =` — `=`/`<`/`>`/`/`
excluded because they dominate JSX attributes). Icon wrappers land at ~8–10, Flow `type Props`
blocks low, real 30-line functions at 25–40.

- `src/graph/duplication/shingle.ts` — `significantTokenCount(tokens, start, length)` next to
  `structuralPunctuationRatio`, exported; `DuplicateGroup.score?: number`.
- `src/graph/duplication/suffix-duplicates.ts` — set `score` on each group in
  `applyDominanceFilter` (it has `tokensByFile` + the span).
- Definition matchers (`type-defs`/`object-literals`/`jsx-elements`/`style-vars`) — set
  `score = tokens` (member/field count) as a proxy, or leave undefined and treat as `tokens`.
- `src/graph/duplication/index.ts` — sort by `(b.score ?? b.tokens) - (a.score ?? a.tokens)`
  then `lines`; new `minScore?: number` option (default `0` = off to start), filtering
  `kind: "block"` groups only. Also re-sort `clusters` by max member score.
- `docs/adr-019-logic-token-scoring.md` — the metric and why raw tokens / lines were insufficient.

**Rollout.** Land sort-by-score with `minScore: 0` first (re-ranks, breaks nothing, no test
rebaseline). Calibrate a non-zero default against `okhttp` / `flask` / `gin` + the `index.test.ts`
corpus in a follow-up; that step needs the `index.test.ts` fixtures re-baselined.

### B — `preamble` signal

A block that, after trimming leading comment tokens, is entirely an `import`/`require` prologue
plus a top-level `const X = defineMessages({`-shape declaration. Kills the 41- and 40-file
`messages.js` clusters (`import { defineMessages } from 'react-intl'; const messages =
defineMessages({`), `box-ui-elements`' two largest remaining clusters. Tag + default-exclude,
same shape as `same-file` / `svg-markup`; recoverable via an `includePreamble` flag or `scope`.
Files: `src/graph/duplication/{shingle,index}.ts`, CLI/MCP wiring.

### Docs — default-exclude the `markdown` family

Markdown is its own family (item H) but still in the default output: 54 clusters on
`box-ui-elements`, but 12 of the top ~50 by token count (`README.md ↔ *.mdx`, `*.md ↔ *.md` —
Storybook docs mirroring package READMEs). Prose isn't code duplication. Drop `markdown`-family
clusters from `find_duplicates` by default (like lock files), with an `includeDocs` opt-in — or
fold into `scope` as a fourth consideration. Small. Files: `src/graph/duplication/index.ts`,
CLI/MCP wiring.

### D — `data-list` signal

A block that is ≥X% bare literal elements (`STR`/`NUM` + `,`). `ignoreLiterals: true` turns
every `'x',` line into the same token, so two long single-column arrays match regardless of
domain — `test/fixtures/theme/colors.js` (hex array) ≡
`isExtensionSupportedForMetadataSuggestions.ts` (extension array) ≡ `previewIcons.ts`. When a
block trips this, require the literal _values_ to match too (locally disable `ignoreLiterals`
for that block), or tag + default-exclude. Only ~1–2 findings on `box-ui-elements` but a
systematic false-positive class on data-heavy repos. Files: `src/graph/duplication/{shingle,suffix-duplicates}.ts`.

### E — one cluster per maximal shared block

`clusters.ts` buckets by _exact_ file set (deliberately not transitive — an earlier
connected-component version chained unrelated files, see its top-of-file comment). Residual
combinatorial blow-up remains where file sets differ by a member: bucket by _block identity_
(hash of the normalized window that defines the match) instead, listing all N occurrences of
that one block once, while keeping the anti-chaining guard (never merge two distinct blocks via
a shared file). Do this last — least volume to reason about once A/B/Docs land. Files:
`src/graph/duplication/clusters.ts`.

### G — `typeOnly` cycle edge kind

The remaining 7 cycles on `box-ui-elements` include `common/types/core↔metadata↔skills`,
`common/types/feed↔annotations`, and `targeting/types.js↔MessageApi.js` — harmless under
type-only erasure. Add `typeOnly` to `CycleEdgeKind`, skipped by default like `docReference` /
`samePackage`, opt-in via `includeKinds`. Requires parser work: `ImportEdge` has no `isTypeOnly`
today — `src/parser/lang/typescript.ts` would capture `importClause.isTypeOnly` +
per-specifier `element.isTypeOnly`, threaded through the resolver; the Flow path needs the same
for `import type`. Weaker `analyzer.ts`-only fallback: skip an edge when both endpoints are
`category: "type-only"` nodes (catches the `common/types` cycles, misses `targeting`). Effect:
7 → ~4 cycles. Files: `src/types/node.ts`, `src/parser/lang/typescript.ts`, resolver,
`src/graph/analyzer.ts`.

---

## Dogfood corpus

`box-ui-elements` (pure TS/JS) has driven every measurement so far. For H / A calibration and
the cross-language reliability items (`docs/known_issues/08-cross-language-reliability.md`),
clone shallow copies of:

- `github.com/square/okhttp` — Kotlin + Java, the `jvm` family + Kotlin/Java coexistence
- `github.com/pallets/flask` — Python, small and fast
- `github.com/gin-gonic/gin` — Go, most-starred Go web framework

All permissive-licensed, parse-only (mokosh runs no build/install scripts). Confirm zero
cross-language matches under `--scope all` and a clean `--check-cycles`.
