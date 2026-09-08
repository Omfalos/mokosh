# Plan: calibrate a non-zero `minScore` default for `find_duplicates`

Status: not started. Item **A** of `docs/plans/duplication-noise-reduction.md`, split out
because it is now the highest-leverage remaining lever and needs a measurement pass before any
code lands. Builds on ADR-019 (the `score` metric and phase-1 ranking, already shipped on
`main`).

## Where things stand

ADR-019 shipped the mechanism and stopped deliberately short of a default:

- `DuplicateGroup.score` (count of logic-bearing tokens in the verified span) is computed once
  per block group in `suffix-duplicates.ts` `applyDominanceFilter`, off the first surviving
  occurrence.
- `findDuplicates` **ranks** `groups` and `clusters` by `score` desc, line span as tie-break.
- `findDuplicates` **filters** `kind: "block"` groups below `minScore` — but the option
  (`FindDuplicatesOptions.minScore`, `index.ts`) defaults to `0` (off). `kind: "definition"`
  groups are never score-filtered.
- The `filter` DSL (`--dup-query` / MCP `filter`) already accepts `minScore` / `maxScore` /
  `sort:score` as a **post-hoc result filter** — this is the measurement instrument, no new
  code needed to gather data.
- There is **no** `duplication.minScore` config key, no CLI flag, no MCP top-level arg. Adding
  those is part of this plan.

ADR-019's stated reason for deferring: *"a JVM or Go block's keyword/operator density differs
from TS's, and the default must not silently drop real Go duplication."* So calibration must
cover every non-trivial family, not just `js`.

## Goal

Ship a **per-family** default `minScore` that measurably cuts the residual top-of-list noise
(icon wrappers, Flow `type Props` shells, `@JvmName` shims, `data class` machinery, guard
prologues) without dropping any human-confirmed actionable copy-paste, on a 4-repo corpus
spanning all four code families.

Deliverable: `DEFAULT_MIN_SCORE: Record<DuplicateFamily, number>`, wired as the fallback when
no explicit `minScore` is supplied, plus config / CLI / MCP overrides and an updated ADR-019.

## Step 1 — dogfood corpus

Shallow-clone alongside the existing `box-ui-elements` (pure TS/JS, the `js` data point):

| repo | family exercised | notes |
|---|---|---|
| `github.com/square/okhttp` | `jvm` | 34-module Gradle, Kotlin + Java; the JVM-plan baseline |
| `github.com/pallets/flask` | `python` | small, fast |
| `github.com/gin-gonic/gin` | `go` | most-starred Go web framework |

All permissive-licensed, parse-only (mokosh runs no build/install scripts). `style` and
`markdown` families are out of scope: `markdown` is already default-excluded (item Docs, done),
and `style` matches come through the definition rule (`kind: "definition"`, score-exempt).
`other` stays at `0`.

## Step 2 — gather score distributions

For each repo, per family:

```
mokosh --find-duplicates [--package <p> per module for okhttp] \
  --min-duplicate-lines 6 --scope src \
  --dup-query "sort:score,limit:1000000" --json > scores-<repo>.json
```

A throwaway script (`scratchpad/`, not committed) buckets clusters by `max(member.score)` into
histogram bands (`0`, `1–5`, `6–10`, `11–15`, `16–25`, `26–40`, `41–70`, `71+`) and emits, per
band: cluster count, and the top 3 occurrence-set summaries so they can be eyeballed.

For okhttp, dedupe by occurrence set across the 34 per-module runs first (the JVM plan's
"2,314 unique from 43,795 raw" step) — otherwise the histogram is 95% cross-module repeats.
This is a measurement-only workaround; real workspace-wide dedup is JVM-plan item 5, not this
plan.

## Step 3 — find the knee, per family

Human-label the clusters from `score` desc downward until actionable copy-paste clearly stops.
Then pick the cutoff as the score just below the lowest-scoring actionable cluster, sanity-
checked against the noise it removes. Hypotheses to confirm/refute against the data:

- **`js`** — icon wrappers / Flow `type Props` shells score ~8–10 (ADR-019); real 30-line
  functions 25–40. Expected cutoff **~12**. Check: `TextArea`/`TextInput`, the `box-edit`
  channel pair, `message-center` templates must stay above it.
- **`jvm`** — JVM plan hypothesizes **~25–30**, expecting 2,314 → ~150–250 unique. Check:
  `ClientRuleEventListener ↔ LoggingEventListener` (183 lines) and `RequestBody ↔ ResponseBody`
  stay in; `@JvmName("-deprecated_…")` 6-line shims (near-pure `ID`/`.`/`=`) drop out.
  Watch `hashCode` chains (`31 * result + x.hashCode()`) — real operators, may score higher
  than expected; if they survive the cutoff that's fine (JVM-plan item 4 handles idiom
  collapse), but confirm they don't force the cutoff artificially high.
- **`python`** — no operator-poor markup analogue; boilerplate is `__init__` assignment
  runs and dunder methods. Expected cutoff **lower, ~8–12**. Confirm real Flask duplication
  (blueprint/route handler pairs) clears it.
- **`go`** — `if err != nil { return err }` stacks carry `!=` and `return` so they *do*
  score; error-handling boilerplate is the risk of over-cutting. Expected cutoff **conservative,
  ~10**. Explicitly verify no genuine handler duplication in `gin` is lost.

