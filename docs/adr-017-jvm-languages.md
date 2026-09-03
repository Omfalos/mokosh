# ADR-017: JVM Language Support (Java, Kotlin, Scala, Groovy)

**Date:** 2026-09-01 (revised 2026-09-02 — Scala + Groovy added; all 7 steps implemented)
**Status:** Accepted — implemented

> Post-dogfood punch list and blind spots: `docs/jvm-support-followups.md`.

---

## Context

Mokosh has no support for JVM languages. `.java` files are stubbed in
`src/parser/file-type.ts` (they map to `"unknown"`), `.kt` / `.scala` / `.groovy` are not
recognised at all, and none of the extensions are in `DEFAULT_EXTENSIONS`. Any Android, server-side
JVM, or Gradle/sbt-heavy repo is therefore invisible to the graph — no import edges, no test
classification, no `propose_affected_tests`, no complexity or risk data, and — because a file must
be in the graph to be tokenized — no cross-language **duplicate detection** either.

Two concrete motivators:

- **Android** — a modern Android app is Kotlin-first with a long tail of legacy Java, built by
  Gradle, usually split into many modules.
- **Duplicate detection across JVM build/glue code** — Gradle build scripts (`.gradle`, Groovy),
  Jenkins pipelines (`*.groovy`), and Spock/ScalaTest specs are the canonical copy-paste-across-
  modules offenders, and `find_duplicates` cannot see any of them today.

iOS (Swift / Objective-C) is tracked separately — Swift's module system doesn't have file-level
imports and needs a different edge model, so it does not belong in this ADR.

The goal is the same bar every other language parser clears (scaled to what each language's tooling
allows — see the tier table below):

- Extract every JVM import form (`import a.b.C`, `import a.b.*`, `import static a.b.C.d`, Kotlin/
  Scala-3 `import a.b.C as D`, Scala `import a.b.{C, D}` / `import a.b.{C => D}` / `import a.b._`),
  plus the file's own `package` declaration.
- Resolve fully-qualified imports to concrete local files, or mark them external.
- Annotate external imports with dependency versions (Gradle **and** sbt).
- Classify test files (JUnit / AndroidTest / instrumentation / Spock / ScalaTest conventions, not
  `.test.` / `.spec.`).
- Detect top-level type declarations as exports.
- Support `// @tag name` comment markers.
- Participate in duplicate detection.
- Run on Node 24 + ARM64 with no native compilation (see ADR-002).

---

## Feature tiers

| Language | Parser | Import graph | Complexity / cognitive / call-edges | Duplicate detection |
|---|---|---|---|---|
| **Java** | `@lezer/java` (real tree) | ✅ | ✅ done (`src/parser/complexity/java.ts`; call edges = static + constructor calls only) | ✅ (free — generic tokenizer) |
| **Kotlin** | hand-rolled scanner | ✅ | ❌ until a pure-JS AST exists | ✅ (free) |
| **Scala** | hand-rolled scanner | ✅ | ❌ until a pure-JS AST exists | ✅ (free) |
| **Groovy** | hand-rolled scanner | ✅ (lite — see below) | ❌ until a pure-JS AST exists | ✅ (free — the main motivator) |

Only `@lezer/java` exists on npm (`@lezer/kotlin`, `@lezer/scala`, `@lezer/groovy` all 404 as of
2026-09-02). Kotlin, Scala, and Groovy therefore fall to hand-rolled scanners, joining
`coffee.ts` / `ls.ts` / `lua.ts` / `gherkin.ts`. Each is swappable for a real grammar later with
**no resolver churn**.

---

## The core problem: FQN imports, not path imports

A JVM import names a fully-qualified type (`import com.example.data.UserRepository`), never a file
path. Resolution is a package-name → directory mapping layered on top of a set of **source
roots** whose location is a Gradle / Maven / sbt convention, not something stated in the source
file:

```
<module>/src/main/java/        <module>/src/main/kotlin/
<module>/src/main/scala/        <module>/src/main/groovy/
<module>/src/test/java/         <module>/src/androidTest/kotlin/
<module>/src/main/scala-2.13/   <module>/src/main/scala-3/     ← Scala cross-build dirs
```

