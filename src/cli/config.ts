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

/**
 * Loads the mokosh config file and merges it with parsed CLI args.
 * Pure: no side effects. The caller is responsible for calling `applyConfig(result.rawConfig)`
 * to apply global parser settings before graph building begins.
 */
export function resolveConfig(parsed: ParsedArgs): ResolvedConfig {
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
