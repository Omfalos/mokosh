# Python path — possible improvements

Status: **proposal, nothing implemented**. Source: a dogfooding run of mokosh against the Flask
repo. Items marked *(verified)* were checked against this checkout; the rest are hypotheses from
tool output and need confirming before work starts.

Related: [ADR-002](../adr-002-python-parsing.md), [ADR-011](../adr-011-go-python-call-edges.md),
[language-support.md](../language-support.md).

## Priority order

| # | Improvement | Effect on Flask run | Size |
|---|-------------|---------------------|------|
| 1 | More Python entry points | Clears most of the 63 `find_unused` false positives | M |
| 2 | Python test-file detection and test→source edges | `testFileCount` 0 → ~30; `get_affected` can answer "which tests do I run" | S–M |
| 3 | Typed import edges (top-level / function-local / `TYPE_CHECKING` / lazy) | Cycles like `app.py ↔ cli.py` can be classified as harmless | S–M |
| 4 | Per-symbol imports and export kinds | Symbol-level dependents instead of file-level | L |
| 5 | String-based references | Links the graph misses today (entry-point strings, templates) | L |
| 6 | Layer / package rollup and rules | Turns the graph into a check | M |
| 7 | Inheritance edges in the dependency graph | Real coupling shown | M |
| 8 | Duplicate-detection noise (overloads, docstrings) | Real copy-paste stands out | S–M |
| 9 | `.rst` docs with autodoc references | `check_doc_drift` covers most Python projects | M |
| 10 | Package-level Mermaid / DOT export | READMEs, PRs, easier bug spotting | S |

## 1. More entry points

**Today** *(verified)*: `pythonEntryPoints` (`src/languages/hooks/python.ts`) picks the shallowest
`__init__.py` files, or every module if there are none. Nothing reads `pyproject.toml`, and
`__main__.py` is not special-cased. Anything not reachable from the top-level `__init__.py`
(CLI modules, public-API modules not re-exported, examples) shows up in `find_unused`.

**Proposal**
- Read `[project.scripts]` / `[project.gui-scripts]` / `[tool.poetry.scripts]` from `pyproject.toml`
  (Flask: `flask = "flask.cli:main"`) and resolve `module:attr` to a file.
