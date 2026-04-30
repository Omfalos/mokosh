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
 * Parses a `package-lock.json` file.
 * Supports v1, v2, and v3 lockfile formats.
 *
 * @param filePath - The full path to the `package-lock.json` file.
 * @returns The parsed lock file data.
 */
export function parsePackageLock(filePath: string): LockFileData {
  const content = fs.readFileSync(filePath, "utf-8");
  const lock = JSON.parse(content) as PackageLock;
  const result: LockFileData = { dependencies: {} };

  // v3 lockfile
  if (lock.packages) {
    for (const [pkgPath, pkgData] of Object.entries(lock.packages)) {
      if (pkgPath === "" || !pkgPath.startsWith("node_modules/")) continue;
      const name = pkgPath.replace("node_modules/", "");
      // In case of nested node_modules (e.g. node_modules/a/node_modules/b)
      // we might want to handle this better, but for now let's take the simplest approach
      if (name.includes("node_modules/")) continue;

      result.dependencies[name] = {
        version: pkgData.version,
        ...(pkgData.dependencies !== undefined && { dependencies: pkgData.dependencies }),
      };
    }
  }
  // v1/v2 lockfile
  else if (lock.dependencies) {
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
 * Parses a `yarn.lock` file.
 * Supports both Yarn v1 (classic) and Yarn v2/v3 (Berry) YAML formats.
 *
 * @param filePath - The full path to the `yarn.lock` file.
 * @returns The parsed lock file data.
 */
export function parseYarnLock(filePath: string): LockFileData {
  const content = fs.readFileSync(filePath, "utf-8");
  const result: LockFileData = { dependencies: {} };

  // Yarn v1 (classic) lockfile is a custom format.
  // Yarn v2/v3 (berry) lockfile is YAML.

  if (content.includes("__metadata:")) {
    // Looks like Yarn Berry (YAML)
    try {
      const lock = yaml.load(content) as Record<string, PkgData>;
      for (const [key, value] of Object.entries(lock)) {
        if (key === "__metadata") continue;

        // Key is usually "pkg@descriptor, pkg@descriptor"
        const parts = key.split(", ");
        for (const part of parts) {
          let name = part;
          if (part.includes("@")) {
            const lastAtIndex = part.lastIndexOf("@");
            if (lastAtIndex > 0) {
              name = part.substring(0, lastAtIndex);
            }
          }
          if (name && value?.version) {
            result.dependencies[name] = {
              version: value.version,
              ...(value.dependencies !== undefined && { dependencies: value.dependencies }),
            };
          }
        }
      }
      return result;
    } catch (_e) {
      // Fallback to classic parser if YAML fails
    }
  }

  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#") || line.startsWith("  ")) continue;

    if (!rawLine.startsWith(" ")) {
      // Package name line: "pkg@version": or @scope/pkg@version:
      const parts = line.split(",");
      const packageNamesFoundInThisLine: string[] = [];
      for (let part of parts) {
        part = part.trim();
        if (part.endsWith(":")) part = part.slice(0, -1);
        if (part.startsWith('"')) part = part.slice(1);
        if (part.endsWith('"')) part = part.slice(0, -1);

        let name = part;
        if (part.includes("@")) {
          const lastAtIndex = part.lastIndexOf("@");
          // Handle @scope/pkg@version
          if (lastAtIndex > 0) {
            name = part.substring(0, lastAtIndex);
          }
        }

        if (name) {
          packageNamesFoundInThisLine.push(name);
          if (!result.dependencies[name]) {
            result.dependencies[name] = { version: "" };
          }
        }
      }
      if (packageNamesFoundInThisLine.length > 0) {
        for (const pkg of packageNamesFoundInThisLine) {
          // Look ahead for version
          for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
            const nextLine = lines[j]?.trim();
            if (nextLine?.startsWith('version "')) {
              const vMatch = nextLine.match(/version "(.*?)"/);
              if (vMatch) {
                const dep = result.dependencies[pkg];
                if (dep) dep.version = vMatch[1] ?? "";
              }
              break;
            }
            if (nextLine && nextLine.length > 0 && !lines[j]?.startsWith(" ")) break;
          }
        }
      }
    }
  }

  return result;
}

/**
 * Parses a `pnpm-lock.yaml` file.
 * Extracts dependency names and versions from pnpm's specific YAML structure.
 *
 * @param filePath - The full path to the `pnpm-lock.yaml` file.
 * @returns The parsed lock file data.
 */
export function parsePnpmLock(filePath: string): LockFileData {
  const content = fs.readFileSync(filePath, "utf-8");
  const result: LockFileData = { dependencies: {} };

  try {
    const lock = yaml.load(content) as {
      packages?: Record<string, PkgData>;
      dependencies?: Record<string, string | PkgData>;
    };
    // pnpm-lock.yaml v6+ has 'importers' or 'packages'
    // Simplified extraction:
    if (lock.packages) {
      for (const [id, pkgData] of Object.entries(lock.packages)) {
        // id is usually "/pkg@version" or "/@scope/pkg@version" or "pkg@version"
        let name = id;
        let version = pkgData.version;

        // Try to extract name from id if version is not explicit
        if (id.startsWith("/")) {
          const lastAtIndex = id.lastIndexOf("@");
          if (lastAtIndex > 0) {
            name = id.substring(1, lastAtIndex);
            if (!version) version = id.substring(lastAtIndex + 1);
          } else {
            name = id.substring(1);
          }
        } else {
          const lastAtIndex = id.lastIndexOf("@");
          if (lastAtIndex > 0) {
            name = id.substring(0, lastAtIndex);
            if (!version) version = id.substring(lastAtIndex + 1);
          }
        }

        if (name) {
          result.dependencies[name] = {
            version: version || "",
            ...(pkgData.dependencies !== undefined && { dependencies: pkgData.dependencies }),
          };
        }
      }
    }

    // Also check 'dependencies' in lockfile root (for v5 or simpler formats)
    if (lock.dependencies) {
      for (const [name, versionData] of Object.entries(lock.dependencies)) {
        const version = typeof versionData === "string" ? versionData : versionData.version;
        if (!result.dependencies[name]) {
          result.dependencies[name] = { version: version || "" };
        }
      }
    }
  } catch (_e) {
    // Ignore YAML errors
  }

  return result;
}

/**
 * Automatically detects and loads the appropriate lock file in the root directory.
 * Searches for `package-lock.json`, `yarn.lock`, and `pnpm-lock.yaml` in that order.
 *
 * @param rootDir - The project root directory.
 * @returns The parsed lock file data, or null if no supported lock file is found.
 */
export function loadLockFile(rootDir: string): LockFileData | null {
  const packageLockPath = path.join(rootDir, "package-lock.json");
  if (fs.existsSync(packageLockPath)) {
    return parsePackageLock(packageLockPath);
  }

  const yarnLockPath = path.join(rootDir, "yarn.lock");
  if (fs.existsSync(yarnLockPath)) {
    return parseYarnLock(yarnLockPath);
  }

  const pnpmLockPath = path.join(rootDir, "pnpm-lock.yaml");
  if (fs.existsSync(pnpmLockPath)) {
    return parsePnpmLock(pnpmLockPath);
  }

  return null;
}
