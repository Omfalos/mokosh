/** Language resolver for JVM languages (Java, Kotlin, Scala, Groovy): maps fully-qualified type names to concrete source files using a project-wide index of every file's `package` declaration, so resolution is independent of the on-disk directory layout. */

import fs from "node:fs";
import path from "node:path";
import { DEFAULT_IGNORE_DIRS } from "../../const";
import {
  extractJvmPackage,
  looksLikeJvmTestName,
  type SourceRoot,
  TEST_SOURCE_ROOTS,
} from "../../parser/lang/jvm-scan";
import type { LangResolver, ResolvedImport } from "./types";

/** Source-file extensions the index covers. `.gradle` is excluded — Groovy build scripts rarely declare a package and are not import targets. */
const JVM_SOURCE_EXTENSIONS = new Set([".java", ".kt", ".kts", ".scala", ".sc", ".groovy"]);

/** How deep to walk from the root when building the package index. */
const MAX_SCAN_DEPTH = 12;

/** Bytes read from the head of each file to find its `package` line. */
const PACKAGE_SCAN_BYTES = 4096;

/**
 * One `(module, source-root)` slice of a package: the files declaring package `P` that also live
 * in the same Gradle/sbt module and the same `src/<root>/` source set. The synthetic
 * same-package edge only ever resolves within a single slice; explicit FQN imports search across
 * all slices of a package.
 */
interface PackagePartition {
  /** Absolute path of the enclosing module — everything before `/src/`, or the file's directory when there is no `src/` layout. */
  module: string;
  /** Literal `src/<segment>` name (`main`, `test`, `foo`, …), or `""` when there is no `src/` layout. Discriminates slices within one module. */
  rootSegment: string;
  /** Normalised source-root kind, used for the test/main defence-in-depth check. */
  sourceRoot: SourceRoot;
  /** Absolute paths of the source files in this slice, sorted. */
  files: string[];
}

/** Maps a dotted package name to its `(module, source-root)` slices. */
type PackageIndex = Map<string, PackagePartition[]>;

const TEST_ROOT_SET = new Set<string>(TEST_SOURCE_ROOTS);

/**
 * @description Splits an absolute JVM source path into the enclosing module and its source root,
 *   from the innermost `.../src/<root>/...` segment. Path-only — no filesystem probing — so the
 *   result is a pure function of the path and safe to use under `DefaultResolver`'s
 *   directory-keyed resolution cache (every file in one directory yields the same partition).
 * @param absPath - Absolute path to a JVM source file.
 * @returns The module root, the literal source-root segment, and its normalised kind.
 */
export function jvmPathPartition(absPath: string): {
  module: string;
  rootSegment: string;
  sourceRoot: SourceRoot;
} {
  const norm = absPath.replace(/\\/g, "/");
  const match = norm.match(/^(.*)\/src\/([^/]+)(?:\/|$)/);
  if (!match?.[1] || !match[2]) {
    const slash = norm.lastIndexOf("/");
    return {
      module: slash === -1 ? norm : norm.slice(0, slash),
      rootSegment: "",
      sourceRoot: "unknown",
    };
  }
  const rootSegment = match[2];
  const sourceRoot: SourceRoot =
    rootSegment === "main"
      ? "main"
      : TEST_ROOT_SET.has(rootSegment)
        ? (rootSegment as SourceRoot)
        : "unknown";
  return { module: match[1], rootSegment, sourceRoot };
}

