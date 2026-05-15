import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

/**
 * Represents the parsed data from a lock file.
 */
export interface LockFileData {
  /**
   * Map of package names to their version and nested dependencies.
   */
  dependencies: Record<string, { version: string; dependencies?: Record<string, string> }>;
}

interface PkgData {
  version: string;
  dependencies?: Record<string, string>;
}

interface PackageLock {
  packages?: Record<string, PkgData>;
  dependencies?: Record<string, PkgData>;
}

/**
 * @description Strips the `@version` suffix from a package descriptor string,
 * correctly handling scoped packages like `@scope/pkg@1.0.0` where the leading `@`
 * must not be treated as the version separator.
 * @param descriptor - The raw package descriptor string, e.g. `react@^18.0` or `@scope/pkg@1.0.0`.
 * @returns The package name without the version suffix, or the original string if no separator was found.
 */
function stripVersionSuffix(descriptor: string): string {
  const lastAt = descriptor.lastIndexOf("@");
  return lastAt > 0 ? descriptor.substring(0, lastAt) : descriptor;
}

/**
 * @description Parses the header line of a yarn classic block into deduplicated package names.
 * Strips trailing colons, surrounding quotes, and version descriptors from comma-separated
 * entries like `"react@^17.0", "react@^18.0":`.
 * @param line - A raw yarn classic header line, e.g. `"react@^17.0", "react@^18.0":`.
 * @returns Array of package names extracted from the descriptors.
 */
function parseYarnDescriptors(line: string): string[] {
  return line
    .replace(/:$/, "")
    .split(",")
    .map((part) => {
      let trimmed = part.trim();
      if (trimmed.startsWith('"')) trimmed = trimmed.slice(1);
      if (trimmed.endsWith('"')) trimmed = trimmed.slice(0, -1);
      return stripVersionSuffix(trimmed);
    })
    .filter(Boolean);
}

/**
 * @description Extracts a name and version from a pnpm package ID.
 * pnpm IDs use formats like `/pkg@version`, `/@scope/pkg@version`, or `pkg@version`;
 * when the ID encodes a version it is used as a fallback when `pkgVersion` is absent.
 * @param id - The pnpm package ID, e.g. `/lodash@4.17.21` or `/@scope/pkg@1.0.0`.
 * @param pkgVersion - The explicit version from the lockfile entry; takes priority over the version embedded in `id`.
 * @returns An object with the extracted `name` and resolved `version`.
 */
function parsePnpmId(id: string, pkgVersion: string): { name: string; version: string } {
  const raw = id.startsWith("/") ? id.slice(1) : id;
  const lastAt = raw.lastIndexOf("@");
  if (lastAt > 0) {
    return { name: raw.substring(0, lastAt), version: pkgVersion || raw.substring(lastAt + 1) };
  }
  return { name: raw, version: pkgVersion };
}

/**
 * @description Attempts to parse a Yarn Berry (v2+) YAML lockfile. Returns `null` when
 * YAML parsing fails so the caller can fall back to the classic text-format parser.
 * @param content - Raw text content of the `yarn.lock` file.
 * @returns Parsed lock file data on success, or `null` if YAML parsing fails.
 */
function tryParseYarnBerry(content: string): LockFileData | null {
  try {
    const lock = yaml.load(content) as Record<string, PkgData>;
    const result: LockFileData = { dependencies: {} };
    for (const [key, value] of Object.entries(lock)) {
      if (key === "__metadata" || !value?.version) continue;
      for (const part of key.split(", ")) {
        const name = stripVersionSuffix(part);
        if (name) {
          result.dependencies[name] = {
            version: value.version,
            ...(value.dependencies !== undefined && { dependencies: value.dependencies }),
          };
        }
      }
    }
    return result;
  } catch (_e) {
    return null;
  }
}

/**
 * @description Parses a Yarn v1 classic lockfile by splitting the content into blank-line-separated
 * blocks. Each block's first non-comment, non-indented line carries the package descriptors;
 * a `version "..."` line within the same block provides the resolved version.
 * @param content - Raw text content of the `yarn.lock` file.
 * @returns Parsed lock file data with all discovered package versions.
 */
function parseYarnClassic(content: string): LockFileData {
  const result: LockFileData = { dependencies: {} };

  for (const block of content.split(/\n\n+/)) {
    const lines = block.split("\n").filter((l) => l.trim().length > 0 && !l.trim().startsWith("#"));
    if (lines.length < 2) continue;

    const header = lines[0];
    if (!header || header.startsWith(" ")) continue;

    const names = parseYarnDescriptors(header);
    if (names.length === 0) continue;

    const versionLine = lines.find((l) => l.trim().startsWith('version "'));
    const version = versionLine?.match(/version "(.*?)"/)?.[1] ?? "";

    for (const name of names) {
      result.dependencies[name] = { version };
    }
  }

  return result;
}

