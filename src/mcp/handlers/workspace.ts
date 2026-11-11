import { summarizeWorkspaceLayout } from "../../index";
import type { SessionState } from "../cache";
import type { TextResponse } from "../utils";
import { text } from "../utils";
import type { GetWorkspaceAffectedArgs, GetWorkspacePackagesArgs } from "./types";

/**
 * @description Lists all workspace packages detected in a monorepo root. Answers from the
 *   detected layout and `package.json` manifests alone — no dependency-graph build — so it
 *   returns in well under a second even on large monorepos (see
 *   docs/known_issues/01-monorepo-workspace-packages-timeout.md). Per-package `nodeCount` and,
 *   for build-system monorepos without manifests, exact `dependsOn` are filled in only when a
 *   workspace graph is already cached from a prior `analyze` call.
 * @param cache - Session state; consulted for an already-built workspace graph, never triggers one.
 * @param args - `root` identifies the monorepo root to look up.
 * @returns TextResponse with `{ monorepoType, packageCount, packages, dependsOnResolved, nodeCountsResolved }`.
 */
export async function handleGetWorkspacePackages(
  cache: SessionState,
  args: GetWorkspacePackagesArgs,
): Promise<TextResponse> {
  const { root } = args;
  const layout = cache.getLayout(root);
  if (layout.type === "none") {
    throw new Error(
      `${root} is not a recognized monorepo root (no pnpm/npm/yarn/Nx/Turborepo/Gradle/sbt workspace detected).`,
    );
  }
  const builtGraph = cache.hasWorkspace(root) ? cache.requireWorkspace(root) : undefined;
  return text(summarizeWorkspaceLayout(layout, builtGraph));
}

/**
 * @description Cross-package blast-radius analysis — the files affected if `file` changes,
 *   grouped by owning package with each package's file list capped so the response stays small
 *   on large monorepos (where the raw blast radius can be most of the repo). For the full,
 *   uncapped list of affected files in one package, call `get_affected` on `file` (it now spans
 *   the whole workspace) or narrow with a `query`. Requires a prior `analyze` call with no entry points.
 * @param cache - Session state holding the cached WorkspaceGraph.
 * @param args - `root` identifies the monorepo; `file` is the changed file (relative to root);
 *   `maxFilesPerPackage` caps each package's `sample` list (default 10; 0 = counts only).
 * @returns TextResponse with a `WorkspaceAffectedSummary`: `{ file, totalAffected, packageCount, byPackage, truncated }`.
 */
export async function handleGetWorkspaceAffected(
  cache: SessionState,
  args: GetWorkspaceAffectedArgs,
): Promise<TextResponse> {
  const { root, file, maxFilesPerPackage } = args;
  const wg = await cache.ensureFreshWorkspace(root);
  const summary = wg.summarizeAffectedAcrossPackages(
    file,
    maxFilesPerPackage !== undefined ? { maxFilesPerPackage } : {},
  );
  return text(summary);
}
