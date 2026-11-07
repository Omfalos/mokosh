# 12 — Coverage gaps and doc drift

## Coverage *(verified, `find_uncovered`, threshold 80)*
| File | Coverage |
|---|---|
| `cli/commands/dependents.ts` | 75% |
| `cli/commands/feature-graph.ts` | 75% |
| `cli/watch.ts` | 74.07% |
| `cli/commands/types.ts` | 0% (types only) |
| `cli/const.ts` | 0% (constants only) |

Actions: exclude type-only and constants files from the coverage threshold (or have the coverage
tool classify them as `type-only` / `config` so they never appear); add tests for the three real
files, especially `watch.ts` (debounce, ignore pattern shared with `watch-ignore.ts`).

## Doc drift *(verified; heuristic, not a content diff)*
`check_doc_drift` reports 77 stale docs; after part 01 about 17 remain, to review:
`CLAUDE.md`, `docs/architecture.md`, `docs/usage.md`, `adr-007`, `adr-009`, `adr-010`,
`adr-012` through `adr-016`, `adr-018`, `adr-020`, `adr-021`, and
`docs/known_issues/{07,08,09,12,13,15}`, `docs/plans/*`.

Actions:
1. Review each against the code it names; update or add a "last reviewed" note.
2. Known corrections to fold in: CLAUDE.md should mention `shingle.ts` status (part 10),
   `handlers.ts` layout (part 04), `runner.ts` registry (part 08).
3. Consider recording a `reviewed:` commit hash in each doc's frontmatter so drift is measured from
   the last review, not the last edit (a possible mokosh enhancement).

## Done when
`find_uncovered` returns nothing at threshold 80, and `check_doc_drift` lists only docs that were
changed on purpose.
