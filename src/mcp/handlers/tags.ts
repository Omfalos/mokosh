import path from "node:path";
import { DefaultGitProvider } from "../../git";
import {
  applyTags,
  buildTagInventory,
  type Graph,
  proposeAffectedTests,
  proposeTags,
  summarizeApplyTags,
  summarizeTagInventory,
} from "../../index";
import type { SessionState } from "../cache";
import type { TextResponse } from "../utils";
import { text } from "../utils";
import type { ApplyTagsArgs, ListTagsArgs, ProposeTagsArgs } from "./types";

/**
 * @description Bounded tag-discovery tool: lists tag names for `tag:<name>` querying. The
 *   response is always capped at `TAG_RESPONSE_HARD_CAP` (250) tags — no argument combination
 *   returns the full inventory. By default it shows only the query-meaningful kinds
 *   (`comment-marker`, `import`) with `count >= 2`, sorted by count descending, top 50. The
 *   `byKind` histogram (distinct names per kind, across all 5 real kinds: `comment-marker`,
 *   `import`, `function`, `variable`, `library`) and `totalDistinct` report what the cap hid;
 *   `kind`, `prefix` and `minCount` narrow the list to find a specific tag.
 * @param cache - Session state holding the cached graph.
 * @param args - `root` selects the graph; `kind` / `prefix` / `minCount` / `limit` shape the list.
 * @returns TextResponse with `{ tags: {name,count,kinds}[], count, matched, totalDistinct, byKind, truncated?, hint }`.
 */
export async function handleListTags(cache: SessionState, args: ListTagsArgs) {
  const { root, package: pkg, kind, prefix, minCount, limit } = args;
  const graphs = await cache.resolveGraphs(root, pkg);
  const inventory = buildTagInventory(graphs.map(({ graph }) => graph));
  return text(summarizeTagInventory(inventory, { kind, prefix, minCount, limit }));
}

/**
 * @description Backward-traverses from each changed file to propose what to run.
 *   format='tags' (default) collects tags from transitively dependent test files for CI tag-filtering.
 *   format='paths' returns test file paths ready to pipe to a test runner.
 *   Feature hub files short-circuit traversal and emit a `feature:<name>` tag to prevent explosion.
 *   Requires a prior `analyze` call.
 * @param cache - Session state holding the cached graph for `root`.
 * @param args - `root` selects the graph; `changedFiles` overrides git diff detection; `featureThreshold` tunes hub sensitivity; `format` controls output shape.
 * @returns TextResponse with `{ changedFiles, proposedTags }` for tags or `{ changedFiles, affectedTests, count }` for paths.
 */
export async function handleProposeTags(
  cache: SessionState,
  args: ProposeTagsArgs,
): Promise<TextResponse> {
  const { root, changedFiles, base, featureThreshold, format = "tags" } = args;
  const files =
    changedFiles ??
    new DefaultGitProvider()
      .getChangedFiles(root, base)
      .map((filePath) => path.relative(root, path.resolve(root, filePath)));
  const opts =
    featureThreshold !== undefined
      ? { featureDetection: { minOutDegree: featureThreshold } }
      : undefined;

  // Changed files can span multiple workspace packages in one PR — each file's blast radius
  // only makes sense traversed within its own package's graph, so group by owning package
  // rather than exposing a `package` arg the caller would have to pre-partition themselves.
  const fileGroups = cache.isWorkspaceRoot(root)
    ? await groupFilesByPackage(cache, root, files)
    : [{ graph: await cache.ensureFresh(root), files }];

  if (format === "paths") {
    const affectedTests = [
      ...new Set(
        fileGroups.flatMap(({ graph, files: groupFiles }) =>
          proposeAffectedTests(graph, groupFiles, opts),
        ),
      ),
    ];
    return text({ changedFiles: files, affectedTests, count: affectedTests.length });
  }
  const tags = [
    ...new Set(
      fileGroups.flatMap(({ graph, files: groupFiles }) => proposeTags(graph, groupFiles, opts)),
    ),
  ];
  return text({ changedFiles: files, proposedTags: tags });
}

/**
 * @description Partitions `files` by the workspace package that owns each one, pairing each
 *   group with that package's `Graph` — so `propose_tags`/`propose_affected_tests` traverse each
 *   changed file within its own package rather than a merged graph. Files that don't fall under
 *   any known package are dropped (silently — an untracked/deleted path is common in a diff and
 *   isn't an error here).
 * @param cache - Session state holding the workspace graph for `root`.
 * @param root - Absolute monorepo root path.
 * @param files - Root-relative changed-file paths.
 * @returns One `{ graph, files }` group per package that owns at least one of `files`.
 */
async function groupFilesByPackage(
  cache: SessionState,
  root: string,
  files: string[],
): Promise<Array<{ graph: Graph; files: string[] }>> {
  const wg = await cache.ensureFreshWorkspace(root);
  const byPackage = new Map<string, string[]>();
  for (const file of files) {
    const pkg = wg.getPackageForFile(file);
    if (!pkg) continue;
    const group = byPackage.get(pkg.name);
    if (group) group.push(file);
    else byPackage.set(pkg.name, [file]);
  }
  return Array.from(byPackage.entries())
    .map(([pkgName, pkgFiles]) => ({ graph: wg.packages.get(pkgName)?.graph, files: pkgFiles }))
    .filter((group): group is { graph: Graph; files: string[] } => !!group.graph);
}

/**
 * @description Writes `@tag` annotations into every test file reachable from the cached graph.
 *   Only `"import"` and `"comment-marker"` kind tags are written. Tags already present in the
 *   file are excluded from the generated block to avoid duplication. The block is idempotent:
 *   re-running replaces the existing block in place. Supports both TypeScript/JavaScript and
 *   Gherkin `.feature` files with format-appropriate block syntax. Requires a prior `analyze` call.
 * @param {SessionState} cache - Session state holding the cached graph for `root`.
 * @param {ApplyTagsArgs} args - `root` selects the graph; `dryRun` previews changes without disk writes; `verbose` returns every per-file entry.
 * @returns {Promise<TextResponse>} TextResponse with an `ApplyTagsSummary` (counts, all errors, a sample of updated files), or the full `ApplyTagsResult` when `verbose`.
 */
export async function handleApplyTags(
  cache: SessionState,
  args: ApplyTagsArgs,
): Promise<TextResponse> {
  const dryRun = args.dryRun ?? false;
  const graphs = await cache.resolveGraphs(args.root, args.package);
  const perPackage = await Promise.all(
    graphs.map(({ graph }) => applyTags(graph, args.root, { dryRun })),
  );
  const result = perPackage.reduce((acc, r) => ({
    updated: acc.updated + r.updated,
    unchanged: acc.unchanged + r.unchanged,
    errors: acc.errors + r.errors,
    files: [...acc.files, ...r.files],
  }));
  return text(args.verbose ? result : summarizeApplyTags(result, { dryRun, root: args.root }));
}