/**
 * @description Resolves fully-qualified JVM imports (`com.example.data.UserRepository`,
 *   `com.example.data.*`) — and the synthetic same-package edge every JVM file carries — to
 *   concrete local source files. All four JVM languages share one resolver because they share a
 *   package model.
 *
 *   Resolution is driven by a **package-declaration index**: every `.java` / `.kt` / `.scala` /
 *   `.groovy` file under the project root is scanned once for its `package` line and grouped by
 *   package name. An import is then resolved by package lookup, not by walking a
 *   `src/<set>/<lang>/` directory convention — so Kotlin-Multiplatform (`<module>/<set>/src/`),
 *   flat layouts (files directly under `src/` with dotted packages), and Maven/Gradle/sbt trees
 *   all work the same way.
 *
 *   For a non-wildcard FQN `a.b.C`, the package is `a.b`; the file whose base name is `C` wins,
 *   and if none matches, every file in package `a.b` is returned (Go-style expansion — covers
 *   Kotlin/Scala/Groovy declaring `C` in a differently-named file, or many top-level types in
 *   one file). Shorter package guesses are tried for nested types (`a.b.Outer.Inner`).
 *
 *   Known limitations (see docs/adr-017-jvm-languages.md): brace-nested Scala `package a { … }`
 *   blocks are read as the outer package only; a genuinely external `a.b.C` whose package `a.b`
 *   also exists locally resolves to that local package rather than staying external.
 */
export class JvmLangResolver implements LangResolver {
  extensions = [".java", ".kt", ".kts", ".scala", ".sc", ".groovy", ".gradle"];

  /** Per-project-root package index, built lazily on first use. */
  private indexCache = new Map<string, PackageIndex>();

  /**
   * @description Resolves a JVM import specifier to all matching local source files.
   * @param currentFile - Absolute path of the importing file. Its `(module, source-root)` slice
   *   scopes the synthetic `<own-package>.*` wildcard; self-edges are dropped later by the
   *   graph builder.
   * @param specifier - Fully-qualified name, optionally ending in `.*` for a package wildcard.
   * @param rootDir - Absolute project root to index.
   * @param _resolveLocal - Generic resolver callback (unused for JVM).
   * @returns Every resolved source file, or `null` when the import is external/unresolvable.
   */
  resolve(
    currentFile: string,
    specifier: string,
    rootDir: string,
    _resolveLocal: (currentFile: string, specifier: string) => ResolvedImport | null,
  ): ResolvedImport[] | null {
    const index = this.getIndex(rootDir);
    if (index.size === 0) return null;

    const isWildcard = specifier.endsWith(".*");
    const segments = (isWildcard ? specifier.slice(0, -2) : specifier).split(".").filter(Boolean);
    if (segments.length === 0) return null;

    if (isWildcard) {
      // The synthetic same-package edge. Constrain it to the importer's own module + source
      // root: Java/Kotlin test files conventionally re-declare the main package under
      // `src/test/`, and separate Gradle/sbt modules routinely share package names
      // (`util`, `model`, `di`) — expanding across either boundary invents dependencies and
      // cycles (see docs/known_issues/03). Explicit `import a.b.C` below is *not* constrained.
      const partitions = index.get(segments.join("."));
      if (!partitions) return null;
      const here = jvmPathPartition(currentFile);
      const sameSlice = partitions.filter(
        (part) => part.module === here.module && part.rootSegment === here.rootSegment,
      );
      const callerIsTest = here.sourceRoot !== "main" && here.sourceRoot !== "unknown";
      const files = sameSlice.flatMap((part) =>
        // Defence-in-depth for repos that drop `Foo` and `FooTest` in one unconventional
        // directory: a non-test file's synthetic edge never targets a test-named sibling.
        callerIsTest
          ? part.files
          : part.files.filter((file) => !looksLikeJvmTestName(baseNameNoExt(file))),
      );
      return toResults(files);
    }

    // `a.b.C`: the type's simple name is `segments[splitAt]`, the package is everything before
    // it. Try the last segment first (`C` in package `a.b`), then earlier ones so a nested type
    // `a.b.Outer.Inner` still resolves against package `a.b`, type `Outer`. Explicit imports
    // legitimately cross source roots (a `src/test/` file importing `src/main/`) and modules,
    // so every slice of the package is in scope here.
    for (let splitAt = segments.length - 1; splitAt >= 1; splitAt--) {
      const files = allFilesFor(index, segments.slice(0, splitAt).join("."));
      if (!files) continue;
      const typeName = segments[splitAt];
      const byName = files.filter((file) => baseNameNoExt(file) === typeName);
      if (byName.length > 0) return toResults(byName);
      // Only fall back to the whole package for the direct `package.Type` shape, not for a
      // speculative nested-type split.
      if (splitAt === segments.length - 1) return toResults(files);
    }
    return null;
  }

