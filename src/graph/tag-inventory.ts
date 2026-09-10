/**
 * Response-shaping helpers shared by the `list_tags` MCP handler and the `--list-tags` CLI
 * command — kept in one place so both consumers present the tag inventory identically.
 *
 * `list_tags` is deliberately a *bounded* discovery tool: every response is capped at
 * {@link TAG_RESPONSE_HARD_CAP} tags regardless of arguments, so there is no way to pull the
 * full (thousand-plus) tag list into a model's context in one call. The `byKind` histogram and
 * `totalDistinct` count report what exists beyond the cap; `kind` / `prefix` / `minCount`
 * narrow the list to find a specific tag.
 */
import { isSelectionTagName, SELECTION_TAG_KINDS } from "../tag-quality";
import type { TagKind } from "../types/parse";
import type { Graph } from "./model";

/** Tag kinds worth surfacing for `tag:<name>` querying by default — the shared
 *  {@link SELECTION_TAG_KINDS} (`comment-marker` + `import`). The other kinds (`function` /
 *  `variable` / `library`) are declaration/dependency names, not test-selection labels. */
export const SUMMARY_TAG_KINDS: readonly TagKind[] = SELECTION_TAG_KINDS;

/** Default `minCount` floor — drops the single-occurrence long tail. */
export const DEFAULT_TAG_MIN_COUNT = 2;

/** Default `limit` when the caller gives none. 50 count-ranked tags ≈ ~1K tokens and covers
 *  the discovery need; the tail past it is uniformly low-count. */
export const DEFAULT_TAG_LIMIT = 50;

/** Absolute ceiling on the returned `tags` array. `limit` is clamped to this; no argument
 *  combination can exceed it. ~250 `{name,count,kinds}` entries ≈ ~1.5K tokens. */
export const TAG_RESPONSE_HARD_CAP = 250;

/** `TagKind` union order, for deterministic `kinds` arrays. */
const TAG_KIND_ORDER: readonly TagKind[] = [
  "function",
  "class",
  "variable",
  "type",
  "import",
  "library",
  "comment-marker",
];

/** One distinct tag name, aggregated across every kind and node it appears on. */
export interface TagAggregateEntry {
  name: string;
  /** Total node occurrences, summed across every kind this name appears with. */
  count: number;
  /** Distinct kinds seen for this name, in `TagKind` declaration order. */
  kinds: TagKind[];
}

/** The full tag inventory for one or more graphs, before any filtering. */
export interface TagInventory {
  /** name → aggregate, first-seen insertion order. */
  entries: Map<string, TagAggregateEntry>;
  /** Distinct tag *names* per kind (a name carrying two kinds counts once under each). */
  byKind: Partial<Record<TagKind, number>>;
  /** `entries.size` — distinct tag names across all kinds. */
  totalDistinct: number;
}

/** Knobs for {@link summarizeTagInventory}. Each may be `undefined` (unset) so callers can
 *  forward optional args straight through under `exactOptionalPropertyTypes`. */
export interface TagSummaryOptions {
  /** Restrict to one kind, or `"all"` for every kind. Default: {@link SUMMARY_TAG_KINDS}. */
  kind?: TagKind | "all" | undefined;
  /** Case-insensitive substring match on the tag name. */
  prefix?: string | undefined;
  /** Minimum node count for a tag to appear. Default: {@link DEFAULT_TAG_MIN_COUNT}. */
  minCount?: number | undefined;
  /** Max tags returned. Default: {@link DEFAULT_TAG_LIMIT}; hard-capped at
   *  {@link TAG_RESPONSE_HARD_CAP}. */
  limit?: number | undefined;
}

/** The bounded `list_tags` response. */
export interface TagSummary {
  /** Filtered, sorted (count desc, then name asc), capped. */
  tags: Array<{ name: string; count: number; kinds: TagKind[] }>;
  /** `tags.length` after the cap. */
  count: number;
  /** Names passing the `kind` + `prefix` + `minCount` filter, before the cap. */
  matched: number;
  /** Distinct tag names across ALL kinds, before any filter. */
  totalDistinct: number;
  /** Distinct names per kind over the FULL inventory (always every kind). */
  byKind: Partial<Record<TagKind, number>>;
  /** Set when `matched > count` (the cap or `limit` clipped the list). */
  truncated?: true;
  /** How to narrow further. */
  hint: string;
}

