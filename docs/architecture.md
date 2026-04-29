# Architecture Overview

Mokosh is built with three core components working together to build and analyze project dependency graphs.

## Core Components

### 1. Parser (`src/parser.ts`)
The Parser's responsibility is to analyze a single file's content and extract its dependencies (imports) and metadata (tags).

- **JS/TS Files**: Uses the TypeScript Compiler API to parse the Abstract Syntax Tree (AST). It specifically looks for:
  - `ImportDeclaration` (Static `import`)
  - `ExportDeclaration` (Re-exports like `export ... from '...'`)
  - `CallExpression` for dynamic `import()`
  - `CallExpression` for CommonJS `require()`
- **Style Files**: Uses purpose-built AST libraries (`postcss`, `sass`, `stylus`) rather than regex. See [ADR-001](adr-001-styles-parsing.md) for the rationale.
- **Metadata Extraction**: Identifies potential test tags by:
  - Filename conventions (e.g., `*.test.js`, `*.spec.ts`).
  - Function and variable declarations.
  - `@tag` patterns in strings (commonly used in Playwright and Cucumber).

### 2. Graph Engine (`src/graph/`)
The Graph Engine handles the construction and representation of the dependency network.

- **GraphBuilder**: Starting from specified entry points, it recursively processes files. It uses a custom resolver to locate files on disk, handling relative paths, CommonJS extensions, and `tsconfig.json` path aliases.
- **Incremental Processing**: `GraphBuilder` can take a previous `Graph` instance as input. It uses file modification time (`mtime`) and file `size` to detect changes. Unchanged files are reused from the cache, significantly speeding up subsequent runs.
- **External Dependency Handling**: Identifies `node_modules` and absolute paths outside the project root as "external" dependencies. These are added to the graph's metadata but are not traversed recursively, keeping the focus on the project's own source code.
- **Cycle Detection**: Provides a `findCycles()` method to identify circular dependencies in the graph.
- **Graph Class**: Encapsulates the dependency map. It provides:
  - **Serialization**: Converts the graph to a plain JSON-serializable object for caching.
  - **Mermaid Export**: Generates a `graph TD` diagram showing relationships, with special styling for CSS.
  - **Traversal**: Implements a Depth-First Search (DFS) for exploring dependencies (both outgoing and incoming).
- **Feature Hub Detection** (`src/graph/features/`): A pure sub-module that identifies files with high in-degree (many importers). These *feature hubs* receive a `feature:<name>` tag and serve as traversal boundaries in the tag proposal system.

### 3. Tag Management (`src/tags/`)
This layer connects the dependency graph with external tools like Git to provide actionable insights.

- **Git Integration**: Executes `git diff` commands to identify modified files in the workspace.
- **Tag Proposal Logic**: Performs a **backward traversal** from changed files to find all affected test suites. Feature hub files short-circuit the traversal — when a hub is reached, its `feature:<name>` tag is emitted and the branch stops, preventing the tag set from exploding for widely-imported files. Set `featureDetection: false` to disable this and always traverse to test nodes.

### Graph Enrichment (`src/graph/enrichment.ts`)

After the graph is built, two post-processing passes add derived tags to nodes:

- **`enrichLibraryTags`**: For every non-relative import, extracts the package name and appends it as a tag (e.g. importing `react` adds a `react` tag). This powers library-based filtering.
- **`enrichTestNodeTags`**: For every `test`-category node, adds the basenames of its local imports as tags. This is the fifth tag strategy — graph-derived tags that connect test files to the modules they exercise.

## Data Flow

1. **Input**: Entry point paths.
2. **Build**: `GraphBuilder` reads files → `Parser` extracts imports → `GraphBuilder` resolves target paths → Repeat recursively.
3. **Enrich**: `enrichLibraryTags` and `enrichTestNodeTags` add derived tags to all nodes.
4. **Graph**: A `Graph` object is created containing `FileNode` entries.
5. **Action**: User requests traversal, Mermaid export, or tag proposal.
6. **Output**: Result (JSON, Mermaid, or list of tags).