  /**
   * @description Returns the cached package index for `rootDir`, building it on first request.
   * @param rootDir - Absolute project root.
   * @returns The package index (possibly empty).
   */
  private getIndex(rootDir: string): PackageIndex {
    const cached = this.indexCache.get(rootDir);
    if (cached) return cached;
    const index = buildPackageIndex(rootDir);
    this.indexCache.set(rootDir, index);
    return index;
  }
}

/**
 * @description Walks `rootDir` and groups every JVM source file by its declared `package`, then
 *   by its `(module, source-root)` slice so the synthetic same-package edge can be constrained
 *   to the importer's own module and source set (see {@link jvmPathPartition}).
 * @param rootDir - Absolute project root.
 * @returns A package name → partitions map. Files in the default (unnamed) package are omitted.
 */
function buildPackageIndex(rootDir: string): PackageIndex {
  const index: PackageIndex = new Map();
  const ignore = new Set(DEFAULT_IGNORE_DIRS);

  const add = (pkg: string, abs: string): void => {
    const { module, rootSegment, sourceRoot } = jvmPathPartition(abs);
    const partitions = index.get(pkg);
    if (!partitions) {
      index.set(pkg, [{ module, rootSegment, sourceRoot, files: [abs] }]);
      return;
    }
    const slice = partitions.find(
      (part) => part.module === module && part.rootSegment === rootSegment,
    );
    if (slice) slice.files.push(abs);
    else partitions.push({ module, rootSegment, sourceRoot, files: [abs] });
  };

  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_SCAN_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !ignore.has(entry.name)) walk(abs, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name);
      if (!JVM_SOURCE_EXTENSIONS.has(ext)) continue;

      const pkg = readPackage(abs, ext === ".scala" || ext === ".sc");
      if (!pkg) continue;
      add(pkg, abs);
    }
  };

  walk(rootDir, 0);
  for (const partitions of index.values()) {
    for (const part of partitions) part.files.sort();
  }
  return index;
}

/**
 * @description Flattens every `(module, source-root)` slice of one package into a single sorted
 *   file list, for explicit-FQN resolution which is not slice-constrained.
 * @param index - The package index.
 * @param pkg - Dotted package name.
 * @returns All files declaring `pkg`, or `undefined` when the package is unknown.
 */
function allFilesFor(index: PackageIndex, pkg: string): string[] | undefined {
  const partitions = index.get(pkg);
  if (!partitions || partitions.length === 0) return undefined;
  if (partitions.length === 1) return partitions[0]?.files;
  return partitions.flatMap((part) => part.files).sort();
}

/**
 * @description Reads the head of a file and extracts its `package` declaration.
 * @param absPath - Absolute file path.
 * @param isScala - Whether to compose consecutive `package` lines (Scala) vs. take the first.
 * @returns The dotted package name, or `null`.
 */
function readPackage(absPath: string, isScala: boolean): string | null {
  let head: string;
  try {
    const fd = fs.openSync(absPath, "r");
    try {
      const buf = Buffer.alloc(PACKAGE_SCAN_BYTES);
      const bytes = fs.readSync(fd, buf, 0, PACKAGE_SCAN_BYTES, 0);
      head = buf.toString("utf8", 0, bytes);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
  return extractJvmPackage(head, isScala);
}

/**
 * @description Turns a list of package files into resolved-import results. Self-edges (a file's
 *   own synthetic same-package edge resolving back to itself) are dropped by the graph builder,
 *   not here — `DefaultResolver` caches results per importer directory, so a per-file filter at
 *   this layer would leak one file's exclusion to its package siblings.
 * @param files - Absolute file paths in the target package (may be undefined).
 * @returns Resolved imports, or `null` when the package is empty/unknown.
 */
function toResults(files: string[] | undefined): ResolvedImport[] | null {
  if (!files || files.length === 0) return null;
  return files.map((file): ResolvedImport => ({ path: file, isExternal: false }));
}

/**
 * @description The file's base name without its extension — the conventional public type name.
 * @param filePath - A file path.
 * @returns The base name with the final extension removed.
 */
function baseNameNoExt(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}
