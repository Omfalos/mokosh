# Product Requirements Document (PRD) - Mokosh 🌊

## 1. Product Overview
**Mokosh** is a high-performance, AST-powered dependency graph generator for multi-language projects. It identifies and maps relationships across JavaScript, TypeScript, Python, Go, CSS, SCSS, Stylus, CoffeeScript, LiveScript, Lua, and Gherkin files — in a single traversable graph.

### 1.1 Problem Statement
AI models and developers often struggle to understand complex codebases, especially when tracing how a change in one file affects the rest of the system. Understanding blast radius, surfacing affected tests, and giving an AI assistant precise file-level context all require a queryable dependency graph. Most existing approaches are either too heavy, too slow, require a cloud service, or are limited to a single language.

### 1.2 Solution
Mokosh provides a lightweight, fast, and extensible tool that:
- Builds a full in-memory import graph from your local filesystem — no network required.
- Supports 10+ languages with a unified graph model.
- Offers a programmable API and CLI for dependency traversal, impact analysis, and unused-file detection.
- Exposes an MCP server so AI assistants can query the graph directly without any custom integration work.
- Integrates with Git to propose relevant test tags for modified files.

---

## 2. Core Features

### 2.1 AST-Based Dependency Extraction
- **JavaScript & TypeScript**: Uses the TypeScript Compiler API to accurately identify static `import`, dynamic `import()`, `require()`, and re-exports.
- **CSS & SCSS**: Robust regex-based parsing of `@import` declarations.
- **Support for JSX/TSX**: Fully compatible with React/modern frontend frameworks.

### 2.2 Advanced Graph Engine
- **Recursive Discovery**: Automatically crawls the project starting from one or more entry points.
- **Traversal API**: Depth-First Search (DFS) with configurable `maxDepth` to explore dependencies programmatically.
- **Relationship Typing**: Distinguishes between logic imports and style imports.
- **Unused File Detection**: Compares all source files in the project directory against the generated graph to identify "orphaned" or unreachable files.

### 2.3 Visual & File Persistence
- **Mermaid Export**: Generates `graph TD` diagrams for visual representation of the dependency tree.
- **Caching (Serialization)**: Saves the generated graph to a JSON file, allowing for instant reloads and reduced computation in CI/CD or RAG pipelines.

### 2.4 AI-Ready "Test Tag" Proposal
- **Tag Identification**: Automatically extracts `@smoke`, `@regression`, or custom tags from test file strings and function names.
- **Git Diff Integration**: Identifies which files have changed and traverses the dependency graph **backwards** to find all affected test suites and their associated tags.

---

## 3. Technical Stack (The "Fast Tools")

Mokosh is built with a focus on speed and modern development standards, using a carefully selected "fast" toolchain:

| Tool | Role | Why We Chose It |
| :--- | :--- | :--- |
| **Biome** | Linting & Formatting | 10x-100x faster than ESLint/Prettier. Built in Rust for maximum performance. |
| **tsup** | Bundling | Powered by **esbuild**. Extremely fast compilation and zero-config generation of ESM, CJS, and `.d.ts` files. |
| **tsx** | Runtime & Testing | Fast, zero-config TypeScript execution for Node.js, replacing the slower `ts-node`. |
| **Node.js Test Runner** | Testing | Built-in, native performance without the overhead of heavy testing frameworks like Jest. |
| **TypeScript Compiler API** | AST Parsing | The gold standard for accurately analyzing modern JavaScript and TypeScript. |

---

## 4. User Personas & Use Cases

### 4.1 AI Agents (RAG Workflows)
AI tools can use Mokosh to build a "mental map" of a project. By reading the serialized graph, an agent can understand file relationships without having to parse every file itself, significantly reducing token usage and latency.

### 4.2 Developers
Developers can quickly visualize how a new component or utility is connected to the rest of the application using Mermaid diagrams.

### 4.3 CI/CD & DevOps
By using the `--propose-tags` feature, CI pipelines can dynamically decide which subset of tests to run based on the files changed in a PR, saving time and compute resources.

---

## 5. Core Workflows

### 5.1 Graph Generation
1. User provides entry points (e.g., `src/main.ts`).
2. Mokosh parses files and resolves relative paths.
3. A JSON dependency map is generated.

### 5.2 Test Tag Selection
1. Git identifies changed files (e.g., `src/utils/auth.ts`).
2. Mokosh finds all files that *depend* on `auth.ts` (directly or indirectly).
3. If any of those files are identified as test files, their tags (e.g., `@login`) are collected and proposed.

### 5.3 Unused File Detection
1. User provides entry points.
2. Mokosh builds the dependency graph.
3. Mokosh scans the project directory for all supported file types (JS, TS, CSS, SCSS).
4. Any file found on disk but not in the dependency graph is reported as unused.

---

## 6. Future Roadmap
- Support for absolute paths and `tsconfig.json` path aliases.
- Integration with other styling formats like Less or Stylus.
- Plugin system for custom tag extraction logic.
- Native integration with popular CI/CD providers (GitHub Actions, GitLab CI).
