/** Dependency-version metadata parsing. `loadLockFile` gathers every ecosystem mokosh
 * understands (JS lock files, Gradle/sbt build metadata) and combines them into one
 * {@link LockFileData}; the per-ecosystem parsers are re-exported for direct/test use. */
import { loadJsLockFile } from "./js";
import { loadJvmDependencies } from "./jvm";
import type { LockFileData } from "./types";

export {
  parseGradleBuildScript,
  parseGradleLockfile,
  parseGradleVersionCatalog,
} from "./gradle";
export { loadJsLockFile, parsePackageLock, parsePnpmLock, parseYarnLock } from "./js";
export { loadJvmDependencies } from "./jvm";
export { parseSbtBuild } from "./sbt";
export type { LockFileData } from "./types";
export { LOCK_FILE_NAMES } from "./types";

/**
 * @description Loads dependency-version metadata for `rootDir` from every ecosystem mokosh
 * understands and combines it into one {@link LockFileData}. The JS lock file (npm/Yarn/pnpm,
 * mutually exclusive) populates `dependencies`; Gradle/sbt metadata populates `jvmDependencies`.
 * Both are additive — a polyglot repo can carry a `package-lock.json` *and* Gradle build files —
 * so each source is gathered independently rather than first-match-wins across ecosystems.
 * @param rootDir - The project root directory.
 * @returns Combined lock file data, or `null` when no ecosystem yielded any metadata.
 */
export function loadLockFile(rootDir: string): LockFileData | null {
  const result = loadJsLockFile(rootDir);
  const jvmDependencies = loadJvmDependencies(rootDir);

  if (jvmDependencies) return { ...(result ?? { dependencies: {} }), jvmDependencies };
  return result;
}
