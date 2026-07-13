/** CLI command: cross-package blast-radius analysis, mirroring the MCP get_workspace_affected tool. */
import type { WorkspaceGraph } from "../../index";

/**
 * @description Prints every file (annotated with its package) that could be affected if `file` changes.
 * @param {WorkspaceGraph} wg - The workspace graph built for the monorepo root.
 * @param {string} file - Monorepo-root-relative path of the changed file.
 */
export function runWorkspaceAffected(wg: WorkspaceGraph, file: string): void {
  const affected = wg.getAffectedAcrossPackages(file);
  console.log(JSON.stringify({ file, affected, count: affected.length }, null, 2));
}
