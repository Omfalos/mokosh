import type { WorkspacePackage } from "./types";

export interface MonorepoDetector {
  /**
   * Identifier for this tool (e.g. `"pnpm"`, `"nx"`).
   * Included in `MonorepoLayout.types` when this detector fires.
   */
  readonly type: string;
  /**
   * @description Inspects `rootDir` and returns the workspace packages it manages.
   *   Return `null` to signal "this tool is not present here" (detector does not fire).
   *   Return an empty array to signal "tool is present but manages no packages" (detector fires, contributes its type).
   */
  detect(rootDir: string): WorkspacePackage[] | null;
}

const registry: MonorepoDetector[] = [];

/**
 * @description Registers a monorepo detector. Detectors are run in registration order;
 *   register higher-priority tools first (e.g. Turborepo before pnpm).
 */
export function registerMonorepoDetector(detector: MonorepoDetector): void {
  registry.push(detector);
}

/** @description Returns all registered detectors in registration order. */
export function getMonorepoDetectors(): readonly MonorepoDetector[] {
  return registry;
}
