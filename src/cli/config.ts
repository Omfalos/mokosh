import path from "node:path";
import { loadMokoshConfig, type MokoshConfig, type ScanOptions } from "../index";
import type { ParsedArgs } from "./args";

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
 * Merges parsed CLI arguments with the mokosh config file into a single
 * resolved configuration ready for graph building.
 *
 * CLI arguments take precedence: when entry points or a cache path are
 * provided on the command line they override the config-file equivalents.
 * Call `applyConfig(result.rawConfig)` after this function and before
 * starting the build to apply global parser settings.
 *
 * @param parsed - The CLI arguments needed for config resolution
 * @returns Fully resolved paths, entry points, and scan options derived from
 *   the combination of CLI flags and the loaded config file
 */
export function resolveConfig(parsed: ConfigInput): ResolvedConfig {
  const { rootDir, entryPoints, cachePath, configPath } = parsed;
  const config = configPath
    ? loadMokoshConfig(configPath, { isExplicitPath: true })
    : loadMokoshConfig(rootDir);

  const defaultCachePath = path.join(path.resolve(rootDir, "mokosh-cache"), "graph.json");

  const resolvedEntryPoints = entryPoints.length > 0 ? entryPoints : (config.entryPoints ?? []);

  const resolvedCachePath =
    cachePath !== defaultCachePath
      ? (cachePath ?? defaultCachePath)
      : config.cachePath
        ? path.resolve(rootDir, config.cachePath)
        : (cachePath ?? defaultCachePath);

  const scanOptions: ScanOptions = {
    ...(config.ignoreDirs !== undefined && { additionalIgnoreDirs: config.ignoreDirs }),
    ...(config.extensions !== undefined && { additionalExtensions: config.extensions }),
  };

  return { rootDir, resolvedEntryPoints, resolvedCachePath, scanOptions, rawConfig: config };
}
