/** Dependency-free glob matcher used to select a fallback framework by file path. */

/**
 * @description Tests whether a project-relative path matches a glob pattern. Supports `**`
 *   (any characters, including `/`), `*` (any characters except `/`), and `?` (a single
 *   non-`/` character). Both `pattern` and `relPath` are normalized to `/`-separated form
 *   before matching, so callers on Windows don't need to pre-normalize.
 * @param {string} pattern - Glob pattern, e.g. `"tests/e2e/**"`.
 * @param {string} relPath - Project-relative file path to test against the pattern.
 * @returns {boolean} True when `relPath` matches `pattern`.
 */
export function matchesGlob(pattern: string, relPath: string): boolean {
  const normalizedPattern = pattern.replace(/\\/g, "/");
  const normalizedPath = relPath.replace(/\\/g, "/");

  let regexSource = "";
  for (let i = 0; i < normalizedPattern.length; i++) {
    const char = normalizedPattern[i];
    if (char === "*") {
      if (normalizedPattern[i + 1] === "*") {
        regexSource += ".*";
        i++;
      } else {
        regexSource += "[^/]*";
      }
    } else if (char === "?") {
      regexSource += "[^/]";
    } else if (char !== undefined) {
      regexSource += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }

  return new RegExp(`^${regexSource}$`).test(normalizedPath);
}
