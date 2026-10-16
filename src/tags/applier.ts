/** Writes tag annotations into test files using a framework-specific strategy. */
import fs from "node:fs/promises";
import path from "node:path";
import { loadMokoshConfig } from "../config";
import type { Graph } from "../graph";
import { isSelectionTag } from "../tag-quality";
import { createStrategies, getStrategyForFile, type TagApplierStrategy } from "./strategies";

/**
 * @description Result for a single file processed by {@link applyTagsToFile}.
 */
export interface ApplyTagsFileResult {
  /** Project-relative path of the test file. */
  path: string;
  /** `"updated"` when the file was rewritten, `"unchanged"` when tags already matched, `"error"` on I/O failure. */
  status: "updated" | "unchanged" | "error";
  /** Present only when status is `"error"`. */
  error?: string;
}

/**
 * @description Aggregate result returned by {@link applyTags} after processing all test nodes.
 */
export interface ApplyTagsResult {
  /** Number of files that were written (or would have been written in dry-run mode). */
  updated: number;
  /** Number of files where the existing tags already matched the computed tags. */
  unchanged: number;
  /** Number of files that could not be read or written. */
  errors: number;
  /** Per-file breakdown. */
  files: ApplyTagsFileResult[];
}

/**
 * @description Reads a single test file, delegates tag injection to the appropriate strategy,
 *   and writes the result back to disk (unless `dryRun` is true).
 * @param {string} absPath - Absolute path of the test file to update.
 * @param {string[]} tags - Computed tag names (filtered, sorted) to write.
 * @param {boolean} dryRun - When true, computes the change but skips the `fs.writeFile` call.
 * @param {TagApplierStrategy[]} strategies - Ordered strategy list; first matching strategy wins.
 * @returns {Promise<ApplyTagsFileResult>} Result object with path and status.
 */
export async function applyTagsToFile(
  absPath: string,
  tags: string[],
  dryRun: boolean,
  strategies: TagApplierStrategy[],
): Promise<ApplyTagsFileResult> {
  let original: string;
  try {
    original = await fs.readFile(absPath, "utf8");
  } catch (err) {
    return { path: absPath, status: "error", error: String(err) };
  }

  const strategy = getStrategyForFile(absPath, strategies);
  if (!strategy) return { path: absPath, status: "unchanged" };

  const newContent = strategy.apply(absPath, original, tags);
  if (newContent === original) return { path: absPath, status: "unchanged" };

  if (!dryRun) await fs.writeFile(absPath, newContent, "utf8");
  return { path: absPath, status: "updated" };
}

/**
 * @description Iterates every test node in the graph, keeps its selection-quality tags
 *   (see {@link isSelectionTag} — `import` filename/symbol tags and deliberate `comment-marker`
 *   markers, minus declaration/library names, `test`/`barrel`, and blocklisted generics), then
 *   delegates writing to the strategy selected by `mokosh.config.*` (`tagApplier.framework`,
 *   default `"vitest"`). Non-test nodes are skipped. Assumes `applyConfig` has already run for
 *   this root so any `tags.blocklist` / `tags.allowlist` is active.
 * @param {Graph} graph - The fully-enriched dependency graph.
 * @param {string} rootDir - Absolute path to the project root.
 * @param {{ dryRun: boolean }} options - Pass `dryRun: true` to preview changes without disk writes.
 * @returns {Promise<ApplyTagsResult>} Aggregate result with per-file status breakdown.
 */
export async function applyTags(
  graph: Graph,
  rootDir: string,
  options: { dryRun: boolean },
): Promise<ApplyTagsResult> {
  const config = loadMokoshConfig(rootDir);
  const framework = config.tagApplier?.framework ?? "vitest";
  const frameworkOverrides = config.tagApplier?.frameworkOverrides ?? {};
  const strategies = createStrategies(framework, frameworkOverrides, rootDir);

  const result: ApplyTagsResult = { updated: 0, unchanged: 0, errors: 0, files: [] };

  for (const node of graph.nodes.values()) {
    if (node.category !== "test") continue;

    const seen = new Set<string>();
    const tagNames: string[] = [];
    for (const tag of node.tags) {
      if (!isSelectionTag(tag)) continue;
      if (!seen.has(tag.name)) {
        seen.add(tag.name);
        tagNames.push(tag.name);
      }
    }
    tagNames.sort();

    const absPath = path.resolve(rootDir, node.path);
    const fileResult = await applyTagsToFile(absPath, tagNames, options.dryRun, strategies);
    fileResult.path = node.path;
    result.files.push(fileResult);
    if (fileResult.status === "updated") result.updated++;
    else if (fileResult.status === "unchanged") result.unchanged++;
    else result.errors++;
  }

  return result;
}

/** Max `updated` entries listed in the default (non-verbose) `apply_tags` response. */
export const APPLY_TAGS_SAMPLE_LIMIT = 20;

/** Token-bounded `apply_tags` response: counts, every error, and a sample of changed files. */
export interface ApplyTagsSummary {
  /** Echo of the mode, so a dry run is never mistaken for a write. */
  dryRun: boolean;
  /** Files written (dry run: files that would be written). */
  updated: number;
  /** Files whose tags already matched. */
  unchanged: number;
  /** Files that could not be read or written. */
  errors: number;
  /** Every `error` entry plus up to {@link APPLY_TAGS_SAMPLE_LIMIT} `updated` ones. */
  files: ApplyTagsFileResult[];
  /** `updated` entries not listed in `files`; present only when > 0. */
  moreUpdated?: number;
  /** How to get the full per-file list; present only when `moreUpdated`. */
  hint?: string;
}

/**
 * @description Collapses an {@link ApplyTagsResult} to what a caller needs by default: the counts,
 *   all errors, and a capped sample of `updated` files. `unchanged` files are never listed (their
 *   count says it all) and error text has the absolute `root` stripped.
 * @param {ApplyTagsResult} result - Full per-file result from {@link applyTags}.
 * @param {{ dryRun: boolean; root: string }} context - `dryRun` is echoed; `root` is stripped from error strings.
 * @returns {ApplyTagsSummary} Counts plus a bounded `files` list.
 */
export function summarizeApplyTags(
  result: ApplyTagsResult,
  context: { dryRun: boolean; root: string },
): ApplyTagsSummary {
  const errors = result.files
    .filter((file) => file.status === "error")
    .map((file) => ({
      ...file,
      ...(file.error && { error: file.error.split(context.root).join(".") }),
    }));
  const updated = result.files.filter((file) => file.status === "updated");
  const sample = updated.slice(0, APPLY_TAGS_SAMPLE_LIMIT);
  const moreUpdated = updated.length - sample.length;
  return {
    dryRun: context.dryRun,
    updated: result.updated,
    unchanged: result.unchanged,
    errors: result.errors,
    files: [...errors, ...sample],
    ...(moreUpdated > 0 && {
      moreUpdated,
      hint: "Pass verbose:true for the full per-file list (including unchanged files).",
    }),
  };
}