/**
 * @description Aggregates every tag on every node of the given graphs into one inventory:
 *   per-name occurrence count, the set of kinds each name carries, and a `byKind` histogram
 *   of distinct names per kind. Replaces the ad-hoc count loop the MCP handler and CLI command
 *   each used to run.
 * @param {readonly Graph[]} graphs - Graphs to scan (one for a single package, many for a
 *   workspace fan-out).
 * @returns {TagInventory} The full, unfiltered inventory.
 */
export function buildTagInventory(graphs: readonly Graph[]): TagInventory {
  const entries = new Map<string, TagAggregateEntry>();
  for (const graph of graphs) {
    for (const node of graph.nodes.values()) {
      for (const tag of node.tags) {
        let entry = entries.get(tag.name);
        if (entry === undefined) {
          entry = { name: tag.name, count: 0, kinds: [] };
          entries.set(tag.name, entry);
        }
        entry.count += 1;
        if (!entry.kinds.includes(tag.kind)) entry.kinds.push(tag.kind);
      }
    }
  }
  const byKind: Partial<Record<TagKind, number>> = {};
  for (const entry of entries.values()) {
    entry.kinds.sort((a, b) => TAG_KIND_ORDER.indexOf(a) - TAG_KIND_ORDER.indexOf(b));
    for (const kind of entry.kinds) byKind[kind] = (byKind[kind] ?? 0) + 1;
  }
  return { entries, byKind, totalDistinct: entries.size };
}

/**
 * @description Filters, sorts and caps a {@link TagInventory} into the bounded `list_tags`
 *   response. The returned `tags` array never exceeds {@link TAG_RESPONSE_HARD_CAP}, whatever
 *   the options; `byKind` and `totalDistinct` always describe the full inventory so a caller
 *   can see what the cap hid.
 * @param {TagInventory} inventory - Output of {@link buildTagInventory}.
 * @param {TagSummaryOptions} [opts] - `kind` / `prefix` / `minCount` / `limit` knobs.
 * @returns {TagSummary} The bounded response object.
 */
export function summarizeTagInventory(
  inventory: TagInventory,
  opts: TagSummaryOptions = {},
): TagSummary {
  const minCount = Number.isFinite(opts.minCount)
    ? Math.max(1, Math.trunc(opts.minCount as number))
    : DEFAULT_TAG_MIN_COUNT;
  const requestedLimit = Number.isFinite(opts.limit)
    ? Math.max(0, Math.trunc(opts.limit as number))
    : DEFAULT_TAG_LIMIT;
  const limit = Math.min(requestedLimit, TAG_RESPONSE_HARD_CAP);
  const prefix = opts.prefix?.toLowerCase();

  // The default view (no explicit `kind`) is the test-selection view: selection kinds AND a
  // name that isn't a category echo / blocklisted generic. An explicit `kind` (incl. "all") is
  // the escape hatch — it shows the raw census, blocklist included.
  const entryPredicate = (entry: TagAggregateEntry): boolean => {
    if (opts.kind === undefined) {
      return (
        entry.kinds.some((k) => SUMMARY_TAG_KINDS.includes(k)) && isSelectionTagName(entry.name)
      );
    }
    if (opts.kind === "all") return true;
    return entry.kinds.includes(opts.kind);
  };

  const filtered = [...inventory.entries.values()]
    .filter(
      (entry) =>
        entry.count >= minCount &&
        entryPredicate(entry) &&
        (prefix === undefined || entry.name.toLowerCase().includes(prefix)),
    )
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const matched = filtered.length;
  const capped = filtered.slice(0, limit);

  const kindLabel =
    opts.kind === undefined
      ? `${SUMMARY_TAG_KINDS.join(" + ")} kinds, noise-filtered`
      : opts.kind === "all"
        ? "all kinds"
        : `${opts.kind} kind`;
  const truncated = matched > capped.length;

  const summary: TagSummary = {
    tags: capped.map((entry) => ({ name: entry.name, count: entry.count, kinds: entry.kinds })),
    count: capped.length,
    matched,
    totalDistinct: inventory.totalDistinct,
    byKind: inventory.byKind,
    hint:
      `${matched} tag${matched === 1 ? "" : "s"} match (${kindLabel}, count>=${minCount})` +
      `${truncated ? `; showing the top ${capped.length}` : ""}. ` +
      `${inventory.totalDistinct} distinct tag names exist across all kinds — see byKind. ` +
      `Narrow with prefix:"…", a higher minCount, or kind:"comment-marker"|"import"|` +
      `"function"|"variable"|"library"|"all". This response is always capped at ` +
      `${TAG_RESPONSE_HARD_CAP} tags.`,
  };
  if (truncated) summary.truncated = true;
  return summary;
}
