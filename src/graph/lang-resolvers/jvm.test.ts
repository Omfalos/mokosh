import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { JvmLangResolver } from "./jvm";

const noop = () => null;

/**
 * Writes each `{ relPath: packageName }` entry as a source file containing a matching
 * `package` declaration — the resolver indexes files by that declaration, not by directory.
 */
function setup(files: Record<string, string | null>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-jvm-resolver-"));
  for (const [rel, pkg] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, pkg ? `package ${pkg}\n` : "// no package\n");
  }
  return root;
}

describe("JvmLangResolver", { tags: ["JvmLangResolver", "jvm"] }, () => {
  let root: string;
  let resolver: JvmLangResolver;

  beforeAll(() => {
    root = setup({
      "app/src/main/java/com/x/util/Helper.java": "com.x.util",
      "app/src/main/kotlin/com/x/data/Repositories.kt": "com.x.data",
      "app/src/main/kotlin/com/x/data/User.kt": "com.x.data",
      "app/src/main/kotlin/com/x/Outer.kt": "com.x",
      "core/src/main/scala/com/x/core/Thing.scala": "com.x.core",
      // Kotlin-Multiplatform-style flat layout: no src/<set>/<lang>/ dir, dotted package.
      "kmp/common/src/CoroutineScope.kt": "com.x.kmp",
    });
    resolver = new JvmLangResolver();
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  const rel = (results: { path: string }[] | null) =>
    results?.map((r) => path.relative(root, r.path).replace(/\\/g, "/")).sort() ?? null;

  test("FQN resolves to a same-named source file", () => {
    expect(rel(resolver.resolve("", "com.x.util.Helper", root, noop))).toEqual([
      "app/src/main/java/com/x/util/Helper.java",
    ]);
  });

  test("resolution is by package declaration, not directory — cross-module works", () => {
    expect(rel(resolver.resolve("", "com.x.core.Thing", root, noop))).toEqual([
      "core/src/main/scala/com/x/core/Thing.scala",
    ]);
  });

  test("flat / KMP layout (file under src/ with a dotted package) resolves", () => {
    expect(rel(resolver.resolve("", "com.x.kmp.CoroutineScope", root, noop))).toEqual([
      "kmp/common/src/CoroutineScope.kt",
    ]);
  });

  test("wildcard import expands to every file in the package", () => {
    expect(rel(resolver.resolve("", "com.x.data.*", root, noop))).toEqual([
      "app/src/main/kotlin/com/x/data/Repositories.kt",
      "app/src/main/kotlin/com/x/data/User.kt",
    ]);
  });

  test("nested type falls back to the enclosing file", () => {
    expect(rel(resolver.resolve("", "com.x.Outer.Inner", root, noop))).toEqual([
      "app/src/main/kotlin/com/x/Outer.kt",
    ]);
  });

  test("type declared in a differently-named file resolves to the whole package", () => {
    // `Session` is not a filename; it lives in Repositories.kt with other top-level types.
    expect(rel(resolver.resolve("", "com.x.data.Session", root, noop))).toEqual([
      "app/src/main/kotlin/com/x/data/Repositories.kt",
      "app/src/main/kotlin/com/x/data/User.kt",
    ]);
  });

  test("unresolvable (third-party) import returns null", () => {
    expect(resolver.resolve("", "org.thirdparty.Lib", root, noop)).toBeNull();
  });

  test("self-edges are left in — the graph builder drops them", () => {
    // The synthetic `com.x.data.*` edge from Repositories.kt resolves to both package files;
    // excluding the importer is the builder's job (the resolver's result is dir-cached).
    expect(rel(resolver.resolve("", "com.x.data.*", root, noop))).toContain(
      "app/src/main/kotlin/com/x/data/Repositories.kt",
    );
  });

  test("a repo with no packaged JVM files returns null", () => {
    const bare = setup({ "README.md": null, "src/Loose.java": null });
    try {
      expect(new JvmLangResolver().resolve("", "com.x.Y", bare, noop)).toBeNull();
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});
