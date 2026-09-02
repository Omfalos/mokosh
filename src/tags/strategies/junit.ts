/**
 * Tag applier strategy for JVM test files that run on the JUnit Platform — JUnit 5 (`.java`)
 * and Spock 2 (`.groovy`). Writes a mokosh-managed block of `@Tag("...")` annotations
 * (`org.junit.jupiter.api.Tag`, which is `@Repeatable`) immediately above the top-level test
 * class, delimited by a `// mokosh:tags` sentinel comment so the block can be re-read, replaced,
 * or removed on later runs.
 *
 * Example output (inserted before the class declaration):
 *   // mokosh:tags
 *   @Tag("auth")
 *   @Tag("smoke")
 *   public class LoginTest {
 *
 * The managed `import org.junit.jupiter.api.Tag;` line is added after the last import when a
 * block is written, and removed again only when no `@Tag` reference remains in the file.
 *
 * Filter at CI time with Gradle:
 *   test { useJUnitPlatform { includeTags "auth" } }
 * or Maven Surefire `-Dgroups=auth`.
 */
import path from "node:path";
import type { TagApplierStrategy } from "./types";

const SENTINEL = "// mokosh:tags";
/** The managed block: the sentinel line plus every immediately-following `@Tag("…")` line. */
const BLOCK_RE = /^\/\/ mokosh:tags\n(?:[ \t]*@Tag\("[^"]*"\)\n)*/m;
const TAG_IMPORT_LINE = "import org.junit.jupiter.api.Tag;";
const TAG_IMPORT_RE = /^import org\.junit\.jupiter\.api\.Tag;\n/m;
/** Column-anchored top-level type declaration (`public final class Foo`, `class Foo`, …). */
const TYPE_DECL_RE =
  /^(?:public\s+|final\s+|abstract\s+|sealed\s+|non-sealed\s+|strictfp\s+)*(?:class|interface|enum|record|@interface)\s+\w+/m;
const LAST_IMPORT_RE = /^import\s+[^\n]+;\n(?![\s\S]*^import\s)/m;
const PACKAGE_RE = /^package\s+[^\n]+;\n/m;
const TEST_DIR_RE = /\/src\/(test|androidTest|integrationTest|it)\//;
const TEST_NAME_RE = /(Test|Tests|Spec|IT)\.(java|groovy)$/;

/** Reads the tag names out of an existing managed block, or null when there is none. */
function readExistingTags(source: string): string[] | null {
  const match = BLOCK_RE.exec(source);
  if (!match) return null;
  const names: string[] = [];
  const re = /@Tag\("([^"]*)"\)/g;
  let m = re.exec(match[0]);
  while (m !== null) {
    if (m[1]) names.push(m[1]);
    m = re.exec(match[0]);
  }
  return names;
}

/** Builds the managed block text (sentinel + one `@Tag` line per tag), newline-terminated. */
function buildBlock(tags: string[]): string {
  return `${SENTINEL}\n${tags.map((tag) => `@Tag("${tag}")`).join("\n")}\n`;
}

/** Inserts the managed `Tag` import after the last import, else after `package`, else at top. */
function ensureImport(source: string): string {
  if (TAG_IMPORT_RE.test(source)) return source;
  const lastImport = LAST_IMPORT_RE.exec(source);
  if (lastImport) {
    const at = lastImport.index + lastImport[0].length;
    return source.slice(0, at) + TAG_IMPORT_LINE + "\n" + source.slice(at);
  }
  const pkg = PACKAGE_RE.exec(source);
  if (pkg) {
    const at = pkg.index + pkg[0].length;
    return source.slice(0, at) + "\n" + TAG_IMPORT_LINE + "\n" + source.slice(at);
  }
  return TAG_IMPORT_LINE + "\n" + source;
}

/** Drops the managed import only when nothing else in the file still references `@Tag`. */
function dropImportIfUnused(source: string): string {
  return /@Tag\b/.test(source) ? source : source.replace(TAG_IMPORT_RE, "");
}

export class JUnitStrategy implements TagApplierStrategy {
  readonly name = "junit";

  canHandle(absPath: string): boolean {
    const normalized = absPath.replace(/\\/g, "/");
    const ext = path.extname(normalized).toLowerCase();
    if (ext !== ".java" && ext !== ".groovy") return false;
    return TEST_DIR_RE.test(normalized) || TEST_NAME_RE.test(normalized);
  }

  apply(_absPath: string, source: string, tags: string[]): string {
    const existing = readExistingTags(source);
    const sortedTags = [...tags].sort();

    if (existing !== null && JSON.stringify([...existing].sort()) === JSON.stringify(sortedTags)) {
      return source;
    }

    if (tags.length === 0) {
      if (existing === null) return source;
      return dropImportIfUnused(source.replace(BLOCK_RE, ""));
    }

    const block = buildBlock(sortedTags);

    if (existing !== null) {
      return ensureImport(source.replace(BLOCK_RE, block));
    }

    const decl = TYPE_DECL_RE.exec(source);
    if (!decl) return source;

    const withBlock = source.slice(0, decl.index) + block + source.slice(decl.index);
    return ensureImport(withBlock);
  }
}
