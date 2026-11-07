# 10 — Dead code and public API size

## 10a. Dead / stale code
- `graph/duplication/shingle.ts` (556 lines): its own header says it is "kept and independently
  tested but no longer used" by the pipeline *(verified from the module description)*. It is still
  imported by `duplication/index.ts` for types and tested by 6 test files. Decide: delete (git has
  history) or move to `legacy/`. Extract still-used types (`FileTokens`, `DuplicateGroup`,
  `DuplicateOccurrence`) into `duplication/types.ts` first.
- `src/parser/lang/kotlin/tokens.js` and `kotlin/generated/tokens.js` both exist *(verified)*.
  Determine which is current (`scripts/build-kotlin-grammar.mjs` output) and remove or git-ignore
  the stale one. Mark generated output so the generated-file check skips it.
- `find_unused` real hits: `commitlint.config.mjs`, `tsup.config.ts`,
  `templates/config/mokosh.config.js` — all tool-loaded config; consider a config-file category so
  they are not reported.

## 10b. Public API
`src/index.ts` exposes 245 exports *(verified)*, including internals such as `CachedFileTokens`,
`CachedDuplicationResult`, `CALL_EDGE_TYPES`, `CATEGORY_MARKER_TAGS`.
- Classify exports as public / internal. Mark internals `@internal` and stop re-exporting them from
  `index.ts`; tests import from source paths instead.
- Add an API-extractor or `get_api_surface` snapshot test so additions to the public surface are
  deliberate.

## Risks
Removing exports is semver-breaking for library users of `@omfalos/mokosh`; check whether the
internals have been published, and release as minor/major accordingly.

## Done when
`src/index.ts` exports only what `docs/` documents as public, and `shingle.ts` is gone or
quarantined.
