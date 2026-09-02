/** Shared helpers for the hand-rolled JVM scanners (Kotlin, Scala, Groovy) — no AST library. */

import type { ImportEdge } from "../../types/node";
import type { NodeCategory } from "../../types/parse";

const TAG_LINE_RE = /\/\/\s*@tag\s+([a-zA-Z0-9_-]+)/g;

/** Import roots that mark a file as a test regardless of its path. */
const TEST_IMPORT_PREFIXES = [
  "org.junit",
  "androidx.test",
  "org.robolectric",
  "org.mockito",
  "org.scalatest",
  "munit",
  "spock.lang",
  "io.kotest",
  "org.spekframework",
];

/**
 * @description Scans raw source for `// @tag name` comment markers.
 * @param source - Full file source text.
 * @returns The set of tag names found.
 */
export function scanTagMarkers(source: string): Set<string> {
  const tags = new Set<string>();
  for (const match of source.matchAll(TAG_LINE_RE)) {
    if (match[1]) tags.add(match[1]);
  }
  return tags;
}

/**
 * @description Strips `//` line comments and C-style block comments from source so a line
 *   scanner never mistakes commented-out `import` lines for real ones. Newlines are preserved
 *   so downstream line handling is unaffected; string-literal awareness is deliberately skipped
 *   (same trade-off as the duplicate-detection tokenizer).
 * @param source - Full file source text.
 * @returns Source with comment spans blanked to spaces.
 */
export function stripJvmComments(source: string): string {
  let out = source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));
  out = out.replace(/\/\/[^\n]*/g, (line) => " ".repeat(line.length));
  return out;
}

/**
 * @description Builds an external `ImportEdge` for a JVM FQN specifier. All JVM imports are
 *   marked external at parse time; `JvmLangResolver` resolves them to local files later.
 * @param fromPath - Path of the importing file.
 * @param specifier - Fully-qualified name (e.g. `a.b.C` or `a.b.*`).
 * @returns The import edge.
 */
export function jvmImportEdge(fromPath: string, specifier: string): ImportEdge {
  return {
    fromPath,
    toPath: "",
    rawSpecifier: specifier,
    isExternal: true,
    isStyle: false,
    type: "static",
  };
}

/**
 * @description Builds the synthetic same-package edge (`<pkg>.*`, type `side-effect`) every
 *   JVM source file gets in addition to its explicit imports. JVM languages let a file
 *   reference any sibling type in its own package with no `import` line, so without this edge
 *   a file's real coupling to its package siblings is invisible to blast-radius analysis.
 *   `JvmLangResolver` expands it to every other file in the package (self excluded) — see
 *   docs/adr-017-jvm-languages.md.
 * @param fromPath - Path of the file that owns the package.
 * @param packageName - The file's own `package` declaration.
 * @returns The synthetic import edge.
 */
export function jvmPackageEdge(fromPath: string, packageName: string): ImportEdge {
  return {
    fromPath,
    toPath: "",
    rawSpecifier: `${packageName}.*`,
    isExternal: true,
    isStyle: false,
    type: "side-effect",
  };
}

/**
 * @description Extracts a JVM file's `package` declaration from its leading lines. Java,
 *   Kotlin, and Groovy have a single `package a.b.c` line; Scala allows consecutive
 *   `package a` / `package b` lines (and `package object c`) that compose into `a.b.c`.
 *   Comment and annotation lines before the declaration are skipped.
 * @param source - Full file source text.
 * @param isScala - When true, collects consecutive `package` lines instead of stopping at the first.
 * @returns The dotted package name, or `null` for the default (unnamed) package.
 */
export function extractJvmPackage(source: string, isScala: boolean): string | null {
  const parts: string[] = [];
  for (const raw of stripJvmComments(source).split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("@") || line.startsWith("*")) continue;
    const match = line.match(/^package\s+(?:object\s+)?([\w.]+)/);
    if (match?.[1]) {
      parts.push(match[1]);
      if (!isScala) break;
      continue;
    }
    if (isScala && /^import\s/.test(line)) continue;
    break;
  }
  return parts.length > 0 ? parts.join(".") : null;
}

/**
 * @description Shared category heuristic for JVM scanner languages: Gradle build scripts are
 *   `config`; files under a test source set or importing a known test framework are `test`;
 *   everything else is `logic`.
 * @param filePath - Path to the source file.
 * @param importSpecifiers - Raw FQN specifiers from the file's `import` lines.
 * @returns The resolved node category.
 */
export function classifyJvm(filePath: string, importSpecifiers: string[]): NodeCategory {
  const normalized = filePath.replace(/\\/g, "/");
  const base = normalized.split("/").pop() ?? "";

  if (base.endsWith(".gradle") || base === "build.gradle.kts" || base === "settings.gradle.kts") {
    return "config";
  }
  if (/\/src\/(test|androidTest|integrationTest|it)\//.test(normalized)) return "test";
  if (
    importSpecifiers.some((spec) =>
      TEST_IMPORT_PREFIXES.some((prefix) => spec === prefix || spec.startsWith(`${prefix}.`)),
    )
  ) {
    return "test";
  }
  return "logic";
}