Record the labeled sample and the chosen numbers in the ADR (Step 5).

## Step 4 — implementation

Perf cost: **negligible.** `score` is already computed for every block group today (ranking
needs it). The change is one integer compare per group at filter time; no extra parsing, no
new worker payload, no cache-key change.

| file | change |
|---|---|
| `src/graph/duplication/families.ts` | add `export const DEFAULT_MIN_SCORE: Record<DuplicateFamily, number>` with the calibrated values (`other`/`style`/`markdown` → `0`). Co-located with `getDuplicateFamily` and the per-family tuning rationale already there. |
| `src/graph/duplication/index.ts` | `minScore` option type stays `number \| undefined`. When **undefined**, filter each `kind:"block"` group against `DEFAULT_MIN_SCORE[group.family]` (per-group lookup, not one scalar). When a number is passed (including `0`), it overrides for all families — `0` = off, as today. Update the option's doc comment. The filter already runs pre-clustering in the same `.filter()` as the signal gates, so clusters rebuild from survivors and an emptied cluster disappears — keep that. |
| `src/graph/duplication/index.ts` (summary block) | add `suppressedByScore: <n>` (groups dropped by the default) and, when `> 0`, a one-line hint in `summary` text: `"N low-logic blocks hidden — pass minScore:0 to include"`. Makes the new default discoverable. |
| `src/config.ts` | add `duplication.minScore?: number` with a doc comment mirroring `includeDocs` / `scope`. Overrides the per-family default globally when set. |
| `src/cli/args.ts` + `src/cli/help.ts` | `--min-duplicate-score <n>` (alias none). Absent → per-family default; `0` → off. |
| `src/cli/commands/find-duplicates.ts` | thread `minScore: cliFlag ?? ctx.rawConfig.duplication?.minScore` (leave `undefined` to hit the per-family default — do **not** coerce to `0`). Update the command doc comment + `--help` prose. |
| `src/mcp/tools.ts` + `src/mcp/handlers.ts` | add `minScore` to the `find_duplicates` input schema (`"logic-token floor for block matches; omit for the calibrated per-language default, 0 to disable"`); thread `args.minScore ?? config?.duplication?.minScore ?? undefined`. |
| `docs/adr-019-logic-token-scoring.md` | flip Status to "Implemented (phase 2 — calibrated per-family default)". Fill the Consequences section with the corpus, the labeled-sample method, the final numbers, and the measured before/after cluster counts per repo. |
| `docs/query.md` + `docs/mcp.md` + `CLAUDE.md` (find_duplicates blurb) | document the default and the override knobs. |
| `README` / MCP tool description | note that `find_duplicates` output is now logic-token-floored by default. |

### Tests — `src/graph/duplication/index.test.ts`

The existing `describe("logic-token score / minScore")` block stays. Add:

- default (no `minScore`) drops a sub-threshold `js` block and keeps an above-threshold one,
  using the existing `boilerplate` / `logic` fixtures — asserts the per-family default is
  actually applied, not just the explicit option.
- explicit `minScore: 0` restores the sub-threshold block (off switch works).
- a `jvm` fixture (two `.kt` files, both extensions registered) with a low-logic shared block
  confirms the `jvm` default differs from `js` — a block that survives under `js`'s cutoff is
  dropped under `jvm`'s (or vice versa, whichever the calibration yields).
- `config.duplication.minScore` overrides the per-family default (via the CLI command path or a
  direct option pass).

Then run the full `src/graph/duplication/*.test.ts` suite and re-baseline any count assertions
in the `noise reduction (issue 5b)`, `scope`, and `SVG noise` describes that shift because the
default now suppresses groups. No `.snap` files exist for this module, so re-baselining is
editing inline `expect(...)` numbers only.

## Rollout

1. Land Step 4 with `DEFAULT_MIN_SCORE` **all-zero** first if it de-risks review — pure
   plumbing, zero behaviour change, no re-baseline. (Optional; the plumbing is small enough to
   land with the numbers.)
2. Land the calibrated numbers + ADR update + test re-baseline as the behaviour change.
   Conventional commit `feat(duplication): calibrate per-language minScore default` — output
   changes but no API signature does.
3. Re-run the 4-repo sweep post-merge, paste the final before/after table into the ADR and
   into the parent plan's item A row.

## Definition of done

- [ ] `DEFAULT_MIN_SCORE` calibrated against box-ui-elements + okhttp + flask + gin, numbers
      justified by a labeled sample in ADR-019.
- [ ] No human-confirmed actionable cluster from the corpus is dropped by the default.
- [ ] Config / CLI / MCP overrides land with tests; `minScore:0` disables.
- [ ] `summary` reports `suppressedByScore` and hints the override.
- [ ] ADR-019 Status + Consequences updated; `query.md`, `mcp.md`, `CLAUDE.md` mention the default.
- [ ] Full duplication test suite green with re-baselined counts.

## Out of scope (tracked elsewhere)

- Workspace-wide dedup for monorepo `find_duplicates` — JVM plan item 5.
- Idiom-family collapse (`kotlin-builder-setter`, `jvm-guard-prologue`, …) — JVM plan item 4.
- `preamble` (B), `data-list` (D), block-identity clustering (E), `typeOnly` cycle edges (G) —
  parent plan.