`com.example.data.UserRepository` resolves to
`<module>/src/main/kotlin/com/example/data/UserRepository.kt` (or `.java`, `.scala`, `.groovy`, or
another source root). Extra wrinkles:

- **Kotlin, Scala, and Groovy all decouple file name from type name.**
  `com.example.data.UserRepository` may be declared in `Repositories.kt` /
  `package.scala` / `Repos.groovy`, and a file may declare many top-level types plus top-level
  functions/properties. `Foo.kt` is a hint, not a guarantee.
- **Wildcard imports** (`import com.example.data.*`, Scala 2 `com.example.data._`) name a package,
  not a type.
- **Same-package references need no import line**, so an import-only resolver misses edges
  between files that share a package.
- **Multi-module** repos have many `src/main/...` trees; `settings.gradle(.kts)` `include(...)` or
  sbt `lazy val m = project.in(file("m"))` enumerates the modules.

This is structurally the same problem `@lezer/go` + `GoLangResolver` already solve (see ADR-007):
the parser marks every import external, and a `LangResolver` does the package→directory work
later, returning **every file in the target package directory** rather than guessing one.

---

## Options considered

### Parser — Java

**1. `@lezer/java` (pure JavaScript) — chosen.** The CodeMirror project ships a pure-JS
incremental LR parser for Java, same family as the already-vendored `@lezer/go` and
`@lezer/python`. No native code, no WASM, no build step. Gives a real tree — enough for imports,
exports, `// @tag` markers, and later per-language complexity + call-edge extraction
(`src/parser/complexity/java.ts`, mirroring `complexity/go.ts`).

**2. Regex line scanner — rejected for Java.** Java imports themselves are regex-tractable, but a
real tree is wanted anyway for complexity/call-edges, and `@lezer/java` exists and is free. No
reason to ship a throwaway scanner.

**3. tree-sitter / ast-grep / web-tree-sitter — rejected** for the reasons in ADR-002: native
prebuild fragility across Node ABIs, or an async-WASM init that the synchronous parser pipeline
would have to grow a special case for.

### Parser — Kotlin

**Hand-rolled line scanner — chosen.** There is no official `@lezer/kotlin`, and no pure-JS
Kotlin AST library that meets the Node 24 / no-native-code bar. Kotlin's `package` and `import`
lines are simple and unambiguous at the start of a file:

```
package a.b.c
import a.b.C
import a.b.*
import a.b.C as D
```

A scanner that reads the leading `package` / `import` block, plus a light pass for top-level
`class` / `interface` / `object` / `fun` / `val` / `const` names as exports, and `// @tag`
markers, covers everything the graph needs.

**Rejected:** CodeMirror legacy `StreamLanguage` Kotlin mode (a highlighting tokenizer, not a
parse tree — no easier for exports/complexity than a purpose-built scanner, and adds a
dependency); waiting for a real Kotlin grammar (blocks Android support indefinitely on an
upstream that may never land).

### Parser — Scala

**Hand-rolled line scanner — chosen**, same rationale as Kotlin, but **budget more**: Scala's
import grammar is materially richer and Scala 2 vs 3 diverge.

```
package a.b.c            package a.b { ... }        package object c
import a.b.C
import a.b.{C, D, E}                     ← brace groups: multi-import on one line
import a.b.{C => D, E => _}              ← Scala 2 renaming / hiding
import a.b.C as D                        ← Scala 3 renaming
import a.b._            (Scala 2)        import a.b.*   (Scala 3)   ← wildcard
import a.b.given                         ← Scala 3 given imports
```

Additional scanner obligations beyond the Kotlin one:

- **Imports appear anywhere**, not just the file header — block-scoped imports inside
  methods/objects are idiomatic, so the scanner cannot stop after the leading block.
- **`package` has three forms** (flat, nested-braced, `package object`).
- **Scala 3 optional-braces / significant indentation** — the top-level-decl (export) pass must
  tolerate both brace and indentation styles; keep it conservative (names only, no body
  analysis).

