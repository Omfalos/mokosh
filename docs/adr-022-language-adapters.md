# ADR-022: Per-language adapters

## Status
Accepted (phases 1–3 implemented).

## Context
Language knowledge was scattered: capability sets and the fidelity matrix in
`graph/language-support.ts` (kept in sync by a test), a duplicated `JVM_TYPES`, the extension
switch in `parser/file-type.ts`, and hard-coded TS/JS assumptions inside tools (`inferExportKind`,
`inferRole`, `detectNonJsEntryPoints`, `buildTypeGraph`, the duplicate scanner). Dogfooding on
OkHttp (Kotlin) showed the cost: `kind:"unknown"` exports, `role:"other"`, no type graph.

## Decision
`src/languages/` holds one **`LanguageAdapter`** per language: `type`, `family`, `extensions`,
`capabilities` (booleans), `fidelity`, `caveats`, and optional `hooks`. Adapters are pure data —
they import no parser or resolver — so the registry is cheap in worker threads and free of import
cycles. Parsers stay registered in `src/parser.ts`.

- The `*_TYPES` sets, `LANGUAGE_FIDELITY`, the caveat table and `getFileType` are **derived** from
  the registry; nothing is maintained twice.
- Tools ask the language through `src/languages/dispatch.ts` (`exportKindFor`,
  `detectNonJsEntryPoints`, `looksLikeTestPath`) or `getAdapter(type).hooks`, never `type ===`.
- Families (`js`, `jvm`, `style`) group languages that share behaviour; hooks such as
  `JVM_HOOKS` are attached to every member.
- A missing hook means "generic default"; a missing capability means "unsupported", explained by
  `languageSupportNote` / `languageCaveats`.

## Consequences
Adding a language is one adapter file plus the parser. Kotlin/Java gain export kinds, a type graph
(`typeKind`), name-convention roles (`roleHint`) and file descriptions from leading KDoc/Javadoc.
Not moved (deliberately): the duplicate tokenizer's per-language import-stripping, which is syntax
handling keyed by `FileType`, not tool dispatch.
