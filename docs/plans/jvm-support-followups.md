# JVM support — follow-ups and blind spots

**Date:** 2026-09-02
**Status:** working note (companion to `adr-017-jvm-languages.md`)

Captures a senior-JVM-engineer review of mokosh's Java / Kotlin / Scala / Groovy support after
dogfooding against `square/okhttp`, `typelevel/cats`, `square/retrofit`, and
`Kotlin/kotlinx.coroutines`. What already works is in ADR-017; this note is the punch list for
making mokosh genuinely useful *against real JVM repos*, plus the blind spots to state up front so
the tool isn't over-trusted.

---

## What already works (don't re-litigate)

- Cross-language, cross-module **import graph** in one pass, no JDK/Gradle — resolution is driven
  by a project-wide **package-declaration index** (`src/graph/lang-resolvers/jvm.ts`), so KMP /
  flat `src/` / sbt cross-build layouts all resolve.
- **Duplicate detection** — language-agnostic tokenizer, found real cross-file clones in every
  repo tested (cats `NonEmptySeq`/`NonEmptyVector` ~206 lines, okhttp `*EventListener` ~183).
- Per-file **export surface**, including the Kotlin/Scala many-top-level-types-per-file idiom.
- **Cycle detection** (found cats' `data`↔`syntax` cycles).
- **Test classification** by source set (`src/test`, `src/androidTest`) and framework imports,
  not filename.
- Synthetic **same-package edge** (`<pkg>.*`, `type: side-effect`) so a file's coupling to
  package siblings it never `import`s is visible to blast-radius.

Dogfood snapshot: okhttp 619 kt + 71 java nodes, ~41% edges resolved local; cats 21 entry points
→ 183 nodes via `import cats.X`; retrofit cross-module Java→Java resolution confirmed.

---

## Work items (priority order)

### 1. Symbol-level precision for same-package / wildcard references

**Why:** the synthetic `<pkg>.*` edge removed the false negative but is package-granular. "What
breaks if I change `retrofit2.Converter`" currently answers "all ~40 files in `retrofit2.http`".
For statically-typed JVM languages that's leaving precision on the table.

**Approach:** per package, collect the set of declared top-level type names (already have this
from `exports`). For each file, scan its token stream for those identifiers (even with no
`import` line) and link only the siblings actually referenced. Identifier scan against a known
name set — no real parser needed. Turns blast-radius from "the package" into "these N files".

**Touches:** `src/graph/lang-resolvers/jvm.ts` (or a post-build enrichment pass in
`src/graph/enrichment.ts`), needs the package→type-names map threaded in.

### 2. Java complexity + call graph (ADR-017 Phase 7) — **done** (2026-09-02)

**Why:** `@lezer/java` already produces a real tree. `find_complex_functions` /
`find_risk_hotspots` / `get_callers` work for TS/Go/Python and are simply unwired for Java.
"Which methods are complex, undertested, and churny" is the primary Java code-health question.

**Done:** `src/parser/complexity/java.ts` mirrors `src/parser/complexity/go.ts`
(`computeComplexity` + `collectFunctionComplexity`), wired into `parseJava`'s `ParseResult`
along with a `collectRawCallEdges` pass; `"java"` added to `CALL_EDGE_TYPES` in
`src/graph/language-support.ts`. Cyclomatic counts `if` / loops / non-default `switch` labels /
`catch` / ternary / `&&` / `||`; cognitive ports the Go nesting model. **Call edges cover
static (`Foo.bar()`) and constructor (`new Foo()`) calls on imported types only** — instance
calls through a variable are not captured (documented in ADR-017 limitations).

### 3. Coarse Kotlin / Scala complexity

**Why:** no pure-JS AST, so today there is *zero* complexity signal for Kotlin (Android is
Kotlin-first) and Scala. Approximate-but-present beats absent.

**Approach:** brace-matched cyclomatic approximation — find function bodies by brace matching in
the existing scanner, count `if` / `when` / `for` / `while` / `&&` / `||` / `?:` / `catch`.
~80% right, cheap. Ship for Kotlin at least. Leave `CALL_EDGE_TYPES` unset (call edges still
need an AST).

### 4. Gradle / sbt dependency versions + multi-module (ADR-017 Phase 5–6)

**Why:** every third-party import is currently just `external`, no version — can't answer "which
modules pull `log4j-core`, at what version" (Log4Shell-style triage). And real Android/Scala
repos are 20–100 modules; `get_workspace_affected` needs module boundaries to be useful.

**Status:** version reader **done** (2026-09-02). `src/parser/lockfile.ts` now reads
`gradle/libs.versions.toml` → `gradle.lockfile` (shallow-walked, depth ≤ 2) → `build.gradle(.kts)`
literals → sbt `build.sbt` / `project/*.scala` `%`/`%%` literals into
`LockFileData.jvmDependencies`, keyed by Maven group id. `attachLockfileVersion`
(`src/graph/builder.ts`) has a JVM branch doing longest-group-prefix match on the dotted
specifier. Workspace detectors still pending.

**Workspace detectors — done** (2026-09-02). `src/graph/workspace/detectors/gradle.ts`
(`settings.gradle(.kts)` `include(...)`) and `sbt.ts` (`lazy val m = project.in(file("..."))`,
plus `project/*.scala`), registered in `src/graph/workspace/index.ts` after `npmDetector`.
Single-module builds return `null` (repo stays a flat graph). Cross-module edges are tagged
`isWorkspace` by `WorkspaceGraph.annotateCrossPackageEdges()` — a post-build pass, since
`JvmLangResolver` resolves across modules but is not package-boundary aware.

**Remaining:** none for this item.

### 5. Noise control for the synthetic same-package edge

**Why:** a one-line change to a util in a 60-file package currently reports "60 files affected".

**Approach:** surface a filter so `get_dependencies` / `query` can exclude `type: side-effect`
edges; consider down-weighting them in `get_affected` traversal (`src/graph/analyzer.ts` /
`change-impact-cache.ts`) so package-granular edges don't dominate a result.

### 6. Annotation-driven category refinement — **done** (2026-09-02)

**Why:** `@RestController` / `@Service` / `@Repository` / `@Entity` / `@Composable` /
`@Component` are strong role signals a JVM engineer expects `query category:ui|logic` to honour.

**Done:** `classifyJvm` (`src/parser/lang/jvm-scan.ts`) now takes annotation + type-name hints.
`@Configuration` / `@SpringBootApplication` → `config`; `@Composable` / `*Activity` /
`*Fragment` / `*ViewModel` / `*Screen` → `ui`; `@Service` / `@RestController` / `@Repository` /
`@Component` / `@Entity` → `logic`. Gradle-script and test-source-set/import detection still win
first. Java feeds the hints from its Lezer tree walk; Kotlin/Scala/Groovy via the shared
`scanJvmClassifyHints` regex scan.

---

## Known blind spots (document, don't silently under-serve)

| Blind spot | Impact | Note in |
|---|---|---|
| **DI / reflection wiring** — Spring `@Autowired`, Dagger, Guice, `ServiceLoader` | A large fraction of real JVM coupling is runtime-wired and will never appear in an import graph without framework-specific passes | `docs/architecture.md`, MCP tool descriptions |
| **Generated sources** — Dagger, Room, MapStruct, Lombok, protobuf under `build/generated/` | `build/` is ignored, so edges into/out of generated code are missing | ADR-017 limitations table |
| **`Jenkinsfile`** and other extensionless Groovy | Not graphed — extension-based file typing only | ADR-017 limitations table |
| **Groovy import graph is shallow** | Dynamic, script-shaped; value is duplication, not structure | ADR-017 (already noted) |
| **Brace-nested Scala `package a { … }`** | Read as the outer package only | ADR-017 limitations table (already noted) |
| **Files with no `package` line** | Default-package classes / package-less scripts don't resolve and can't be resolved *to* | ADR-017 limitations table (already noted) |

Framework-aware DI passes (item at the top) are the biggest gap and the first thing a reviewer
notices missing — worth an explicit "mokosh sees compile-time imports, not runtime wiring"
sentence wherever JVM support is described.