**Rejected:** `tree-sitter-scala` (native/WASM — ADR-002); CodeMirror `StreamLanguage` Scala mode
(clike highlighter, no tree).

### Parser — Groovy

**Hand-rolled line scanner — chosen, and the simplest of the three.** Groovy's syntax is a
near-superset of Java's, and its import grammar *is* Java's:

```
package a.b.c
import a.b.C
import a.b.*
import static a.b.C.*
import a.b.C as D
```

No brace-groups (unlike Scala), no Scala-2-vs-3 fork. Export pass: top-level `class` /
`interface` / `trait` / `enum` names, plus top-level `def` for script-style files.

**Groovy is "lite" for the import graph** on purpose: Groovy is frequently dynamically typed and
script-shaped (Gradle DSL, `Jenkinsfile`-style pipelines), so import-edge coverage is inherently
lower-value than for statically-typed Kotlin/Scala. The payoff for Groovy is **duplicate
detection** — see below.

**Rejected:** `@lezer/groovy` (does not exist); Eclipse Groovy compiler / GroovyLangServer
(JVM processes — against the no-toolchain-shell-out principle, ADR-007).

### Duplicate detection — free for all four

`src/graph/duplication/tokenizer.ts` is **one language-agnostic tokenizer**, not a set of
per-language lexers. Any file that lands in the graph with a known `FileType` is tokenized and
participates in cross-language `find_duplicates` automatically. The only per-language input is a
`COMMENT_SYNTAX` entry so comment wording doesn't contribute to matches — and Java, Kotlin, Scala,
and Groovy all use identical C-style comments:

```ts
// src/graph/duplication/tokenizer.ts — COMMENT_SYNTAX
java:   { line: ["//"], block: [["/*", "*/"]] },
kotlin: { line: ["//"], block: [["/*", "*/"]] },   // Kotlin also nests /* */ — acceptable over-strip
scala:  { line: ["//"], block: [["/*", "*/"]] },
groovy: { line: ["//"], block: [["/*", "*/"]] },
```

That is the entire duplicate-detection cost. `.gradle` build scripts are Groovy: graph them (so
cross-module build-script copy-paste is found) but keep them `category: config` so they stay out
of complexity/risk. Only the `build/` and `.gradle/` **directories** go on the ignore list, not
the `.gradle` extension.

### Resolver — one `JvmLangResolver`, driven by a package-declaration index

Java, Kotlin, Scala, and Groovy share a package model. A single `JvmLangResolver`
(`src/graph/lang-resolvers/jvm.ts`) handles every extension
(`extensions = [".java", ".kt", ".kts", ".scala", ".sc", ".groovy", ".gradle"]`).

Resolution is **not** driven by a `src/<sourceSet>/<lang>/` directory convention. An earlier cut
globbed for those roots and broke on Kotlin-Multiplatform (`<module>/<sourceSet>/src/`), flat
layouts (files directly under `src/` with a dotted `package`), and `scala-2.13+` cross-build
dirs. Instead:

1. **Build a package index** once per root dir: walk the tree (bounded by the ignore-dir list),
   read the head of every `.java` / `.kt` / `.scala` / `.groovy` file for its `package`
   declaration, and group file paths by package name. Cached per root. Layout-independent —
   the file's declared package, not its directory, is the key.
2. **Resolve an FQN import** `a.b.C`:
   - Package is `a.b`; the file whose base name is `C` wins. If none matches, return **every**
     file in package `a.b` (Go-style expansion — covers Kotlin/Scala/Groovy declaring `C` in a
     differently-named file, or many top-level types in one file).
   - Nested types: shorter package guesses are tried, so `a.b.Outer.Inner` resolves against
     package `a.b`, type `Outer`.
   - Wildcard `a.b.*` (from a real `import a.b.*` / `a.b._`, or the synthetic same-package edge
     below) → every file in package `a.b`.
   - Scala brace group `import a.b.{C, D}` → the parser emits one edge per member; each resolves
     by the rules above. `import a.b.{C => D}` resolves on `a.b.C`.
3. **No package match** → `null`, i.e. external. The parser already set `isExternal: true`.

