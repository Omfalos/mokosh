/** CLI command: lists monorepo packages and their cross-package dependencies, mirroring the MCP get_workspace_packages tool. */
import { summarizeWorkspacePackages, type WorkspaceGraph } from "../../index";

/**
 * @description Prints every workspace package detected in a monorepo, with node counts and
 *   cross-package dependencies.
 * @param {WorkspaceGraph} wg - The workspace graph built for the monorepo root.
 */
export function runWorkspacePackages(wg: WorkspaceGraph): void {
  console.log(JSON.stringify(summarizeWorkspacePackages(wg), null, 2));
}
