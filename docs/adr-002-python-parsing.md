# ADR-002: AST Library for Python Parsing

**Date:** 2026-05-15
**Status:** Accepted

---

## Context

Mokosh already recognised `.py` files (extension → `"python"` FileType, included in `DEFAULT_EXTENSIONS`) but had no registered parser. Python files fell through to an empty result, so the dependency graph was completely blind to Python code — no import edges, no test classification, no `propose_affected_tests` coverage.

The goal was a parser that:
- Extracts all Python import forms accurately (`import X`, `from X import Y`, relative imports with `.` / `..` notation, star imports, parenthesised multi-line imports)
- Classifies test files correctly (Python uses `test_*` / `*_test.py` conventions, not `.test.` / `.spec.`)
- Detects top-level `def` / `class` definitions as exports
- Supports `# @tag name` comment markers
- Works on Node 24 + ARM64 without native compilation

---

## Options considered

### 1. tree-sitter (native addon) — rejected

The existing ADR-001 notes describe why this was tried first. The native `tree-sitter` addon requires `node-gyp` compilation or prebuilt binaries. As of 2026-04-29, Node 24 ARM64 (ABI 137) has no prebuilt binary and source compilation fails locally. Dropped entirely.

### 2. web-tree-sitter + tree-sitter-wasms — considered

`web-tree-sitter` replaces the native addon with a WASM runtime. The `tree-sitter-wasms` package (maintained by Sourcegraph) ships prebuilt `.wasm` grammar files for Python and many other languages.

**Pros:** full tree-sitter AST semantics, proven at scale (used in VS Code, Sourcegraph).
**Cons:** async WASM initialisation, ~1–2 MB binary per language grammar, additional runtime dependency on a third-party prebuilt package. The parser pipeline in Mokosh is currently synchronous; adding async initialisation to `parseFile` would be a larger architectural change.

### 3. @ast-grep/napi — considered

A Rust-backed NAPI library with platform-specific prebuilt packages (`@ast-grep/napi-darwin-arm64`, etc.). Works on Node 24 as of the `0.42.x` release.

**Pros:** fast native execution, pattern-matching API.
**Cons:** same prebuilt-binary risk as the original tree-sitter. If a new Node ABI ships before ast-grep publishes binaries, the build breaks again. Also requires `@ast-grep/lang-python` as an additional package.

### 4. Regex-based parsing — partially implemented, then replaced

A regex approach was initially shipped: two-pass extraction of `import` and `from ... import` lines with inline comment stripping and multi-line parenthesis collapsing.

**Pros:** zero dependencies, simple.
**Cons:**
- Requires string pre-processing (normalisation of `\` continuations and `(...)` spans) that is fragile for edge cases
- Cannot reliably detect decorators wrapping top-level definitions
- `def`/`class` detection via `^` anchor is position-based, not structural — indentation-level tracking cannot be done with a single regex
- Comment stripping is a regex on top of a regex; any string literal containing `#` confuses it
- Adding new Python syntax features requires extending the pre-processing pipeline

### 5. @lezer/python (pure JavaScript) — **chosen**

The CodeMirror 6 project ships `@lezer/python`: a pure-JavaScript incremental LR parser for Python 3. It has no native code, no WebAssembly, and no compilation step.

---

## Decision

Use `@lezer/python` as the Python AST parser.

---

## Why @lezer/python

| Property | Value |
|---|---|
| Runtime | Pure JavaScript — no native addons, no WASM |
| Node compatibility | Any version (no ABI dependency) |
| Direct dependencies | `@lezer/common`, `@lezer/highlight`, `@lezer/lr` — all from the same org |
| Transitive dependencies | None beyond the three above |
| Publisher | Marijn Haverbeke (CodeMirror / ProseMirror author), `@lezer/` scoped org |
| Weekly downloads | ~2M |
| License | MIT |
| Known CVEs | None |
| Bundle size | ~150 KB |

### What the AST gives over regex

All Python import forms collapse to a single `ImportStatement` node. The parser walks child nodes directly, making the following cases unambiguous:

| Form | How resolved |
|---|---|
| `import os` | `ImportStatement` children: `import` kw + `VariableName "os"` |
| `import os.path as p` | dotted `VariableName` chain + `as` + alias (alias skipped) |
| `import os, sys` | two `VariableName` nodes separated by `,` |
| `from pathlib import Path` | `from` kw present; slice between `from` end and `import` start gives `"pathlib"` |
| `from .models import User` | same slice gives `".models"` → converted to `"./models"` for the resolver |
| `from . import utils, models` | slice gives `"."` + no module part → each imported name becomes its own edge (`./utils`, `./models`) |
| `from ... import core` | slice gives `"..."` → prefix `"../../"` |
| `from typing import *` | `*` node after `import` |
| multi-line `(...)` form | Lezer handles it natively; no normalisation needed |

`Comment` nodes are first-class in the Lezer tree, so `# @tag name` detection requires no pre-processing.

Top-level `def`/`class` detection uses `cursor.node.parent?.name` instead of indentation heuristics. A `FunctionDefinition` whose parent is `Script` is top-level; one whose parent is `Body` (inside a `ClassDefinition`) is not. Decorated top-level functions are detected via `DecoratedStatement → FunctionDefinition` with `DecoratedStatement.parent.name === "Script"`.

### Relative import encoding

Python's `.`-prefix relative syntax is converted to filesystem-relative paths before the edge is stored:

| Python specifier | rawSpecifier in graph |
|---|---|
| `from .models import X` | `./models` |
| `from ..utils import X` | `../utils` |
| `from ...core.utils import X` | `../../core/utils` |
| `from . import utils` | `./utils` (one edge per imported name) |

This lets `DefaultResolver.resolveLocalPath` handle Python relative imports with the same logic it uses for JavaScript `./` paths. The resolver was also extended with:
- `.py` added to the extension-probe list
- `__init__.py` fallback in `tryExtensions` for Python packages
- `resolvePythonBareImport()`: bare module names (e.g. `import mymodule`) are probed against the project root before being classified as external

---

## Consequences

**Positive**
- All Python import forms handled accurately and structurally
- Zero native/WASM compilation — works on any Node version and architecture
- Minimal, audited dependency chain from a single trusted publisher
- `propose_affected_tests`, `get_affected`, and the full graph traversal now work for Python projects with no changes to those systems
- Test file detection is correct for Python conventions (`test_*.py`, `*_test.py`, `pytest`/`unittest` imports, `conftest.py`)

**Negative**
- Lezer is designed for editor incremental parsing; its node names are slightly editor-flavored (e.g. `ImportStatement` rather than `import_statement`). This is cosmetic — the names are clear and consistent.
- Lezer does not perform semantic analysis (no type resolution, no scope tracking). For Mokosh's purpose — extracting import edges and top-level symbol names — this is sufficient.
- Adding a Python `@tag` comment with the same syntax as Lezer's `Comment` node is the only supported tag mechanism; Python docstrings are not yet extracted as `description`.
