/**
 * Tag applier strategy for JVM test files that run on the JUnit Platform — JUnit 5 (`.java`,
 * `.kt`) and Spock 2 (`.groovy`). Writes a mokosh-managed block of `@Tag("...")` annotations
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
 * Kotlin files use the same import statement without the trailing `;` (optional in Kotlin, but
 * mokosh writes idiomatic Kotlin) and a modifier/declaration grammar with no `public`/`final`
 * requirement and no `record`/`@interface`/`non-sealed`/`strictfp` (Java-only).
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
const TEST_DIR_RE = /\/src\/(test|androidTest|integrationTest|it)\//;
const TEST_NAME_RE = /(Test|Tests|Spec|IT)\.(java|groovy|kt)$/;

/** Per-language regex/text set, resolved once per `apply()` call rather than re-derived at
 *  every call site — keeps the two import-management functions from being able to disagree
 *  about which line is "the managed Tag import" for a given file. */
interface LangConfig {
  importLine: string;
  /** Trailing `;` optional in both: Java requires it but this only *recognizes* an existing
   *  import, and Kotlin allows (if never emits) one. */
  importRe: RegExp;
  /** Column-anchored top-level type declaration. */
  typeDeclRe: RegExp;
  lastImportRe: RegExp;
  packageRe: RegExp;
}

/** `public final class Foo`, `enum Foo`, `class Foo`, … */
const JAVA_CONFIG: LangConfig = {
  importLine: "import org.junit.jupiter.api.Tag;",
  importRe: /^import org\.junit\.jupiter\.api\.Tag;?\n/m,
  typeDeclRe:
    /^(?:public\s+|final\s+|abstract\s+|sealed\s+|non-sealed\s+|strictfp\s+)*(?:class|interface|enum|record|@interface)\s+\w+/m,
  lastImportRe: /^import\s+[^\n]+;\n(?![\s\S]*^import\s)/m,
  packageRe: /^package\s+[^\n]+;\n/m,
};

/** No trailing `;` on write (idiomatic Kotlin), `enum class Foo` instead of bare `enum Foo`, and
 *  no `public`/`final`/`record`/`@interface`/`non-sealed`/`strictfp` (Java-only). Stops before
 *  `:` supertypes or `(` constructor params. */
const KOTLIN_CONFIG: LangConfig = {
  importLine: "import org.junit.jupiter.api.Tag",
  importRe: /^import org\.junit\.jupiter\.api\.Tag;?\n/m,
  typeDeclRe:
    /^(?:public\s+|private\s+|protected\s+|internal\s+|open\s+|abstract\s+|final\s+|sealed\s+|data\s+|inner\s+|value\s+|annotation\s+)*(?:enum\s+)?(?:class|interface|object)\s+\w+/m,
  lastImportRe: /^import\s+[^\n]+\n(?![\s\S]*^import\s)/m,
  packageRe: /^package\s+[^\n]+\n/m,
};

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
function ensureImport(source: string, lang: LangConfig): string {
  if (lang.importRe.test(source)) return source;
  const lastImport = lang.lastImportRe.exec(source);
  if (lastImport) {
    const at = lastImport.index + lastImport[0].length;
    return source.slice(0, at) + lang.importLine + "\n" + source.slice(at);
  }
  const pkg = lang.packageRe.exec(source);
  if (pkg) {
    const at = pkg.index + pkg[0].length;
    return source.slice(0, at) + "\n" + lang.importLine + "\n" + source.slice(at);
  }
  return lang.importLine + "\n" + source;
}

/** Drops the managed import only when nothing else in the file still references `@Tag`. */
function dropImportIfUnused(source: string, lang: LangConfig): string {
  return /@Tag\b/.test(source) ? source : source.replace(lang.importRe, "");
}

export class JUnitStrategy implements TagApplierStrategy {
  readonly name = "junit";

  canHandle(absPath: string): boolean {
    const normalized = absPath.replace(/\\/g, "/");
    const ext = path.extname(normalized).toLowerCase();
    if (ext !== ".java" && ext !== ".groovy" && ext !== ".kt") return false;
    return TEST_DIR_RE.test(normalized) || TEST_NAME_RE.test(normalized);
  }

  apply(absPath: string, source: string, tags: string[]): string {
    const lang =
      path.extname(absPath.replace(/\\/g, "/")).toLowerCase() === ".kt"
        ? KOTLIN_CONFIG
        : JAVA_CONFIG;
    const existing = readExistingTags(source);
    const sortedTags = [...tags].sort();

    if (existing !== null && JSON.stringify([...existing].sort()) === JSON.stringify(sortedTags)) {
      return source;
    }

    if (tags.length === 0) {
      if (existing === null) return source;
      return dropImportIfUnused(source.replace(BLOCK_RE, ""), lang);
    }

    const block = buildBlock(sortedTags);

    if (existing !== null) {
      return ensureImport(source.replace(BLOCK_RE, block), lang);
    }

    const decl = lang.typeDeclRe.exec(source);
    if (!decl) return source;

    const withBlock = source.slice(0, decl.index) + block + source.slice(decl.index);
    return ensureImport(withBlock, lang);
  }
}
