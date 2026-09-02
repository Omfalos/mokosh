/** Best-effort reader for sbt dependency-version metadata (`build.sbt`, `project/*.scala`). */

/**
 * @description Best-effort extraction of dependency versions from an sbt build definition
 * (`build.sbt` or `project/*.scala`). Matches literal coordinates in sbt's operator form —
 * `"group" %% "artifact" % "version"` and the plain `%` variant. `val`-indirected versions and
 * non-literal expressions are not resolved.
 * @param content - Raw text of the sbt build file.
 * @returns Map of Maven group id to version.
 */
export function parseSbtBuild(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /["']([\w.-]+)["']\s*%%?\s*["']([\w.-]+)["']\s*%\s*["']([\w.\-+]+)["']/g;
  for (let m = re.exec(content); m; m = re.exec(content)) {
    const [, group, , version] = m;
    if (group && version) out[group] = version;
  }
  return out;
}
