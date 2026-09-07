# ADR-019: Logic-Token Scoring for Duplicate Ranking

**Date:** 2026-09-05
**Status:** Implemented (phase 1 — `score` computed and used for ranking; `minScore` filter
opt-in, default `0`). Calibrating a non-zero default against polyglot repos is deferred to a
follow-up (see `docs/plans/duplication-noise-reduction.md`, item A).

---

## Context

`find_duplicates` ranked results — and applied its size floor (`minLines`) — purely on block
_size_: line span, and raw token-window length. Repeated dogfood audits against `box-ui-elements`
showed this is the wrong axis. After the noise fixes that preceded this ADR (clone-family
consolidation, SVG-markup exclusion, per-language families, the `scope` test filter), the
residual junk at the _top_ of the list was all large but information-poor:

- **Icon-component wrappers.** A shared `type Props = { … }` Flow declaration plus
  `const Icon = ({ … }) => (<AccessibleSVG …><path d="…"/></AccessibleSVG>)` — ~30 lines, ~140
  raw tokens, reported as a top finding across a dozen icon files. The `d="…"` path (the only
  thing that differs between icons) normalizes to `STR` before matching.
- **`.mdx` doc pages** whose fenced code blocks tokenize — `README.md ↔ ContentX.mdx` at 449
  raw tokens, the new #1 by token count once bulk volume dropped. (Scoring demotes these only
  partially — a fence full of real `import`/`export`/`const` still scores — so the `markdown`
  family gets its own default exclusion as a separate item; see the plan doc.)
- **~180 blocks in the 40–90 raw-token band** that are mostly JSX attribute / object-literal
  punctuation shape.

A real 30-line function and a 30-line JSX wrapper have comparable line counts and comparable raw
token counts. What separates them is how much of the block is _computation_ — keywords and
operators — versus identifiers, literals, and structural punctuation.

## Decision

Add `DuplicateGroup.score`: the count of **logic-bearing tokens** in the verified span.

A token is logic-bearing (`isSignificantToken`, `tokenizer.ts`) when it is a language keyword
(the existing shared `KEYWORDS` set) or an operator — the multi-char operators (`===`, `=>`,
`&&`, `+=`, `...`, …) plus the single-char arithmetic/bitwise/logical set `+ - * % & | ! ^ ~ ?`.

It is **not** logic-bearing when it is:

- `ID` / `NUM` / `STR` — normalized identifiers and literals. `ID` is excluded deliberately:
  Markdown prose, JSX tag and attribute names, and object-literal keys are all `ID`, so counting
  it would not separate boilerplate from logic (and Markdown prose would score _high_).
- `( ) { } [ ] ; , : .` — pure structure.
- `= < > /` — excluded because in the `js` family these overwhelmingly appear as JSX
  punctuation (`attr={…}`, `<Tag/>`, `</Tag>`) rather than as assignment or comparison. The
  multi-char comparison/assignment forms (`==`, `<=`, `=>`, `+=`) are still counted, so real
  comparisons and arrow functions are not lost; a bare `x = y` assignment contributes only via
  its other tokens. This is a precision trade accepted to keep icon wrappers scoring low.

`findDuplicates` now:

1. **Ranks** `groups` and `clusters` by `score` (descending), then line span as a tie-break.
   `kind: "definition"` groups carry no `score` and are ordered by line span instead.
2. **Filters** `kind: "block"` groups below `minScore` (option, default `0` = off). Never
   applied to `kind: "definition"` groups — those are already content-verified, so a small but
   exact interface/objectLiteral/jsxElement match stays reported regardless.

`score` is computed once per group in `suffix-duplicates.ts`'s `applyDominanceFilter`, off the
first surviving occurrence (every occurrence shares the same normalized token run).

## Consequences

- Ranking improves immediately with no behaviour change and no test re-baseline: `minScore: 0`
  returns exactly the same set, only reordered. Icon wrappers (Flow `type Props` + JSX shell)
  and the `jsxElement` definition matches on shared `<defs>`/`<filter>` blocks sink; real code —
  `TextArea`/`TextInput`, the `box-edit` channel pair, the `message-center` templates,
  `CreateFolderDialog`/`RenameDialog` — rises.
- The metric is coarse by design — it does not know an operator's semantics, and it under-counts
  call-heavy code (`a.b.c()` chains contribute nothing). It is a _ranking_ signal, not a
  correctness judgement. A non-zero `minScore` is therefore opt-in until calibrated against
  non-JS families (`square/okhttp`, `pallets/flask`, `gin-gonic/gin`) — a JVM or Go block's
  keyword/operator density differs from TS's, and the default must not silently drop real Go
  duplication.
- `score` sits alongside `tokens` and `lines` on every block group; consumers that sorted on
  `lines` themselves are unaffected (the field is additive, and `groups` is still returned
  sorted — now by `score`).

## Alternatives considered

- **Classify tokens in the tokenizer** (`NormalizedToken.kind`). More precise, but changes the
  token shape, the worker-pool payload, and the token cache's invalidation key for a marginal
  gain over deriving significance from `text` alone.
- **Weight by punctuation ratio** (extend `structuralPunctuationRatio` to JSX `< > / =`). Helps
  the JSX case but not the Flow-`type` case or the `.mdx` case, and conflates "schema shape"
  with "markup shape". `maxPunctuationRatio` stays as its own targeted gate for object-literal
  boilerplate; `score` is the general axis.
