/**
 * Tag applier strategy for ScalaTest / MUnit test files (`.scala`).
 *
 * ScalaTest has no clean class-level string tag: annotation tags need a purpose-generated
 * `@TagAnnotation` type, and `taggedAs(...)` is per-test. So this strategy writes a
 * mokosh-managed marker comment above the test class rather than a natively-filterable tag:
 *
 *   // mokosh:tags auth, smoke
 *   class LoginSpec extends AnyFunSuite {
 *
 * This keeps `propose_tags` → `apply_tags` → `list_tags` round-tripping for Scala. It is a
 * marker only — it does not make `testOnly -- -n auth` work. Native per-test `taggedAs`
 * injection is a possible future enhancement (see docs/adr-017-jvm-languages.md).
 */
import path from "node:path";
import type { TagApplierStrategy } from "./types";

const MARKER_RE = /^\/\/ mokosh:tags .*\n/m;
/** Column-anchored top-level declaration a Scala test suite is defined as. */
const DECL_RE =
  /^(?:sealed\s+|abstract\s+|final\s+|private\s+|implicit\s+|case\s+)*(?:class|object|trait)\s+\w+/m;
const TEST_DIR_RE = /\/src\/(test|it)\//;
const TEST_NAME_RE = /(Spec|Suite|Test|Props)\.scala$/;

/** Reads the tag names out of an existing marker line, or null when there is none. */
function readExistingTags(source: string): string[] | null {
  const match = MARKER_RE.exec(source);
  if (!match) return null;
  return match[0]
    .replace(/^\/\/ mokosh:tags /, "")
    .trim()
    .split(/\s*,\s*/)
    .filter(Boolean);
}

export class ScalaTestStrategy implements TagApplierStrategy {
  readonly name = "scalatest";

  canHandle(absPath: string): boolean {
    const normalized = absPath.replace(/\\/g, "/");
    if (path.extname(normalized).toLowerCase() !== ".scala") return false;
    return TEST_DIR_RE.test(normalized) || TEST_NAME_RE.test(normalized);
  }

  apply(_absPath: string, source: string, tags: string[]): string {
    const existing = readExistingTags(source);
    const sortedTags = [...tags].sort();

    if (existing !== null && JSON.stringify([...existing].sort()) === JSON.stringify(sortedTags)) {
      return source;
    }

    if (tags.length === 0) {
      return existing === null ? source : source.replace(MARKER_RE, "");
    }

    const marker = `// mokosh:tags ${sortedTags.join(", ")}\n`;

    if (existing !== null) return source.replace(MARKER_RE, marker);

    const decl = DECL_RE.exec(source);
    if (!decl) return source;
    return source.slice(0, decl.index) + marker + source.slice(decl.index);
  }
}
