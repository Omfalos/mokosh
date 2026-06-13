/** Registry for MonorepoDetector plugins, allowing custom detectors to be added alongside the built-in ones. */
import type { WorkspacePackage } from "./types";

/**
 * @description Contract for a tool-specific monorepo detector.
 *   Each detector knows how to recognise one package manager or build orchestrator
 *   and enumerate the packages it manages.
 */
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
   * @param {string} rootDir - Absolute path to the repository root to inspect.
   * @returns {WorkspacePackage[] | null} Discovered packages, an empty array if the tool is present but empty, or `null` if the tool is absent.
   */
  detect(rootDir: string): WorkspacePackage[] | null;
}

const registry: MonorepoDetector[] = [];

/**
 * @description Registers a monorepo detector. Detectors are run in registration order;
 *   register higher-priority tools first (e.g. Turborepo before pnpm).
 * @param {MonorepoDetector} detector - The detector implementation to add to the registry.
 */
export function registerMonorepoDetector(detector: MonorepoDetector): void {
  registry.push(detector);
}

/**
 * @description Returns all registered detectors in registration order.
 * @returns {readonly MonorepoDetector[]} Detectors in the order they were registered.
 */
export function getMonorepoDetectors(): readonly MonorepoDetector[] {
  return registry;
}
