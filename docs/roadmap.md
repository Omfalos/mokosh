# Mokosh — Product Roadmap

> Product Owner perspective. Grounded in the current state of the codebase as of May 2026.

---

## Where we are today

Mokosh ships a working CLI and MCP server that parses TypeScript, JavaScript, Python, CSS/SCSS, CoffeeScript, LiveScript, Lua, and Gherkin into a directed import graph. The graph is enriched with coverage data, complexity metrics, export-usage ratios, git stats, and semantic tags. The MCP interface (14 tools) is the primary consumption path for AI agents. Monorepo support covers Turborepo, Nx, pnpm, Yarn, and npm.

What is still missing: **the package is not published to npm**, there is no stable public API contract, no VS Code or IDE integration, no web-based dashboard, and no plugin system. These are the key gaps shaping the next three planning horizons.

---

## Horizon 1 — Stabilise and Ship (Q3 2026)

**Goal:** get a published, versioned package in the hands of real users.

### 1.1 Publish to npm

The single highest-leverage action. Everything else is blocked until we have a stable, installable artifact.

- Decide on a versioning strategy: start at `0.1.0` and commit to semver from `1.0.0`.
- Publish `mokosh` (CLI) and `mokosh-mcp` (MCP server) as separate package entry points from the same monorepo.
- Add a `CHANGELOG.md` and automate release notes via conventional commits.
- Add provenance signing (`npm publish --provenance`) for supply-chain trust.

**Success metric:** `npx mokosh --version` works for any user without cloning the repo.

---

### 1.2 API contract & type exports

The public API (`createImportMap`, `createWorkspaceGraph`, `getAllProjectFiles`) is used by third parties but has no explicit stability guarantee.

- Mark the public surface clearly with `@public` / `@beta` / `@internal` JSDoc flags (already used in the exporter system — extend this convention everywhere).
- Publish a typed `mokosh` package that re-exports all stable types from `src/types/`.
- Introduce a breaking-change policy: anything exported without `@internal` is semver-protected.

---

### 1.3 Configuration schema validation

`mokosh.config.*` is loaded but not validated against a schema at runtime. Users get silent misconfigurations.

- Define a JSON Schema for `mokosh.config.json` / `mokosh.config.ts`.
- Validate on load and emit a structured error with the offending key and expected type.
- Ship the JSON Schema as a published artifact so editors can provide autocomplete via `$schema`.

---

### 1.4 CI/CD template library

The `--propose-tags` and `--affected-tests` commands exist but there is no official integration guide.

- Publish a GitHub Actions reusable workflow: `mokosh/actions/propose-tags@v1`.
- Publish a GitLab CI template snippet.
- These are documentation and thin YAML — low engineering cost, high adoption value.

---

## Horizon 2 — Expand reach (Q4 2026)

**Goal:** grow the number of project types and integration surfaces Mokosh can serve.

### 2.1 Additional language parsers

Priority ranking based on ecosystem size and inbound interest:

| Language | Parser strategy | Priority |
|----------|----------------|----------|
| Go | Pure filesystem via `go.mod` (implemented); vendor + `go.work` deferred — see ADR-007 | ✅ Shipped |
| Ruby | Ripper AST via subprocess or `@lezer/ruby` | Medium |
| Java / Kotlin | `javap` / IntelliJ indexing protocol | Low (complex) |
| Rust | `cargo metadata` JSON output | Medium |
| C# | Roslyn `dotnet-script` subprocess | Low |

Rust can be prototyped quickly using `cargo metadata` JSON output rather than a full AST parser — returning import paths with no symbol-level detail. Ship coarse-grained support first, refine later. Go is already implemented via pure filesystem resolution (see ADR-007).

Each new language follows the existing four-step pattern in `CLAUDE.md` (create lang file, register, add extension to constants, add to FileType enum).

---

### 2.2 Plugin system for parsers and enrichments

Today adding a parser requires forking the repo. A plugin API lets ecosystem libraries extend Mokosh without owning the release cycle.

**Parser plugins:**
```typescript
import { registerParser } from 'mokosh/plugins';

registerParser({
  extensions: ['.hbs', '.handlebars'],
  parse(filePath, source): ParseResult { … }
});
```

**Enrichment plugins:**
```typescript
import { registerEnrichment } from 'mokosh/plugins';

registerEnrichment({
  name: 'sentry-ownership',
  async enrich(graph, options): Promise<void> { … }
});
```

Plugins are loaded from `mokosh.config.plugins[]` — an array of module specifiers resolved relative to the project root.

The existing registry pattern (`src/parser/registry.ts`, `src/graph/workspace/registry.ts`) already proves the mechanism works internally. This is an API stabilisation and documentation task as much as an engineering one.

---

### 2.3 IDE extension (VS Code first)

An editor that can show blast radius inline as you open a file would make Mokosh visible to the developer audience, not just CI pipelines and AI agents.

**Phase A — Language Server protocol (lower effort):**
- Expose `get_affected` results as hover annotations: "12 files depend on this export."
- Show cyclic imports as diagnostics (red underlines).
- Powered by the existing MCP server over a local stdio connection — no new graph engine code needed.

**Phase B — Sidebar panel:**
- D3 or vis.js canvas rendering the Mermaid graph for the active file.
- Click-through navigation to dependents / dependencies.