**Same-package implicit references — resolved via a synthetic edge.** JVM languages let a file
reference any sibling type in its own package with no `import` line, so an import-only resolver
misses that coupling (the okhttp/cats/retrofit dogfood showed it hides a lot of real Java/Scala
structure). Each JVM parser therefore emits one synthetic edge — `rawSpecifier: "<own-package>.*"`,
`type: "side-effect"` — alongside the explicit imports. The resolver expands it like any
wildcard; the graph builder drops the self-edge and, when the file is alone in its package,
drops the edge entirely rather than record a phantom external import. This is the Go-package-unit
model applied to JVM packages: coarse (it links package siblings that may not actually reference
each other) but it removes the false negative.

Returning `ResolvedImport[]` is already the interface shape (changed for Go in ADR-007), so no
interface change is needed.

**Still not resolved:**

- **Non-standard source layouts** — `sourceSets { ... }` (Gradle) / `unmanagedSourceDirectories`
  (sbt) overrides that put a package's files in packages that disagree with their declaration,
  Bazel layouts, generated sources (`build/generated/`, `target/`). The package index copes with
  any *directory* layout, but a file with no `package` line (default package, scripts) is not
  indexed, and brace-nested Scala `package a { … }` is read as the outer package only.

### External dependency versions — Gradle and sbt

Mirror what `src/parser/lockfile.ts` does for npm/pip/etc.

**Gradle** (Java / Kotlin / Groovy), in priority order:

1. `gradle/libs.versions.toml` (version catalog) — the modern default; maps aliases to
   `group:artifact:version`.
2. `gradle.lockfile` / `**/gradle.lockfile` (dependency locking) — exact resolved versions.
3. `build.gradle` / `build.gradle.kts` `dependencies { }` blocks — string-literal coordinates
   (`"com.squareup.okhttp3:okhttp:4.12.0"`); best-effort, no expression evaluation.

**sbt** (Scala), in priority order:

1. `build.sbt` `libraryDependencies` — string-literal coordinates in sbt's operator form:
   `"com.example" %% "artifact" % "1.2.3"` (the `%%` variant appends the Scala binary-version
   suffix `_2.13` / `_3` to the artifact id — normalise it away when matching) and the plain
   `"com.example" % "artifact" % "1.2.3"` form.
2. `project/*.scala` / `project/Dependencies.scala` — same literal `%`/`%%` extraction,
   best-effort; `val`-indirected versions are resolved only if the `val` is a string literal in
   the same file.
3. `project/build.properties` — the sbt launcher version, informational only.

An external import `okhttp3.OkHttpClient` is matched to a coordinate by longest-package-prefix
against the known `group` ids (`okhttp3` ⊂ `com.squareup.okhttp3` is itself heuristic — package
names frequently don't equal Maven group ids, so this is best-effort and absence of a version is
expected, not an error).

### Multi-module repos — Gradle and sbt workspace detectors

**Done** (2026-09-02). `detectMonorepo()` tried Turborepo → Nx → pnpm → Yarn → npm; two
detectors were added at lowest priority, after the JS ones
(`src/graph/workspace/detectors/gradle.ts`, `sbt.ts`, registered in
`src/graph/workspace/index.ts`):

- **Gradle detector** — fires when `settings.gradle` / `settings.gradle.kts` is present *and*
  declares `include`d modules. Scans for quoted colon-prefixed project paths (covers both
  `include ':a', ':b'` and `include(":a", ":b")`, with line wrapping and comment stripping);
  `:core:data` → `<root>/core/data`. A single-module build (no `include`) returns `null`.
- **sbt detector** — fires when `build.sbt` plus a `project/` dir is present, parsing
  `lazy val <name> = project` (optionally `.in(file("<path>"))` / `in file("<path>")`; shorthand
  `= project` → `<root>/<name>`), from `build.sbt` and any `project/*.scala`. The root aggregate
  (`project in file(".")`) is dropped; a build with no sub-projects returns `null`.

