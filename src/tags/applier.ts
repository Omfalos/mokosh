/** Writes tag annotations into test files using a framework-specific strategy. */
import fs from "node:fs/promises";
import path from "node:path";
import { loadMokoshConfig } from "../config";
import type { Graph } from "../graph";
import { createStrategies, getStrategyForFile, type TagApplierStrategy } from "./strategies";

// Valid tag names must be simple identifiers; colons (node:fs), slashes, and @ sigils are excluded.
const VALID_TAG_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{1,}$/;

// Only filename-derived import-kind tags qualify for writing. comment-marker tags are excluded
// because collectStringLiteralAtTags extracts @word from all string literals, including external
// package names in import paths (e.g. "@modelcontextprotocol/sdk" → tag "modelcontextprotocol").
const ALLOWED_TAG_KINDS = new Set(["import"]);

// Generic structural names that appear in nearly every project and carry no domain signal.
const GENERIC_TAG_BLOCKLIST = new Set([
  "common",
  "fixture",
  "fixtures",
  "helper",
  "helpers",
  "index",
  "main",
  "mock",
  "mocks",
  "setup",
  "shared",
  "spec",
  "test",
  "tests",
  "types",
  "util",
  "utils",
]);

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
 * @description Iterates every test node in the graph, extracts `"import"` kind tags that pass
 *   a name validity check and generic-name blocklist, then delegates writing to the strategy
 *   selected by `mokosh.config.*` (`tagApplier.framework`, default `"vitest"`). Non-test nodes
 *   are skipped.
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
      if (!ALLOWED_TAG_KINDS.has(tag.kind)) continue;
      if (!VALID_TAG_NAME_RE.test(tag.name)) continue;
      if (GENERIC_TAG_BLOCKLIST.has(tag.name.toLowerCase())) continue;
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
