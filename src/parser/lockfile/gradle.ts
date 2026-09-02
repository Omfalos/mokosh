/** Best-effort readers for Gradle dependency-version metadata: version catalog, dependency
 * lockfile, and build-script literals. Each returns a map of Maven group id → version. */

/**
 * @description Strips a single layer of matching single/double quotes from a trimmed string.
 * @param value - The raw string, possibly quoted.
 * @returns The unquoted string, or the input unchanged when it is not quoted.
 */
function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    (trimmed[0] === '"' || trimmed[0] === "'") &&
    trimmed[trimmed.length - 1] === trimmed[0]
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * @description Parses one `[libraries]` entry from a Gradle version catalog into its group id and
 * version. Handles the shorthand string form (`"group:artifact:version"`) and the inline-table
 * form with `module`/`group` plus `version` or `version.ref`.
 * @param value - The right-hand side of a `key = <value>` line inside the `[libraries]` table.
 * @returns The `group` id and either a literal `version` or a `versionRef` naming a `[versions]`
 *   key, or `null` when no group can be determined.
 */
function parseCatalogLibrary(
  value: string,
): { group: string; version?: string; versionRef?: string } | null {
  const trimmed = value.trim();

  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const parts = stripQuotes(trimmed).split(":");
    if (parts.length >= 3 && parts[0] && parts[2]) return { group: parts[0], version: parts[2] };
    return null;
  }

  if (!trimmed.startsWith("{")) return null;

  const moduleMatch = trimmed.match(/module\s*=\s*["']([^"']+)["']/);
  const groupMatch = trimmed.match(/group\s*=\s*["']([^"']+)["']/);
  const group = moduleMatch ? (moduleMatch[1] as string).split(":")[0] : groupMatch?.[1];
  if (!group) return null;

  const versionRefMatch =
    trimmed.match(/version\.ref\s*=\s*["']([^"']+)["']/) ??
    trimmed.match(/version\s*=\s*\{\s*ref\s*=\s*["']([^"']+)["']/);
  const versionMatch = trimmed.match(/version\s*=\s*["']([^"']+)["']/);

  return {
    group,
    ...(versionMatch?.[1] !== undefined && { version: versionMatch[1] }),
    ...(versionRefMatch?.[1] !== undefined && { versionRef: versionRefMatch[1] }),
  };
}

/**
 * @description Parses a Gradle version catalog (`gradle/libs.versions.toml`) — the modern default
 * for declaring dependency versions. Reads the `[versions]` and `[libraries]` tables only;
 * `version.ref` aliases are resolved against `[versions]`.
 * @param content - Raw text of the `libs.versions.toml` file.
 * @returns Map of Maven group id to resolved version. When several artifacts in one group
 *   declare different versions, the last one wins (best-effort).
 */
export function parseGradleVersionCatalog(content: string): Record<string, string> {
  const lines = content.split(/\r?\n/).map((line) => line.replace(/#.*$/, "").trim());

  const versions: Record<string, string> = {};
  let section = "";
  for (const line of lines) {
    const sectionMatch = line.match(/^\[([\w.-]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1] as string;
      continue;
    }
    if (section !== "versions" || !line) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const version = stripQuotes(line.slice(eq + 1));
    if (key && version) versions[key] = version;
  }

  const groups: Record<string, string> = {};
  section = "";
  for (const line of lines) {
    const sectionMatch = line.match(/^\[([\w.-]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1] as string;
      continue;
    }
    if (section !== "libraries" || !line) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const lib = parseCatalogLibrary(line.slice(eq + 1));
    if (!lib) continue;
    const version = lib.versionRef ? versions[lib.versionRef] : lib.version;
    if (version) groups[lib.group] = version;
  }

  return groups;
}

/**
 * @description Parses a `gradle.lockfile` (Gradle dependency locking) — lines of the form
 * `group:artifact:version=config1,config2`, plus a trailing `empty=<configs>` line.
 * @param content - Raw text of the `gradle.lockfile`.
 * @returns Map of Maven group id to exact resolved version.
 */
export function parseGradleLockfile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("empty=")) continue;
    const coord = line.split("=")[0] as string;
    const parts = coord.split(":");
    if (parts.length >= 3 && parts[0] && parts[2]) out[parts[0]] = parts[2];
  }
  return out;
}

/**
 * @description Best-effort extraction of dependency versions from a `build.gradle` /
 * `build.gradle.kts` script. Matches string-literal coordinates (`"group:artifact:version"`) and
 * the map form (`group: '…', name: '…', version: '…'`); no expression evaluation, so `ext` /
 * variable / `buildSrc`-indirected versions are not resolved.
 * @param content - Raw text of the build script.
 * @returns Map of Maven group id to version.
 */
export function parseGradleBuildScript(content: string): Record<string, string> {
  const out: Record<string, string> = {};

  const coordRe = /["']([\w.-]+):([\w.-]+):([\w.\-+]+)["']/g;
  for (let m = coordRe.exec(content); m; m = coordRe.exec(content)) {
    const [, group, , version] = m;
    if (group && version && /\d/.test(version)) out[group] = version;
  }

  const mapRe = /group:\s*["']([\w.-]+)["'][^\n)]*?version:\s*["']([\w.\-+]+)["']/g;
  for (let m = mapRe.exec(content); m; m = mapRe.exec(content)) {
    if (m[1] && m[2] && /\d/.test(m[2])) out[m[1]] = m[2];
  }

  return out;
}
