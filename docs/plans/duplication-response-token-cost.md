# Plan: cut `find_duplicates` MCP response token cost

Status: **implemented** (both tracks; unreleased). Sibling of `duplication-minscore-calibration.md` (noise *content*) and
4`mcp-tool-improvements.md` item "large payloads" — this one is purely about **response
size / token cost of the MCP tool**, not which matches are found.

## Problem

A default `find_duplicates` call (no `filter`) on a *376-node* repo (mokosh itself) returns
~50 `groups` **and** ~50 `clusters`, ~12–15K tokens. Most of it is redundant:

- `groups` and `clusters` are the same matches twice — every multi-member cluster re-lists
  its member groups' occurrences, and every group that belongs to a cluster is already
  covered by that cluster.
- Default `limit: 50` is a human-CLI default, not an LLM-triage default. An assistant reads
  the top handful, then wants to drill into one area — it never needs 50 full rows up front.
- `FIND_DUPLICATES_MAX_PAYLOAD_BYTES = 1_000_000` (~250K tokens) is the only backstop —
  effectively no backstop for a context window.
- The running published MCP build predates `summary` + slim shaping (both already on `main`,
  unreleased), so today's real-world responses are even heavier than the source suggests.
  A release picks up `summary`/slim for free; this plan is what to change *on top* of that.

The `filter` DSL (`src/query/dup-parser.ts`) already exists and is the right drill-in
mechanism — it's just not the default posture. Goal: **summary-first**, opt in to detail.

## Goal

Default (no `filter`) response is a compact triage view — `summary` + a short cluster
preview + a one-line hint on how to narrow. Detail (`groups`) comes back only when the
caller passes `filter` (or an explicit `view`). CLI output is unchanged — it stays the full
human dump.

Target: default response **< 1.5K tokens** on a mid-size repo, **< 4K** on a large monorepo
(bounded by preview count, not repo size).

## Two independent tracks

The user's feedback split this into two separate problems that got conflated:

- **Track A — response tokens.** The response is a big JSON blob whether or not it came from
  a cache. `groups` and `clusters` are ~the same information twice. Fix: make **clusters the
  only detail shape** for MCP, summary-first, `groups` (raw spans) only on explicit request.
- **Track B — recompute cost.** Even with the token cache, every call rebuilds the suffix
  array + matches + clusters. Fix: persist the computed result to `mokosh-cache/`, keyed by a
  digest of the in-scope files' mtime/size, and serve it verbatim when nothing changed.

Track A is the token win and is self-contained. Track B is a latency win and can land
separately. Do A first.

---

## Track A — summary-first, clusters-only detail

### `groups` vs `clusters`: clusters win

- A **group** = one matched span (2+ occurrences of one duplicated block).
- A **cluster** = every group sharing the exact same file set, bucketed, + per-file
  `coverage` %.
- Every group inside a multi-member cluster is **fully redundant** with that cluster.
- The only groups a cluster doesn't already represent are `matchCount: 1` file pairs — one
  isolated shared block. Those are the low-value tail anyway.

So MCP stops returning `groups` as a matter of course. Clusters become the unit. To make a
cluster **actionable on its own** (today's slim cluster has file set + coverage but no
*location*), extend `slimDupCluster` with the longest match's span:
`longestMatchAt: ["src/a.ts:120-170", "src/b.ts:145-194"]`. Now "where do I look" is answered
without the `groups` list.

### Response shapes

| call | returns |
|---|---|
| no `filter`, no `view` | `{ minLines, summary, clusters: <slim, ≤ previewLimit>, hint }` — **no `groups`** |
| `filter` given | `{ minLines, filter, summary, clusters: <slim, ≤ limit> }` — still no `groups` unless `view:"groups"` |
| `view: "groups"` | `{ …, groups: <slim, ≤ limit>, count }` — raw spans, for the rare caller that wants them (e.g. feeding another tool) |
| `view: "full"` | both lists, `≤ limit` — explicit escape hatch = today's default |

`summary` stays exactly as-is (`summarizeDuplicates` — `matched`, `byFamily`, `byTopDir`,
`bySignal`, `largestLines`). It's already the cheap part and it's computed from the full
post-`filter` set, so it stays accurate regardless of preview truncation.

`hint` (new, string, only on the no-`filter` default): e.g.
`"42 groups across 5 dirs. Narrow with filter, e.g. filter:\"path:src/parser,minScore:15\" or filter:\"family:jvm,sort:score\". Pass view:\"full\" for everything."`
Makes the drill-in path discoverable in-band (the tool description already documents it, but
a hint in the payload is what actually gets used).

### Caps

- New `previewLimit` for the default view: **8** clusters. Not caller-tunable at first — the
  point is a fixed cheap ceiling. Reconsider a `previewLimit` arg only if asked.
- Lower default `limit` **50 → 20** for the `filter` / `view` paths.
- `FIND_DUPLICATES_MAX_PAYLOAD_BYTES` **1_000_000 → 120_000** (~30K tokens) as the hard
  backstop before the existing halving loop kicks in + flags `truncated`.