Each module becomes a `Graph` in the `WorkspaceGraph`, seeded from every JVM source file it
contains (JVM modules have no single index file). Cross-module imports resolve through
`JvmLangResolver` (project-wide package index) and are tagged `isWorkspace` /
`workspacePackage` by `WorkspaceGraph.annotateCrossPackageEdges()`, run once after all package
graphs are built — the resolver returns concrete file paths with no package-boundary awareness,
so the tagging is a post-build pass keyed on which package owns each edge's target. This reuses
the entire monorepo path (`get_workspace_affected`, package-level dep map) for free. Modules
with a non-standard `projectDir` / `unmanagedSourceDirectories` override are not relocated.

If neither detector is built in the first cut, a Gradle/sbt multi-module repo still works as a
single flat `Graph` — `JvmLangResolver`'s package index spans every module, so cross-module FQN
imports resolve regardless of module boundaries. The workspace detectors are an enhancement, not
a prerequisite.

### Supporting classifiers (optional, incremental)

- **`classify.ts` category heuristics:** `*Activity` / `*Fragment` / `*ViewModel` /
  `@Composable`-annotated / `*Screen` → `ui`; files under `src/test/` / `src/androidTest/` /
  `src/it/`, or importing `org.junit` / `androidx.test` / `org.robolectric` / `org.scalatest` /
  `spock.lang` / `munit` → `test`; `build.gradle*` / `settings.gradle*` / `build.sbt` /
  `project/*.scala` / `*.pro` (ProGuard) → `config`.
- **Test-tag strategies** (`src/tags/strategies/`): `junit.ts` (`@Test` / `@RunWith` / Espresso
  `onView(...)`), `spock.ts` (`extends Specification`, `def "..."` feature methods),
  `scalatest.ts` (`extends AnyFunSuite` / `AnyFlatSpec` / `AnyWordSpec`, MUnit `extends
  FunSuite`), alongside the existing vitest/jest/pytest/go strategies.
- **Ignore dirs:** add `build`, `.gradle`, `target` (sbt/Maven output) to `DEFAULT_IGNORE_DIRS`.

---

## Decision

Ship JVM support in this order, each step independently useful:

1. **Java parser** via `@lezer/java` + **`JvmLangResolver`** (package-declaration index, FQN→file,
   whole-package fallback, synthetic same-package edge). Wire `.java` through `file-type.ts`,
   `types/parse.ts` (`FileType` gains `"java"`), `const.ts` (`DEFAULT_EXTENSIONS`, ignore dirs),
   `parser.ts` registry loop, `resolver.ts`'s default `langResolvers` list, and one
   `COMMENT_SYNTAX` entry in the duplication tokenizer.
2. **Kotlin parser** — hand-rolled `package`/`import`/top-level-decl scanner reusing
   `JvmLangResolver` unchanged. `FileType` gains `"kotlin"`; `.kt` added everywhere `.java` was.
3. **Groovy parser** — hand-rolled scanner (Java-shaped imports). `FileType` gains `"groovy"`;
   `.groovy` added everywhere; `.gradle` mapped to `groovy` but kept `category: config`. This step
   is what unlocks duplicate detection over Gradle scripts, Jenkins pipelines, and Spock specs.
4. **Scala parser** — hand-rolled scanner (brace-group imports, block-scoped imports, Scala 2/3
   syntax fork, consecutive `package` lines composed into one FQN). `FileType` gains `"scala"`.
5. **Dependency version readers** in `lockfile.ts` — Gradle (catalog → lockfile → build script)
   and sbt (`build.sbt` → `project/*.scala`). **Done** (2026-09-02): parsed into
   `LockFileData.jvmDependencies` keyed by Maven group id; `attachLockfileVersion` matches an
   external FQN import by longest group-id prefix. See `docs/lock-files.md`.
6. **Workspace detectors** in `detectMonorepo()` — Gradle `include(...)`, then sbt `project.in`.
   **Done** (2026-09-02): `src/graph/workspace/detectors/{gradle,sbt}.ts`, registered after
   `npmDetector`; cross-module edges tagged by `WorkspaceGraph.annotateCrossPackageEdges()`.
