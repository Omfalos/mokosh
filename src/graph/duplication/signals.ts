import type { DuplicateGroup, DuplicateSignal } from "./shingle";
import { isSvgMarkupSpan } from "./svg-markup";

/** A path that belongs to a test: a `__tests__` / `__mocks__` / `__snapshots__` / `test` /
 *  `tests` / `e2e` directory segment, a `.test.` / `.spec.` basename infix (so
 *  `Foo-e2e.test.stories.tsx` counts too, not just `Foo.test.ts`), or a `.snap` snapshot.
 *  Matched against project-relative, `/`-separated paths — `findDuplicates` normalizes
 *  separators before use. */
const TEST_PATH =
  /(?:^|\/)(?:__tests__|__mocks__|__snapshots__|tests?|e2e)\/|\.(?:test|spec)\.[^/]*$|\.snap$/;

/**
 * @description Attaches advisory {@link DuplicateSignal}s to a group: `"same-file"` when every
 *   occurrence is in one file, `"generated"` when any occurrence is in a file scanned only
 *   because `includeGenerated: true`, `"svg-markup"` when every occurrence's source span reads as
 *   inline SVG / SVG-shaped JSX markup (see {@link isSvgMarkupSpan}), `"test"` when any occurrence
 *   is in a test file (see {@link TEST_PATH}), `"docs"` when the group is in the `markdown`
 *   family. Merged with any signal the
 *   group's own extractor already set (e.g. `style-vars.ts`'s `"value-drift"`) rather than
 *   replacing it.
 *
 *   `"svg-markup"` is applied to `kind: "definition"` groups (a `defKind: "jsxElement"` match on
 *   an icon's shared `<defs>`/`<filter>` block) as well as block matches: both are noise the user
 *   asked to have out of the default view. It stays recoverable via `includeSvgMarkup` — the
 *   `jsxElement` detector still produces the group, it's just filtered by default like `same-file`.
 * @param group - A finalized duplicate group.
 * @param generatedPaths - Project-relative paths of generated files kept in this scan.
 * @param sourceByFile - Retained source text per file (JS/TS files only — the ones inline SVG
 *   lives in), used for the `"svg-markup"` check; a group with an occurrence whose source isn't
 *   available is simply never tagged `"svg-markup"`.
 * @returns The same group with `signals` set when at least one applies, otherwise unchanged.
 */
export function withSignals(
  group: DuplicateGroup,
  generatedPaths: ReadonlySet<string>,
  sourceByFile: ReadonlyMap<string, string>,
): DuplicateGroup {
  const signals: DuplicateSignal[] = [...(group.signals ?? [])];
  if (new Set(group.occurrences.map((occ) => occ.file)).size === 1) signals.push("same-file");
  if (group.occurrences.some((occ) => generatedPaths.has(occ.file))) signals.push("generated");
  if (group.occurrences.some((occ) => TEST_PATH.test(occ.file))) signals.push("test");
  // The whole `markdown` family: prose docs (README ↔ *.mdx, *.md ↔ *.md) aren't code
  // duplication. Matching never crosses a family boundary, so this is all occurrences.
  if (group.family === "markdown") signals.push("docs");
  if (
    group.occurrences.length > 0 &&
    group.occurrences.every((occ) => {
      const source = sourceByFile.get(occ.file);
      return source !== undefined && isSvgMarkupSpan(source, occ.startLine, occ.endLine);
    })
  ) {
    signals.push("svg-markup");
  }
  return signals.length > 0 ? { ...group, signals } : group;
}