- Read `[project.entry-points.*]` groups (plugins) the same way.
- Treat `__main__.py` and top-level `setup.py` / `manage.py` / `wsgi.py` / `asgi.py` as roots.
- Treat `examples/` and `docs/conf.py` as separate root sets, not as dead code.
- Consider treating every module of the public package as exported API when no `__all__` narrows
  it (Flask's `views.py` is public but unreferenced inside the package).

**Open question**: the hook receives only `FileNode[]`; reading `pyproject.toml` needs `rootDir`
passed through `LanguageHooks.entryPoints` (or a lockfile-style loader like `parser/lockfile/`).

## 2. Test detection and test→source edges

**Today** *(verified)*: `PYTHON_HOOKS` defines only `entryPoints` — no `isTestPath`. Go defines
`isTestPath`; Python does not. This likely explains `testFileCount: 0`, and means
`enrichTestedBy` / `enrichTestNodeTags` never see Python tests.

**Proposal**
- Add `isTestPath`: `test_*.py`, `*_test.py`, `conftest.py`, and files under `tests/` / `test/`.
- Make sure those nodes get `category: "test"` so `find_unused` (see
  [issue 18](../known_issues/18-find-unused-no-test-exclusion.md)) and test enrichment work.
- Confirm `enrichTestedBy` links each test to the modules it imports; handle `conftest.py`
  fixtures as shared dependencies of the tests beside/below it.
- Check `propose_affected_tests` produces sensible results for pytest layouts (see
  `src/tags/strategies/pytest`).

## 3. Typed edges

Label each `ImportEdge` with how it is imported:
`top-level` | `function-local` | `type-checking` (`if TYPE_CHECKING:`) | `lazy` (module `__getattr__`).

- The parser (`src/parser/lang/python.ts`) already walks the AST; scope/guard is available there.
- `findCycles()` should report or filter by edge kind: a cycle that only closes through a
  `type-checking` or `function-local` edge is not a runtime import cycle.
- Hypothesis (unverified): Flask's `app.py ↔ cli.py` cycle is of this kind.
- Needs an `ImportEdge` field (`src/types/`) — touches a high-blast-radius hub; run `/pre-update`.
  Make it optional so other languages and cached graphs stay valid (see
  [issue 11](../known_issues/11-disk-cache-not-invalidated-by-mokosh-version.md)).

## 4. Per-symbol imports and kinds

**Today**: only star imports and re-exports are tracked per symbol; exports have kind `unknown`
(per `language-support.md`, import symbols are `partial`).

**Proposal**: record `from .app import Flask` as symbol `Flask`, resolve it to the `class`
definition for a real export kind, and feed `exportUsageRatio`, `find_symbol` and symbol-level
dependents. Largest item; depends on how the lezer grammar exposes names, and overlaps with the
type graph (item 7).

## 5. String-based references

Links created by strings: `module:app` (Flask `find_app_by_string`), `import_string(...)`,
`importlib.import_module(...)`, `render_template("x.html")`, entry-point group strings.

- Start narrow: literal-argument `import_module` / `import_string` and `module:attr` strings
  resolved against known modules.
- Templates and static files as nodes is a bigger model change; defer until the above lands.

## 6. Layer and package rollup

Optional config of layer rules (e.g. `sansio` must not import `flask.app`) with violations
reported by an MCP tool / CLI flag; plus a directory-level collapsed view. Overlaps with item 10.

## 7. Inheritance edges

`class Flask(sansio.App)` is a coupling the dependency graph does not show; it exists only in
`get_type_graph`. Either add a distinct edge kind (`extends`) to the dependency graph or surface
type-graph coupling in `get_affected` output. Prefer the former only if item 3's edge-kind field
exists already.

## 8. Duplicate-detection noise

Top Flask cluster (52 lines) looks like mirrored decorator signatures and docstrings. Ideas:
exclude `@overload` stubs and docstring-only spans from scoring, or add a `signature-only`
signal to the `find_duplicates` filter DSL (`src/query/dup-parser.ts`). See
[ADR-013](../adr-013-duplicate-detection-noise-reduction.md) and
[ADR-019](../adr-019-logic-token-scoring.md) for the existing scoring approach.

## 9. reStructuredText docs

Only `.md` / `.mdx` are parsed today ([ADR-009](../adr-009-markdown-parsing.md)). Flask has ~60
`.rst` files with `.. autoclass:: flask.Flask`-style references. Add `.rst` as a doc type,
extract autodoc directives (`autoclass`, `autofunction`, `automodule`, `:class:` roles) and map
them to files for `enrichDocDrift`.

## 10. Package-level export

Mermaid (and optionally DOT) with directory/package collapse via `src/exporters/`. Cheap, and
makes graph bugs from items 1–7 visible.

## PR order

Each item ships as its own PR, branched from `main`.

| PR | Item | Scope | Why this slot |
|----|------|-------|---------------|
| 0 | Proposal doc | This file only | Gives later PRs something to link to |
| 1 | #2 Test detection | Add `isTestPath` to `PYTHON_HOOKS`; verify `enrichTestedBy` and `find_unused` on pytest layouts; tests | Smallest change, the one gap verified in source, no hub types touched |
| 2 | #1 Entry points | Read `[project.scripts]`, `[project.entry-points]`, `__main__.py`; pass `rootDir` into the `entryPoints` hook | Biggest cut in `find_unused` false positives; changes the `LanguageHooks` signature shared with Go/JVM, so after PR 1 |
| 3 | #3 Typed import edges | Optional `kind` on `ImportEdge` set by the Python parser; `findCycles` can filter by it | Needs an ADR first (touches `src/types/` hub); unblocks #7 |
| 4 | #8 Duplicate noise | Skip `@overload` stubs and docstring-only spans | Independent; can move earlier |
| 5 | #10 Package-level Mermaid | Directory-collapsed export | Independent and cheap; can move earlier |

Items 4–7 and 9 (`.rst`) each need an ADR first and come after these.