/**
 * @description Parses a `package-lock.json` file. Supports v1/v2 (`dependencies` key) and
 * v3 (`packages` key with `node_modules/` prefixed paths); nested `node_modules` entries
 * (e.g. `node_modules/a/node_modules/b`) are skipped.
 * @param filePath - Absolute path to the `package-lock.json` file.
 * @returns Parsed lock file data with all top-level dependencies and their versions.
 */
export function parsePackageLock(filePath: string): LockFileData {
  const content = fs.readFileSync(filePath, "utf-8");
  const lock = JSON.parse(content) as PackageLock;
  const result: LockFileData = { dependencies: {} };

  if (lock.packages) {
    for (const [pkgPath, pkgData] of Object.entries(lock.packages)) {
      if (!pkgPath.startsWith("node_modules/")) continue;
      const name = pkgPath.replace("node_modules/", "");
      if (name.includes("node_modules/")) continue;
      result.dependencies[name] = {
        version: pkgData.version,
        ...(pkgData.dependencies !== undefined && { dependencies: pkgData.dependencies }),
      };
    }
  } else if (lock.dependencies) {
    for (const [name, pkgData] of Object.entries(lock.dependencies)) {
      result.dependencies[name] = {
        version: pkgData.version,
        ...(pkgData.dependencies !== undefined && { dependencies: pkgData.dependencies }),
      };
    }
  }

  return result;
}

/**
 * @description Parses a `yarn.lock` file. Detects Yarn Berry (v2+) by the presence of
 * `__metadata:` and attempts YAML parsing first; falls back to the v1 classic text parser
 * when YAML parsing fails.
 * @param filePath - Absolute path to the `yarn.lock` file.
 * @returns Parsed lock file data with all discovered package versions.
 */
export function parseYarnLock(filePath: string): LockFileData {
  const content = fs.readFileSync(filePath, "utf-8");

  if (content.includes("__metadata:")) {
    const berryResult = tryParseYarnBerry(content);
    if (berryResult !== null) return berryResult;
  }

  return parseYarnClassic(content);
}

/**
 * @description Parses a `pnpm-lock.yaml` file. Handles the `packages` section (v6+) where
 * package IDs encode the name and version, and the root-level `dependencies` section (v5)
 * as a fallback for packages not already captured from `packages`.
 * @param filePath - Absolute path to the `pnpm-lock.yaml` file.
 * @returns Parsed lock file data, or an empty dependencies map if YAML parsing fails.
 */
export function parsePnpmLock(filePath: string): LockFileData {
  const content = fs.readFileSync(filePath, "utf-8");
  const result: LockFileData = { dependencies: {} };

  try {
    const lock = yaml.load(content) as {
      packages?: Record<string, PkgData>;
      dependencies?: Record<string, string | PkgData>;
    };

    if (lock.packages) {
      for (const [id, pkgData] of Object.entries(lock.packages)) {
        const { name, version } = parsePnpmId(id, pkgData.version);
        if (name) {
          result.dependencies[name] = {
            version,
            ...(pkgData.dependencies !== undefined && { dependencies: pkgData.dependencies }),
          };
        }
      }
    }

    if (lock.dependencies) {
      for (const [name, versionData] of Object.entries(lock.dependencies)) {
        if (result.dependencies[name]) continue;
        const version = typeof versionData === "string" ? versionData : versionData.version;
        result.dependencies[name] = { version: version || "" };
      }
    }
  } catch (_e) {
    // Ignore YAML errors
  }

  return result;
}

/**
 * @description Detects and loads the first supported lock file found in `rootDir`.
 * Checks for `package-lock.json`, `yarn.lock`, and `pnpm-lock.yaml` in that order.
 * @param rootDir - The project root directory to search for lock files.
 * @returns Parsed lock file data from the first detected lock file, or `null` if none is found.
 */
export function loadLockFile(rootDir: string): LockFileData | null {
  const candidates: [string, (p: string) => LockFileData][] = [
    ["package-lock.json", parsePackageLock],
    ["yarn.lock", parseYarnLock],
    ["pnpm-lock.yaml", parsePnpmLock],
  ];

  for (const [filename, parser] of candidates) {
    const filePath = path.join(rootDir, filename);
    if (fs.existsSync(filePath)) return parser(filePath);
  }

  return null;
}
