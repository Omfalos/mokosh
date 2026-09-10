/**
 * Shared definition of a **test-selection tag** — a tag name that is a plausible
 * `vitest --grep` / native-framework-tag term for "given this source change, which tests run?".
 *
 * Graph tags are produced generously (every top-level declaration name, every imported symbol,
 * every `@word` in a test title, every third-party package). Most of those are noise for test
 * selection: a `library` tag like `vitest` matches every test under grep, a `function` tag is
 * the name of a helper in the test file itself, `test`/`barrel` are on every node of their
 * kind. This module is the one place that decides which tags survive, reused by
 * `propose_tags` (`src/tags/proposer.ts`), `apply_tags` (`src/tags/applier.ts`),
 * `list_tags` (`src/graph/tag-inventory.ts`) and the `tag:` query filter
 * (`src/query/matchers.ts`).
 *
 * The blocklist is configured from `mokosh.config` via {@link configureTagQuality}, called by
 * `applyConfig` — the same reset-then-apply lifecycle as the classify registries.
 */
import type { StructuredTag } from "./types/node";
import type { TagKind } from "./types/parse";

/** Tag kinds that can denote a test-selection label. `function` / `variable` are declaration
 *  names (a helper in the test file, or a symbol on a source file — neither is a grep term);
 *  `library` is a third-party package name (present on nearly every test). `class` / `type`
 *  are never produced. */
export const SELECTION_TAG_KINDS: readonly TagKind[] = ["comment-marker", "import"];

/** Tag names that are just a file's `category` echoed as a tag — present on every node of that
 *  category, so they have zero selectivity. */
export const CATEGORY_MARKER_TAGS: ReadonlySet<string> = new Set(["test", "barrel"]);

/** A tag name must be a bare identifier: no `@`, `:`, `/`, spaces. (Moved here from
 *  `src/tags/applier.ts`.) */
export const VALID_TAG_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{1,}$/;

/**
 * Curated generic names that appear in almost every codebase and carry no domain signal, so
 * they never make a useful test-selection tag. Deliberately **conservative** — real subsystem
 * names (`graph`, `parser`, `resolver`, `cache`, …) are left queryable; a project narrows
 * further with `mokosh.config` `tags.blocklist`. Mirrors the `rename-singles` denylist
 * philosophy: small, evidence-driven, extended only when a name is shown to be noise.
 *
 * Seeded from `applier.ts`'s former `GENERIC_TAG_BLOCKLIST` plus the generic offenders seen
 * dominating `list_tags` on real repos (structural filenames + common code words).
 */
export const DEFAULT_TAG_BLOCKLIST: ReadonlySet<string> = new Set([
  // structural filenames
  "index",
  "main",
  "common",
  "shared",
  "types",
  "type",
  "constants",
  "const",
  "config",
  "util",
  "utils",
  "helper",
  "helpers",
  "mock",
  "mocks",
  "fixture",
  "fixtures",
  "setup",
  "spec",
  "test",
  "tests",
  // common code words that are never a meaningful grep term
  "args",
  "props",
  "options",
  "opts",
  "context",
  "ctx",
  "handler",
  "handlers",
  "callback",
  "cb",
  "fn",
  "impl",
  "run",
  "get",
  "set",
  "use",
  "name",
  "value",
  "data",
  "item",
  "result",
  "node",
  "org",
  // Go build-constraint platform tokens (`//go:build linux && amd64`) — the parser emits these
  // as tags; GOOS/GOARCH/compiler names are environment, not test-selection labels. A custom
  // build tag like `integration` is not listed and still comes through.
  "linux",
  "darwin",
  "windows",
  "freebsd",
  "openbsd",
  "netbsd",
  "dragonfly",
  "solaris",
  "android",
  "ios",
  "js",
  "wasm",
  "wasip1",
  "plan9",
  "aix",
  "illumos",
  "amd64",
  "arm",
  "arm64",
  "ppc64",
  "ppc64le",
  "mips",
  "mips64",
  "riscv64",
  "s390x",
  "loong64",
  "cgo",
  "gc",
  "gccgo",
  "unix",
]);

/** User overrides from `mokosh.config` `tags`. */
export interface TagQualityConfig {
  /** Names added to {@link DEFAULT_TAG_BLOCKLIST} (case-insensitive). */
  blocklist?: string[];
  /** Names removed from the effective blocklist — kept even if built-in or user-blocked. */
  allowlist?: string[];
}

let activeBlocklist: Set<string> = new Set(DEFAULT_TAG_BLOCKLIST);

/**
 * @description Recomputes the process-wide effective tag blocklist:
 *   `(DEFAULT_TAG_BLOCKLIST ∪ cfg.blocklist) \ cfg.allowlist`, all lower-cased. Called by
 *   `applyConfig` after `resetTagQuality`, so each analyzed root fully replaces the previous
 *   config rather than accumulating.
 * @param {TagQualityConfig} [cfg] - The `tags` section of the loaded `mokosh.config`.
 */
export function configureTagQuality(cfg?: TagQualityConfig): void {
  const next = new Set<string>(DEFAULT_TAG_BLOCKLIST);
  for (const name of cfg?.blocklist ?? []) next.add(name.toLowerCase());
  for (const name of cfg?.allowlist ?? []) next.delete(name.toLowerCase());
  activeBlocklist = next;
}

/** @description Restores the built-in blocklist, dropping any prior {@link configureTagQuality}. */
export function resetTagQuality(): void {
  activeBlocklist = new Set(DEFAULT_TAG_BLOCKLIST);
}

/**
 * @description The kind-independent half of {@link isSelectionTag}: a bare identifier, not a
 *   `category` echo (`test`/`barrel`), and not blocklisted. Use when you already have just a
 *   tag name (e.g. the `list_tags` inventory aggregates names across kinds).
 * @param {string} name - The tag name to test.
 * @returns {boolean} `true` when the name is not noise.
 */
export function isSelectionTagName(name: string): boolean {
  if (!VALID_TAG_NAME_RE.test(name)) return false;
  const lower = name.toLowerCase();
  return !CATEGORY_MARKER_TAGS.has(lower) && !activeBlocklist.has(lower);
}

/**
 * @description Whether a tag is usable as a test-selection label: a selection kind, plus
 *   {@link isSelectionTagName}.
 * @param {StructuredTag} tag - The structured tag to test.
 * @returns {boolean} `true` when the tag should be surfaced for test selection.
 */
export function isSelectionTag(tag: StructuredTag): boolean {
  return SELECTION_TAG_KINDS.includes(tag.kind) && isSelectionTagName(tag.name);
}

/**
 * @description Distinct names of the selection-quality tags on a node, in first-seen order.
 * @param {readonly StructuredTag[]} tags - A node's `tags` array.
 * @returns {string[]} Deduplicated selection tag names.
 */
export function selectionTagNames(tags: readonly StructuredTag[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    if (!isSelectionTag(tag) || seen.has(tag.name)) continue;
    seen.add(tag.name);
    out.push(tag.name);
  }
  return out;
}