7. **Classifiers**: `classify.ts` heuristics, JUnit/Spock/ScalaTest tag strategies,
   `complexity/java.ts`. **Done** (2026-09-02):
   - `src/parser/complexity/java.ts` (cyclomatic + cognitive + per-method breakdown, mirroring
     `complexity/go.ts`), wired into `parseJava`; `"java"` added to `CALL_EDGE_TYPES`. Java call
     edges cover **static method calls** (`Foo.bar()`) and **constructor calls** (`new Foo()`) on
     imported types — instance calls through a variable need type inference and are skipped
     (same class of gap as Go's unqualified-call limitation).
   - `classifyJvm` (`src/parser/lang/jvm-scan.ts`) extended with annotation / naming hints:
     `@Configuration` / `@SpringBootApplication` → `config`; `@Composable` / `*Activity` /
     `*Fragment` / `*ViewModel` / `*Screen` → `ui`; `@Service` / `@RestController` / `@Entity`
     etc. → `logic`. Test source set + test-framework imports still win. The four parsers feed
     the hints from their existing declaration scan (Java from the Lezer tree; Kotlin/Scala/
     Groovy via `scanJvmClassifyHints`).
   - `src/tags/strategies/junit.ts` (`.java` / `.groovy` test files → a `// mokosh:tags` block
     of `@Tag("…")` annotations + managed `org.junit.jupiter.api.Tag` import; JUnit 5 / Spock 2
     both run on the JUnit Platform) and `src/tags/strategies/scalatest.ts` (`.scala` test files
     → a `// mokosh:tags a, b` marker comment — see the Scala-tag limitation below), registered
     in `createStrategies` as extension-selected language strategies.

No new native dependencies. One new pure-JS dependency: `@lezer/java`.

---

## Known limitations (accepted)

| Limitation | Notes |
|---|---|
| Same-package coupling is package-granular, not symbol-precise | The synthetic `<own-package>.*` edge links a file to *every* sibling in its package, not only the ones it actually references — correct for blast-radius, noisier for `get_dependencies` |
| Kotlin / Scala / Groovy have no complexity / call-edges | No pure-JS AST for any of them; `find_complex_functions` / `find_risk_hotspots` exclude `.kt` / `.scala` / `.groovy` functions until a grammar exists |
| Java call edges are static + constructor calls only | `Foo.bar()` and `new Foo()` on an imported type resolve; instance calls through a variable or field (`this.converter.convert()`) need type inference and are not captured. A future pass could track local/param/field declared types against the imported-type set |
| Scala tag injection is a marker comment, not a native tag | `apply_tags` writes `// mokosh:tags a, b` above a `.scala` suite so `propose_tags` → `apply_tags` → `list_tags` round-trips; it does **not** make `testOnly -- -n a` work. ScalaTest class-level string tags need a generated `@TagAnnotation` type; `taggedAs` is per-test. Native per-test injection is a possible future enhancement |
| Files with no `package` declaration are unindexed | Default-package classes and package-less scripts don't resolve and can't be resolved *to*; brace-nested Scala `package a { … }` is read as the outer package only |
| Non-standard source layouts | The package index is layout-independent, but Gradle `sourceSets { }` / sbt `unmanagedSourceDirectories` that relocate a package's files without changing their `package` line, Bazel layouts, and generated sources under `build/` / `target/` still under-resolve |
| Scala cross-build dirs | `src/main/scala-2.13/` and `src/main/scala-3/` files are indexed by their (identical) `package` line, so a type present in both variants resolves to both; mokosh does not know which the build targets |
| Package name ≠ Maven group id | External-version matching is a best-effort longest-prefix heuristic; a missing version is normal, not an error |
| `build.gradle` / `build.sbt` dependency parsing is literal | String-literal coordinates only; `ext` / variable / `buildSrc` / sbt `val`-indirection beyond same-file string literals is not evaluated |
| Groovy import graph is shallow | Script-style / dynamically-typed Groovy (Gradle DSL, `Jenkinsfile`) yields few resolvable edges by nature; Groovy's value here is duplicate detection, not blast radius |
| `Jenkinsfile` (no extension) | Not picked up in v1 — extensionless filename matching is out of scope |
| No Gradle / sbt / Java toolchain invoked | Pure filesystem + text parsing, same stance as ADR-007 for Go — no `gradle` / `sbt` / `javac` subprocess |

---

## Consequences

**Positive**

- Android repos (Kotlin + Java + Gradle multi-module) become first-class: import graph, blast
  radius, test attribution, and — for Java — complexity and risk data.
- **Duplicate detection reaches JVM build/glue code** — Gradle scripts, Jenkins pipelines, Spock
  and ScalaTest specs — for the cost of four one-line `COMMENT_SYNTAX` entries, because the
  duplication tokenizer is language-agnostic.
- `JvmLangResolver` is one resolver for four languages; the three scanners are small and
  swappable when real grammars appear, with no resolver churn.
- Reuses the existing monorepo, lock-file, classification, and tagging machinery rather than
  adding parallel paths.

**Negative / trade-offs**

- Kotlin, Scala, and Groovy analysis is shallower than Java (no complexity/call-edges) until
  upstream tooling exists — an asymmetry users of Kotlin- or Scala-heavy repos will notice.
- The synthetic same-package edge trades precision for recall: it inflates edge counts (roughly
  by the average package size) and makes `get_dependencies` on a JVM file list its whole package,
  in exchange for blast-radius analysis seeing coupling that has no `import` line.
- The package index reads the head of every JVM source file on the first resolve for a root —
  an O(files) cost paid once and cached, negligible next to parsing.
- Three more bespoke scanners to maintain (joining coffee/ls/lua/gherkin), with the usual risk of
  drifting behind language syntax changes — Scala 3's evolving syntax is the highest-risk of the
  set.
- Two build systems (Gradle, sbt) each need their own version reader and workspace detector;
  sbt's `.scala` build definitions are only partially analysable without evaluating them.

---

## Amendment (2026-09-03): partition the package index by module + source root

Dogfooding v0.5.0 against Java/Kotlin **monorepos** (`docs/known_issues/03-jvm-cycle-detection-noise.md`)
showed the package-name-only index over-resolves the synthetic same-package edge across two
boundaries a reader cares about:

- **`src/main` ↔ `src/test`** — test files conventionally re-declare the main package, so
  `com.example.Foo` and `com.example.FooTest` landed in one bucket and wired a main↔test
  2-cycle for every tested class (plus longer `app → lib → app` loops once a test pulled in
  another module), and polluted `get_affected` / `get_dependents` with production → test edges.
- **Cross-module package-name collision** — separate Gradle/sbt modules sharing `util` /
  `model` / `di` package names merged, producing module-level cycles.

Change: `PackageIndex` is now `Map<packageName, PackagePartition[]>`, where each partition is
one `(module, source-root)` slice. `jvmPathPartition(absPath)` derives both from the innermost
`.../src/<root>/...` path segment — path-only, no filesystem probing, so it is a pure function
of the path and safe under `DefaultResolver`'s directory-keyed resolution cache.

- The **synthetic `<pkg>.*` wildcard** resolves only within the importer's own slice
  (`module` **and** literal source-root segment equal), with a filename-based
  defence-in-depth drop of test-named targets for unconventional layouts.
- **Explicit `import a.b.C`** is unchanged — it still searches every slice of the package, so
  a `src/test/` file importing `src/main/`, or a real cross-module import, resolves as before.

The synthetic edge also now carries `isSamePackage: true` (`ImportEdge`, set in
`jvmPackageEdge`); `GraphAnalyzer.findCycles` skips it, so the latent intra-package clique
(every package a complete digraph) no longer surfaces as cycles, while blast-radius analyses
(`get_affected` / `get_dependents` / `get_workspace_affected`) keep it. `classifyJvm` gained
TestNG / AssertJ / Truth / Hamcrest / MockK import prefixes and a weak `*Test` / `*Spec` /
`*IT` filename fallback (checked last, after annotations and source-root).

Single-module behaviour is unchanged — one module, one `main` slice per package. This
partitioned index is also what the workspace-build perf work
(`docs/known_issues/01-…`, `02-…`) will share instead of rebuilding a whole-repo index per
package.
