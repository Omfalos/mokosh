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
  "org.testng",
  "org.assertj",
  "com.google.truth",
  "org.hamcrest",
  "io.mockk",
  "com.nhaarman.mockitokotlin2",
];

/**
 * Conventional Gradle/Maven/sbt source-root names that hold test code, as they appear in the
 * `.../src/<root>/...` path segment. Shared between {@link classifyJvm} (path-based test
 * classification) and the resolver's source-root partitioning so the list is defined once.
 */
export const TEST_SOURCE_ROOTS = ["test", "androidTest", "integrationTest", "it"] as const;

/** A JVM module source root, derived from the `src/<root>/` path segment. */
export type SourceRoot = "main" | (typeof TEST_SOURCE_ROOTS)[number] | "unknown";

const TEST_SOURCE_ROOT_RE = new RegExp(`/src/(${TEST_SOURCE_ROOTS.join("|")})/`);

/** Filename stems that weakly suggest a test file when no stronger signal classified it. */
const TEST_NAME_SUFFIX_RE = /(?:Test|Tests|Spec|IT|ITCase)$/;

/**
 * @description Whether a file's base name follows a conventional JVM test-class naming pattern
 *   (`FooTest`, `BarSpec`, `BazIT`, …). A weak signal — used as a last-resort classification
 *   fallback and as defence-in-depth in the resolver for repos with unconventional layouts.
 * @param fileName - File name or base name, with or without extension.
 * @returns True when the stem ends in a recognised test suffix.
 */
export function looksLikeJvmTestName(fileName: string): boolean {
  const stem = fileName.replace(/\.\w+$/, "");
  return TEST_NAME_SUFFIX_RE.test(stem);
}

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
 * @description Best-effort scan of a JVM source file for the signals {@link classifyJvm} needs:
 *   annotation names applied anywhere in the file (`@Service`, `@Composable`, …) and the bare
 *   names of declared types (`class` / `object` / `interface` / `trait` / `enum X`). Comments are
 *   stripped first so commented-out code doesn't leak in. Deliberately conservative and
 *   syntax-agnostic — a shared substitute for the AST the hand-rolled scanners don't have.
 * @param source - Full file source text.
 * @returns Hints suitable to pass straight to {@link classifyJvm}; both arrays are always present.
 */
export function scanJvmClassifyHints(source: string): Required<JvmClassifyHints> {
  const clean = stripJvmComments(source);
  const annotations = new Set<string>();
  for (const match of clean.matchAll(/@([A-Z]\w*)/g)) {
    if (match[1]) annotations.add(match[1]);
  }
  const typeNames = new Set<string>();
  for (const match of clean.matchAll(/\b(?:class|object|interface|trait|enum)\s+([A-Za-z_]\w*)/g)) {
    if (match[1]) typeNames.add(match[1]);
  }
  return { annotations: [...annotations], typeNames: [...typeNames] };
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
    isSamePackage: true,
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

/** Framework annotations that mark a file as `config` (Spring Java config, etc.). */
const CONFIG_ANNOTATIONS = new Set([
  "Configuration",
  "SpringBootApplication",
  "EnableAutoConfiguration",
]);

/** Framework annotations that mark a file as a UI component (Jetpack Compose). */
const UI_ANNOTATIONS = new Set(["Composable", "Preview"]);

/** Framework annotations that mark a file as business `logic` (Spring / JPA stereotypes). */
const LOGIC_ANNOTATIONS = new Set([
  "RestController",
  "Controller",
  "Service",
  "Repository",
  "Component",
  "Entity",
  "MappedSuperclass",
  "Embeddable",
]);

/** Type-name suffixes that mark a file as a UI class (Android). */
const UI_NAME_SUFFIXES = ["Activity", "Fragment", "ViewModel", "Screen", "Composable"];

/** Extra signals for {@link classifyJvm}, collected by each parser from the file's declarations. */
export interface JvmClassifyHints {
  /** Bare top-level type names declared in the file. */
  typeNames?: string[];
  /** Bare annotation names applied to top-level declarations (without the leading `@`). */
  annotations?: string[];
}

/**
 * @description Shared category heuristic for every JVM language: Gradle build scripts are
 *   `config`; files under a test source set or importing a known test framework are `test`
 *   (these always win); otherwise framework annotations and Android naming conventions refine
 *   `ui` / `config` / `logic`; everything else is `logic`.
 * @param filePath - Path to the source file.
 * @param importSpecifiers - Raw FQN specifiers from the file's `import` lines.
 * @param hints - Optional declaration signals (top-level type names, applied annotations) used
 *   for annotation- and name-driven `ui` / `config` refinement.
 * @returns The resolved node category.
 */
export function classifyJvm(
  filePath: string,
  importSpecifiers: string[],
  hints: JvmClassifyHints = {},
): NodeCategory {
  const normalized = filePath.replace(/\\/g, "/");
  const base = normalized.split("/").pop() ?? "";

  if (base.endsWith(".gradle") || base === "build.gradle.kts" || base === "settings.gradle.kts") {
    return "config";
  }
  if (TEST_SOURCE_ROOT_RE.test(normalized)) return "test";
  if (
    importSpecifiers.some((spec) =>
      TEST_IMPORT_PREFIXES.some((prefix) => spec === prefix || spec.startsWith(`${prefix}.`)),
    )
  ) {
    return "test";
  }

  const annotations = hints.annotations ?? [];
  if (annotations.some((a) => CONFIG_ANNOTATIONS.has(a))) return "config";
  if (annotations.some((a) => UI_ANNOTATIONS.has(a))) return "ui";
  if ((hints.typeNames ?? []).some((n) => UI_NAME_SUFFIXES.some((s) => n.endsWith(s)))) return "ui";
  if (annotations.some((a) => LOGIC_ANNOTATIONS.has(a))) return "logic";

  // Weakest signal, checked last: a `FooTest` / `BarSpec` / `BazIT` file name outside a
  // recognised test root and with no test-framework import (unconventional layouts, TestNG
  // projects that also skipped the import list).
  if (looksLikeJvmTestName(base)) return "test";

  return "logic";
}
