# 05 — Duplicate detection: Strategy per detector

## Problem *(verified)*
`graph/duplication/index.ts` is a 695-line hub with 30 imports; `findDuplicates` scores cognitive
complexity 73, the worst in the repo. `query/dup-filter.ts#matchDupGroup` scores 63 (40 cyclomatic).
The file's own header describes six strategies (block/suffix-array, style-block, style-var,
type-def, object-literal, JSX) wired by hand.

## Pattern
**Strategy** behind one interface, plus a **specification table** for filters.

```ts
interface DuplicateDetector {
  name: string;
  appliesTo(file: FileNode): boolean;
  detect(ctx: DetectContext): DuplicateGroup[];
}
```

`findDuplicates` becomes: filter files, run enabled detectors (optionally in the worker pool), merge,
cluster. Each detector keeps its own file (`style-blocks.ts`, `type-defs.ts`, ...).

`matchDupGroup`: replace the branch chain with `const MATCHERS: Record<DupKey, (g, v) => boolean>`
and a loop; unknown keys already throw in `dup-parser.ts`.

## Steps
1. Characterization tests around current `findDuplicates` output on a fixture repo (snapshot).
2. Extract detectors one by one, behavior-preserving.
3. Extract shared helpers that the duplicate finder itself flagged (`type-defs.ts` ↔
   `object-literals.ts` have 55-66% overlap; `jsx-elements.ts`, `style-vars.ts`, `shingle.ts` share
   small blocks).
4. Table-drive `matchDupGroup`.

## Risks
Worker-pool and token-cache paths (`token-cache-store.ts`, `result-cache-store.ts`) must keep their
digest semantics. Do after part 03 so output-shape changes and the refactor are not mixed.

## Done when
`findDuplicates` and `matchDupGroup` each under cognitive complexity ~15, `index.ts` under ~12
imports, and a new detector needs one file plus one registry entry.
