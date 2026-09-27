/** On-demand coverage runner for Gradle JVM projects via the JaCoCo plugin's XML report
 *  (`build/reports/jacoco/test/jacocoTestReport.xml`). Requires the project to already apply the
 *  `jacoco` plugin and a `jacocoTestReport` task — when it doesn't, the Gradle invocation fails
 *  and no report is produced, which this runner treats as "contributed nothing" like every other
 *  runner. */
import fs from "node:fs";
import path from "node:path";
import { runCommand } from "../exec-util";
import type { CoverageRunner, CoverageRunOptions } from "../types";
import { extractAttr, extractTags } from "../xml-attr";

const SOURCE_ROOTS = ["src/main/java", "src/main/kotlin", "src/main/scala", "src/main/groovy"];

const PACKAGE_BLOCK_RE = /<package name="([^"]*)">([\s\S]*?)<\/package>/g;
const SOURCEFILE_BLOCK_RE = /<sourcefile name="([^"]*)">([\s\S]*?)<\/sourcefile>/g;

/**
 * @description Parses a JaCoCo `jacocoTestReport.xml` into per-file line-coverage percentages,
 *   resolving each `package`/`sourcefile` pair to a real path under one of the conventional
 *   Gradle JVM source roots (tries `java`, `kotlin`, `scala`, `groovy` in that order).
 * @param xml - Raw JaCoCo XML report.
 * @param projectDir - Absolute directory the report belongs to, used to resolve which source root exists.
 * @returns Map of project-relative path (forward-slash separated) → line-coverage percentage.
 */
export function parseJacocoReport(xml: string, projectDir: string): Map<string, number> {
  const result = new Map<string, number>();
  for (const pkgMatch of xml.matchAll(PACKAGE_BLOCK_RE)) {
    const [, packageName, packageBody] = pkgMatch;
    if (packageName === undefined || packageBody === undefined) continue;
    for (const fileMatch of packageBody.matchAll(SOURCEFILE_BLOCK_RE)) {
      const [, fileName, fileBody] = fileMatch;
      if (fileName === undefined || fileBody === undefined) continue;
      const counterTag = /<counter[^>]*type="LINE"[^>]*\/?>/.exec(fileBody)?.[0];
      if (!counterTag) continue;
      const missed = Number(extractAttr(counterTag, "missed") ?? "NaN");
      const covered = Number(extractAttr(counterTag, "covered") ?? "NaN");
      if (!Number.isFinite(missed) || !Number.isFinite(covered)) continue;
      const total = missed + covered;
      if (total === 0) continue;

      const relPath = SOURCE_ROOTS.map((root) =>
        path.join(root, packageName, fileName).split(path.sep).join("/"),
      ).find((candidate) => fs.existsSync(path.join(projectDir, candidate)));
      if (!relPath) continue;

      result.set(relPath, (covered / total) * 100);
    }
  }
  return result;
}

function reportPath(dir: string): string {
  return path.join(dir, "build", "reports", "jacoco", "test", "jacocoTestReport.xml");
}

export const gradleCoverageRunner: CoverageRunner = {
  name: "gradle",

  detect(dir: string): boolean {
    return (
      fs.existsSync(path.join(dir, "build.gradle")) ||
      fs.existsSync(path.join(dir, "build.gradle.kts"))
    );
  },

  async run(dir: string, opts: CoverageRunOptions): Promise<Map<string, number> | null> {
    try {
      const hasWrapper = fs.existsSync(path.join(dir, "gradlew"));
      const result = await runCommand(
        hasWrapper ? "./gradlew" : "gradle",
        ["test", "jacocoTestReport", "--console=plain"],
        dir,
        opts.timeoutMs,
      );
      if (result.timedOut) return null;

      const xmlPath = reportPath(dir);
      if (!fs.existsSync(xmlPath)) return null;
      const map = parseJacocoReport(fs.readFileSync(xmlPath, "utf-8"), dir);
      return map.size > 0 ? map : null;
    } catch {
      return null;
    }
  },
};
