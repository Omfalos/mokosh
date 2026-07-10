# ADR-007: Go Import Resolution Strategy

**Date:** 2026-06-19
**Status:** Accepted

---

## Context

Mokosh parses Go source files using the Lezer Go grammar (`@lezer/go`) to extract import specifiers. The parser marks every import as `isExternal: true` because it operates on a single file in isolation and has no module context.

A `GoLangResolver` was subsequently added (`src/graph/lang-resolvers/go.ts`) to resolve module-local imports by reading `go.mod`. It handles the common case of single-module repos where every import prefixed with the declared module name maps to a local subdirectory.

An audit (2026-06-13) raised point 13 as a P0 blocker: the resolver was described as "silently wrong" because all imports appeared external. That was true at the time of the audit. The `GoLangResolver` was implemented after the audit, but it still has four known gaps:

1. **One file per package** — Go's import model is package-scoped (a directory of `.go` files). The resolver picks one representative file per package (`doc.go` if present, otherwise alphabetical first). All other files in the package are invisible to the graph.
2. **`replace` directives** — `go.mod` allows redirecting a module path to a local directory (`replace github.com/org/repo => ../local`). These are not parsed; affected imports fall through as external.
3. **Vendor directories** — projects using `go mod vendor` store third-party packages in `vendor/` on disk. These are treated as external even though they are local.
4. **`go.work` workspaces** — Go 1.18+ workspace files group multiple modules. Not handled.

---

## Options considered

### Option A: `go list -json ./...` subprocess

Run the Go toolchain at analysis time:

```
go list -json ./...
```

Each output object contains `ImportPath`, `Dir`, `GoFiles` (all source files in the package), and `Imports` (resolved import paths). Pre-computing this map before graph traversal fixes all four gaps:

- **Gap 1 fixed** — `GoFiles` lists every `.go` file; one import edge per file becomes accurate.
- **Gap 2 fixed** — `go list` resolves `replace` directives natively; `Dir` is already the redirected path.
- **Gap 3 fixed** — `go list -mod=vendor` respects the vendor directory.
- **Gap 4 fixed** — run from the workspace root with `go.work` present; all modules are visible.

**Rejected** for the following reasons:

- **Hard runtime dependency on Go toolchain.** Mokosh is a Node.js tool. Requiring `go` to be in `$PATH` to analyse a Go repo adds installation friction and breaks in environments where Go is not present (e.g. CI containers that only have Node).
- **Slow cold start.** `go list` resolves the full module graph and may trigger network downloads (`go.sum` verification). Cold runs on large repos take 10–30 seconds.
- **Brittle on broken repos.** `go list` exits non-zero if the project has missing dependencies or type errors, returning no data. The current FS-based approach degrades gracefully.
- **Scope creep.** Vendoring and `go.work` support are edge cases that affect a small fraction of repos. Introducing a subprocess to handle them is disproportionate.

### Option B: Pure filesystem resolution (chosen)

Extend the existing `GoLangResolver` to fix gaps 1 and 2 using only `fs` and `go.mod` parsing. Gaps 3 and 4 are documented as known limitations.

**Gap 1 fix — all files per package:** Change `GoLangResolver.resolve()` to return all non-test `.go` files in the resolved package directory. This requires changing the `LangResolver` interface from `ResolvedImport | null` to `ResolvedImport[] | null` and updating `DefaultResolver` and `GraphBuilder` accordingly.

**Gap 2 fix — `replace` directives:** Parse the `replace` block of `go.mod` into a redirect map and apply it before path mapping. `go.mod` has a well-defined, stable grammar; a line-by-line parser is sufficient.

---

## Decision

Implement Option B. Fix gaps 1 and 2 with pure filesystem reads. Document gaps 3 and 4 as known limitations in tool descriptions and the `analyze` response.

Vendor directory and `go.work` workspace support can be added later as pure-FS extensions if demand arises — both are solvable without a Go toolchain dependency.

---

## Known limitations after this fix

| Gap | Status | Notes |
|-----|--------|-------|
| One file per package | **Fixed** | All non-test `.go` files in target package directory included |
| `replace` directives | **Fixed** | Parsed from `go.mod`; local redirects resolved correctly |
| Vendor directories | **Not fixed** | `vendor/` imports remain external; affects projects using `go mod vendor` |
| `go.work` workspaces | **Not fixed** | Multi-module workspaces not supported |

No runtime warning is emitted for these gaps — they're tracked here and in the resolver's source comments (`src/graph/lang-resolvers/go.ts`) only.

---

## Consequences

- `LangResolver.resolve()` return type changes to `ResolvedImport[] | null` — this is a breaking change to the internal interface but has no effect on the public API surface.
- `DefaultResolver` and `GraphBuilder.resolveImports()` are updated to handle multi-result resolution.
- `GoLangResolver` gains `replace` directive parsing and multi-file package expansion.
- No new npm dependencies.
- No Go toolchain required.