### `view: "full"` de-dupe

The only path that still returns both lists. There, drop from `groups` any group that's a
member of a returned multi-member cluster (they're redundant with it) and add
`summary.clusteredGroups: <n>` for the fold count. `view:"full"` is the escape hatch, so
this is a minor tidy, not the main event — the main event is that the default and the
`filter` path don't return `groups` at all.

### CLI: unchanged

`src/cli/commands/find-duplicates.ts` keeps printing `summary` + full `groups` + full
`clusters` at its own `--limit`/`--dup-query` semantics. The new `view` / `previewLimit` /
`hint` logic lives in the **MCP handler only** (`handleFindDuplicates`). If we want parity
later, add `--view` then; not now.

## Files

### Track A

| file | change |
|---|---|
| `src/graph/duplication/shape.ts` | `slimDupCluster`: add `longestMatchAt: string[]` (the longest member group's `"path:start-end"` occurrences) so a cluster is actionable without `groups`. Add `clusteredGroups?` to `DuplicatesSummary`. Add `dedupeGroupsAgainstClusters(groups, clusters)` helper (unit-tested) for the `view:"full"` path. |
| `src/mcp/handlers.ts` — `FindDuplicatesArgs` | add `view?: "summary" \| "groups" \| "full"`. |
| `src/mcp/handlers.ts` — `handleFindDuplicates` | branch the response builder: no `filter`/`view` → `{ minLines, summary, clusters: slim ≤ previewLimit (8), hint }`; `filter` → `{ …, filter, summary, clusters: slim ≤ limit }`; `view:"groups"` → adds `groups: slim ≤ limit`, `count`; `view:"full"` → both, `groups` de-duped vs clusters. `hint` built from `summary`. Default `limit` 50 → 20. Lower `FIND_DUPLICATES_MAX_PAYLOAD_BYTES` 1_000_000 → 120_000. |
| `src/mcp/tools.ts` | `find_duplicates` schema: add `view` enum (default `"summary"`); note `limit` is ignored for `summary`; trim the `description` to say summary-first, `filter` to drill in. |
| `docs/mcp.md` | rewrite `find_duplicates` "Returns" for the views; document `hint`, `longestMatchAt`, summary-first default. |
| `docs/query.md` | note `find_duplicates` is summary-first; `filter` / `view:"groups"` is how you get spans. |
| `CLAUDE.md` | update the `find_duplicates` blurb. |

### Track B

| file | change |
|---|---|
| `src/const.ts` | `DEFAULT_DUPLICATION_RESULT_CACHE_FILE = "duplication-result.json"`. |
| `src/graph/duplication/result-cache-store.ts` (new) | `loadDuplicationResult(path, digest, params)` / `saveDuplicationResult(...)` — mirrors `token-cache-store.ts` (sync JSON, `mkdir -p`, never throws, digest+params gate). |
| `src/graph/duplication/index.ts` | export a `duplicationDigest(nodes, params)` helper (sorted `[relPath, mtime, size]` + param hash → sha256) so both consumers compute the key identically. |
| `src/mcp/handlers.ts` — `handleFindDuplicates` | before the per-package `findDuplicates` loop: compute digest, try `loadDuplicationResult`; on hit skip the scan and shape the cached arrays; on miss run + `saveDuplicationResult`. Per-package on a monorepo (one file per package, like the workspace cache) — reuse the existing `workspaceCacheDir`. |
| `src/mcp/cache.ts` | `getDuplicationResultCachePath(root)` alongside the token-cache path helper. |
| `src/cli/commands/find-duplicates.ts` | same load/save around its `findDuplicates` call. |
| `src/graph/duplication/result-cache-store.test.ts` (new) | round-trip, digest miss, param miss, corrupt-file → miss. |

## Track A perf cost

**Negligible.** No change to the scan, the suffix array, tokenizing, or clustering. The
work removed is JSON serialization of lists we no longer emit. `dedupeGroupsAgainstClusters`
is one `Set` of cluster-member identities + one `groups.filter` — O(groups). The payload
halving loop runs *less* often because the inputs are smaller.

---

## Track B — persist the duplication result to `mokosh-cache/`

### What exists today

- `mokosh-cache/duplication-tokens.json` — per-file **tokenize** cache, mtime/size
  fingerprinted (`src/graph/duplication/token-cache-store.ts`). Saves re-tokenizing
  unchanged files; does **not** save the suffix-array build, matching, dominance filter, or
  clustering — all of that reruns every call.
- `mokosh-cache/workspace/manifest.json` — precedent for exactly what we want: a manifest
  carrying a **source digest** + per-package digest, used to skip a rebuild when nothing
  changed (`src/graph/workspace/…`).

### Change

Add `mokosh-cache/duplication-result.json`:

```jsonc
{
  "digest": "<sha256 of sorted [relPath, mtime, size] for every in-scope file>",
  "params": { "minLines": 6, "ignoreLiterals": true, "maxPunctuationRatio": 0.5,
              "scope": "src", "includeGenerated": false, /* …every knob that changes output… */ },
  "groups": [ /* full DuplicateGroup[] */ ],
  "clusters": [ /* full DuplicateCluster[] */ ]
}
```

MCP handler flow becomes:

1. Compute `digest` from the graph's `FileNode` mtime/size (already in memory — no extra
   `stat`s) over the files the scan would consider, plus a hash of `params`.
2. If `duplication-result.json` exists and its `digest` + `params` match → load `groups` /
   `clusters` from disk, skip `findDuplicates` entirely. Apply `filter` / `view` / shaping
   to the cached arrays exactly as if they'd just been computed.
3. On miss → run `findDuplicates` as today, then write the result file.

Invalidation is the digest: any file added / removed / touched (mtime or size) flips it, and
any changed param flips it. No partial/incremental dup detection — a changed file can create
or destroy matches anywhere, so whole-result recompute on any change is the honest
granularity (same call the workspace cache makes).

CLI gets the same load/save around its `findDuplicates` call (it already does this for the
token cache two lines away), so `mokosh --find-duplicates` run twice in a row is instant.

### Track B perf cost

Pure win on the second+ call: the whole scan (tens of ms to seconds on a big monorepo)
becomes a file read + a digest compare. First call pays one extra JSON write (~the size of
today's uncapped result — a few MB on a huge repo; acceptable, it's the same data
`findDuplicates` just held in memory). Digest computation is O(files) over data already in
RAM. The result file is bounded by the repo, not unbounded — but it's a disk file, not a
response, so size there doesn't cost tokens.

### Interaction with Track A

Orthogonal. Track B caches the *full* `groups`/`clusters`; Track A decides what subset of
that gets serialized into the response. Cache the full thing on disk, shape it small on the
way out.

## Tests

`src/mcp/handlers.test.ts` (or wherever `handleFindDuplicates` is covered):

- default call (no `filter`) → response has `summary`, `clusters` (≤ 8), `hint`; **no
  `groups` key**; `hint` is a non-empty string mentioning `filter`.
- `filter` given → `groups` present, capped at 20, and no group in `groups` is a member of
  any returned cluster with `matchCount > 1`; `summary.clusteredGroups` ≥ 0 and equals the
  number folded.
- `view: "full"` with no filter → both lists present (escape hatch works).
- `view: "clusters"` / `view: "groups"` → only the named list.
- payload backstop: synthesize a large group set, assert `truncated: true` and
  `JSON.stringify(response).length <= 120_000`.

`src/graph/duplication/shape.test.ts`:

- `dedupeGroupsAgainstClusters` drops members of multi-member clusters, keeps singletons,
  keeps groups whose file set matches no returned cluster.

Re-baseline any existing `handleFindDuplicates` test that asserts on `groups` being present
by default (they'll need `view: "full"` or a `filter`).

## Rollout

1. **Track A** — `feat(mcp): summary-first find_duplicates response to cut token cost`.
   Response shape changes; only additive API change is the `view` arg.
2. **Track B** — `perf(duplication): disk-cache find_duplicates results, digest-invalidated`.
   No output change; pure latency.
3. Both need a release to reach users (the running build also predates `summary`/slim — see
   `mcp-tool-improvements.md`). Note the Track A shape change in `CHANGELOG` under `feat`.

## Definition of done

### Track A
- [ ] Default `find_duplicates` (no `filter`) returns `summary` + `clusters` ≤ 8 + `hint`,
      no `groups`; measured < 1.5K tokens on mokosh, < 4K on a large monorepo.
- [ ] `filter` path returns clusters only (≤ 20); `view:"groups"` returns spans;
      `view:"full"` returns both with `groups` de-duped and `summary.clusteredGroups` set.
- [ ] `slimDupCluster` carries `longestMatchAt` — a cluster is actionable without `groups`.
- [ ] `FIND_DUPLICATES_MAX_PAYLOAD_BYTES` = 120_000; backstop test green.
- [ ] CLI output unchanged.
- [ ] `docs/mcp.md`, `docs/query.md`, `CLAUDE.md`, tool schema/description updated.

### Track B
- [ ] Second `find_duplicates` call with no file changes serves from
      `mokosh-cache/duplication-result.json` without running the scan (assert via timing or a
      scan-spy in tests).
- [ ] Touching one in-scope file, or changing any output-affecting param, forces recompute.
- [ ] CLI `--find-duplicates` run twice is instant on the second run.
- [ ] Corrupt / missing result file degrades to a normal scan (never throws).

- [ ] Full `src/graph/duplication/*.test.ts` + MCP handler tests green for both.

## Out of scope

- `minScore` per-family default — `duplication-minscore-calibration.md`.
- Cursor-based pagination for `query` / `find_duplicates` — `mcp-tool-improvements.md`.
- Changing what counts as a duplicate (families, signals, clustering algorithm).
