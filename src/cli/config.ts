/** Resolves the final CLI configuration by merging parsed args, mokosh.config.*, and built-in defaults. */
import path from "node:path";
import { loadMokoshConfig, type MokoshConfig, type ScanOptions } from "../index";
import type { ParsedArgs } from "./args";
import { DEFAULT_CACHE_DIR, DEFAULT_CACHE_FILE } from "./const";

export interface ResolvedConfig {
  rootDir: string;
  resolvedEntryPoints: string[];
  resolvedCachePath: string;
  scanOptions: ScanOptions;
  /** Raw config returned so the caller can call applyConfig() at the right moment. */
  rawConfig: MokoshConfig;
}

type ConfigInput = Pick<ParsedArgs, "rootDir" | "entryPoints" | "cachePath" | "configPath">;

/**
 * @description Picks the effective cache path: an explicit CLI override wins, then the
 *   config-file value (resolved against rootDir), then the computed default.
 * @param {string} cachePath - The CLI-resolved cache path (already defaulted if unset).
 * @param {string} defaultCachePath - The computed default cache path to compare against.
 * @param {string | undefined} configCachePath - The cache path from mokosh.config.*, if any.
 * @param {string} rootDir - The project root used to resolve a relative configCachePath.
 * @returns {string} The effective absolute cache path.
 */
function resolveCachePath(
  cachePath: string,
  defaultCachePath: string,
  configCachePath: string | undefined,
  rootDir: string,
): string {
  if (cachePath !== defaultCachePath) return cachePath;
  if (configCachePath) return path.resolve(rootDir, configCachePath);
  return defaultCachePath;
}

/**
 * @description Merges parsed CLI arguments with the mokosh config file into a single resolved
 *   configuration ready for graph building. CLI arguments take precedence over config-file values.
 *   Call `applyConfig(result.rawConfig)` after this and before starting the build.
 * @param {ConfigInput} parsed - The CLI arguments needed for config resolution.
 * @returns {ResolvedConfig} Fully resolved paths, entry points, and scan options.
 */
export function resolveConfig(parsed: ConfigInput): ResolvedConfig {
  const { rootDir, entryPoints, cachePath, configPath } = parsed;
  const config = configPath
    ? loadMokoshConfig(configPath, { isExplicitPath: true })
    : loadMokoshConfig(rootDir);

  const defaultCachePath = path.join(path.resolve(rootDir, DEFAULT_CACHE_DIR), DEFAULT_CACHE_FILE);

  const resolvedEntryPoints = entryPoints.length > 0 ? entryPoints : (config.entryPoints ?? []);

  const resolvedCachePath = resolveCachePath(
    cachePath,
    defaultCachePath,
    config.cachePath,
    rootDir,
  );

  const scanOptions: ScanOptions = {
    ...(config.ignoreDirs !== undefined && { additionalIgnoreDirs: config.ignoreDirs }),
    ...(config.extensions !== undefined && { additionalExtensions: config.extensions }),
  };

  return { rootDir, resolvedEntryPoints, resolvedCachePath, scanOptions, rawConfig: config };
}