Scope Phase A for this horizon. Phase B is Horizon 3.

---

### 2.4 Complexity trend tracking

The parser already computes `complexity` and `cognitiveComplexity` per file. Today these are point-in-time numbers.

- Add a `--complexity-baseline` flag that snapshots current complexity scores to a JSON file.
- Add a `--complexity-diff` flag (or CI check) that compares against the baseline and fails if any file exceeds a configurable delta.
- Surface the trend in `query` output: `sort:complexity` already works; add `minComplexity:<N>` and `maxComplexity:<N>` filter keys.

---

### 2.5 HTTP/SSE transport for MCP

The MCP server currently supports stdio only. Many hosting environments (Docker sidecars, remote dev boxes) want a networked transport.

- Add an optional `--http` flag to `mokosh-mcp` that binds to a port and speaks HTTP + SSE (the MCP spec supports this).
- The graph cache, session model, and all 14 tools remain unchanged — this is purely a transport layer addition.
- Enables Mokosh MCP to run as a shared service inside a team's dev environment rather than per-developer process.

---

## Horizon 3 — Intelligence layer (H1 2027)

**Goal:** move from structural analysis to semantic and predictive capabilities.

### 3.1 Natural language graph queries

Today `query` takes a DSL (`category:logic,tag:auth,minImports:5`). Most developers will not learn this syntax.

- Add a `--nl-query` flag: `mokosh --nl-query "which files have no tests and were changed in the last 30 days?"`
- Internally, use an LLM (via the Anthropic API with prompt caching) to translate the natural language query into the existing DSL.
- The translation layer is stateless and cheap — it only converts strings, it does not process the graph itself.
- The graph query executes locally as always — no graph data leaves the machine.

---

### 3.2 AI-generated change summaries

When `get_affected` returns 40 files, a developer still needs to read them all. An LLM can summarise the impact.

- After `get_affected`, optionally pass the affected file list to a summarisation step.
- The output is a short prose paragraph: "Changing `src/auth/token.ts` affects the login flow, 3 API middleware files, and 8 test suites. The highest-risk dependency is `src/api/session.ts` which is imported by every authenticated route."
- Opt-in via `--summarise` flag or `summarise: true` MCP parameter.
- Requires `ANTHROPIC_API_KEY` in the environment; gracefully degrades (skips) if absent.

---

### 3.3 Architectural drift detection

Mokosh already tracks `category` (logic, ui, test, config, barrel, type-only) and `tags`. A rule engine on top of this enables enforcing architectural constraints.

```json
// mokosh.config.json
{
  "rules": [
    { "deny": "category:ui importing category:logic from path:src/database/" },
    { "deny": "category:logic importing category:ui" },
    { "warn": "category:barrel with maxExports:1" }
  ]
}
```

- Violations surface as CLI exit-code 1 with a structured diff.
- Integrates into the MCP server as a new `check_rules` tool.
- This is differentiated: most dependency tools do not include an architectural constraint layer.

---

### 3.4 Web dashboard

A read-only web UI that renders the serialised graph for team-wide visibility.

- Single-page app (Vite + React) served from `mokosh-dashboard`.
- Reads a `mokosh.graph.json` file generated by the CLI — no server required, ships as a static site.
- Features: search, filter (reusing the query DSL), click-through navigation, complexity heatmap, coverage overlay.
- Can be generated in CI and deployed as a GitHub Pages artifact alongside coverage reports.

---

## Cross-cutting concerns (all horizons)

### Performance

The incremental build (mtime + size cache) works well for local use. For very large monorepos (10k+ files):

- Benchmark the bottleneck (likely the TypeScript Compiler API initialisation per file).
- Investigate worker-thread parallelism for the parse step — each file parse is independent.
- Consider a persistent daemon mode for the CLI that holds the graph in memory across invocations (the MCP server already does this).

### Documentation

- User-facing docs are good (architecture, MCP, query DSL, traversal). Missing: a **Getting Started** guide for a brand-new user in 5 minutes.
- Add a `docs/contributing.md` covering the four-step parser extension pattern, test conventions, and release process.
- Add a `docs/plugin-authoring.md` once the plugin API ships in Horizon 2.

### Test coverage

- The parser layer has good unit test coverage. The enrichment layer and workspace model have less.
- Before publishing, ensure `enrichCoverage`, `enrichExportUsage`, and the monorepo detectors each have integration tests against real fixture projects.

---

## Success metrics

| Metric | Horizon 1 target | Horizon 2 target |
|--------|-----------------|-----------------|
| npm weekly downloads | — | 500 |
| GitHub stars | 50 | 250 |
| Languages supported | 8 (current) | 12 |
| MCP tools | 14 (current) | 16 |
| Open issues (bugs) | < 10 | < 15 |
| Build time (10k file project) | < 30s | < 15s |

---

## Decisions deferred

- **LSP vs MCP for IDE integration** — we will prototype both in Phase A of Horizon 2 before committing to a primary path.
- **Rust rewrite of the parser core** — not worth the cost until the performance benchmark (above) confirms Node/TS is the bottleneck.
- **SaaS/cloud offering** — out of scope until there is clear demand from teams who cannot run a local binary.