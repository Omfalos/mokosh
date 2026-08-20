/**
 * MCP tool schema definitions for the mokosh server.
 *
 * Each entry is a complete JSON Schema description of one callable tool.
 * This list is returned verbatim by the `ListTools` request handler and
 * drives IDE/agent autocompletion for tool arguments.
 *
 * Tool call order requirement: `analyze` must be called first to populate the
 * in-session graph cache. All other tools except `find_unused` and `query`
 * require a prior `analyze` call for the same `root`.
 */
export const TOOL_DEFINITIONS = [
  {
    name: "analyze",
    description:
      "Build the dependency graph for a project from entry points. Returns a summary of node count, categories, and cycles. Must be called before get_dependencies, get_dependents, get_affected, or propose_tags. Pass an empty entryPoints array to auto-detect a monorepo (pnpm/npm/yarn/Nx/Turborepo) and build per-package graphs — use get_workspace_packages and get_workspace_affected for monorepo queries.",
    inputSchema: {
      type: "object",
      properties: {
        root: {
          type: "string",
          description: "Absolute path to the project root (or monorepo root)",
        },
        entryPoints: {
          type: "array",
          items: { type: "string" },
          description:
            "Entry point files relative to root (e.g. ['src/index.ts']). Pass [] to trigger monorepo auto-detection.",
        },
      },
      required: ["root", "entryPoints"],
    },
  },
  {
    name: "get_dependencies",
    description:
      "Get files that a given file imports (outgoing traversal). depth=1 returns immediate imports; omit for the full transitive tree. Each result includes the specific symbols imported from that file (when known).",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        file: { type: "string", description: "File path relative to root" },
        depth: { type: "number", description: "Max traversal depth (default: 1)" },
        withMeta: {
          type: "boolean",
          description:
            "Include each result's category and export names alongside the path (default: false). Set true when you need to decide what to do with a result without a follow-up lookup.",
        },
      },
      required: ["root", "file"],
    },
  },
  {
    name: "get_dependents",
    description:
      "Get files that directly import a given file (one-hop incoming edges). Each result includes the specific symbols that dependent file imports from this file (when known).",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        file: { type: "string", description: "File path relative to root" },
        withMeta: {
          type: "boolean",
          description:
            "Include each result's category and export names alongside the path (default: false). Set true when you need to decide what to do with a result without a follow-up lookup.",
        },
      },
      required: ["root", "file"],
    },
  },
  {
    name: "get_affected",
    description:
      "Get all files transitively affected if a given file changes — full incoming traversal upward. Use before a refactor to understand blast radius. See docs/mcp.md for details on the testsOnly, cached, changedSymbols, and withMeta options.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        file: { type: "string", description: "File path relative to root" },
        testsOnly: {
          type: "boolean",
          description: "Return only test/spec files (default: false)",
        },
        cached: {
          type: "boolean",
          description:
            "Use a pre-computed impact cache for O(1) lookup instead of graph traversal. Cache is built lazily on first use and reused for the session (default: false).",
        },
        changedSymbols: {
          type: "array",
          items: { type: "string" },
          description:
            "Restrict blast-radius to files that import at least one of these symbols. Omit to treat the whole file as changed (conservative, same as before).",
        },
        withMeta: {
          type: "boolean",
          description:
            "Return each affected file as { path, category, exports } instead of a bare path string (default: false). Set true when you need to decide what to do with a result without a follow-up lookup.",
        },
      },
      required: ["root", "file"],
    },
  },
  {
    name: "get_callers",
    description:
      "Get files whose exported functions call into a given file (call-graph dependents). More precise than get_affected: only files with actual runtime call edges, not mere imports. Requires prior analyze() call.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Absolute path to project root" },
        file: { type: "string", description: "File path relative to root" },
        depth: { type: "number", description: "Max traversal depth (default: 1)" },
        withEdgeDetail: {
          type: "boolean",
          description: "Include from/to function names per edge (default: false)",
        },
      },
      required: ["root", "file"],
    },
  },
  {
    name: "find_unused",
    description:
      "Find files in the project that are not reachable from any entry point. Useful before cleanup passes. Omit entryPoints to reuse the cached graph from a prior analyze() call instead of rebuilding.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        entryPoints: {
          type: "array",
          items: { type: "string" },
          description:
            "Entry point files relative to root. Omit to reuse the cached graph from a prior analyze() call.",
        },
      },
      required: ["root"],
    },
  },
  {
    name: "list_tags",
    description:
      "List every distinct tag name present in the graph, with how many nodes carry each one. Call this before querying with tag:<name> to avoid a speculative filter silently returning zero results. Includes all tag kinds — a superset of what query's slim mode keeps (slim only retains comment-marker and import tags).",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Absolute path to the project root" },
      },
      required: ["root"],
    },
  },
  {
    name: "find_uncovered",
    description:
      "Find non-test files whose line coverage is below the configured threshold. Requires a prior analyze() call and coverageReportPath set in mokosh.config. coverageThreshold overrides the config default (default: 80).",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Absolute path to the project root" },
        coverageThreshold: {
          type: "number",
          description:
            "Line-coverage % below which a file is considered uncovered. Overrides config value.",
        },
      },
      required: ["root"],
    },
  },
  {
    name: "check_doc_drift",
    description:
      "Find markdown docs whose referenced files changed more recently than the doc itself — a commit-recency heuristic for stale documentation, not a content diff. Requires a prior analyze() call with gitStats: true in mokosh.config (otherwise no file has commit-timestamp data and nothing is flagged). See docs/adr-009-markdown-parsing.md for known limitations.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Absolute path to the project root" },
      },
      required: ["root"],
    },
  },
  {
    name: "find_complex_functions",
    description:
      "Find individual functions/methods above a cognitive (or cyclomatic) complexity threshold, sorted worst-first. Requires a prior analyze() call. Populated for TypeScript/JavaScript, Go, and Python.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Absolute path to the project root" },
        metric: {
          type: "string",
          enum: ["cognitiveComplexity", "complexity"],
          description: "Which score to threshold/sort on (default: cognitiveComplexity)",
        },
        threshold: {
          type: "number",
          description: "Minimum score to include (default: 10)",
        },
        limit: {
          type: "number",
          description: "Max results to return, worst-first (default: 20)",
        },
      },
      required: ["root"],
    },
  },
  {
    name: "find_risk_hotspots",
    description:
      "Find functions that are complex, in a poorly-covered file, and — when gitStats is enabled in mokosh.config — in a frequently-changed file. Requires a prior analyze() call and coverageReportPath set in mokosh.config; errors if no coverage data was loaded. Churn filtering is skipped (churnDataAvailable: false) when gitStats wasn't enabled, since complexity + low coverage alone is still a meaningful signal.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Absolute path to the project root" },
        metric: {
          type: "string",
          enum: ["cognitiveComplexity", "complexity"],
          description: "Which per-function score to filter/sort on (default: cognitiveComplexity)",
        },
        minComplexity: {
          type: "number",
          description: "Minimum per-function complexity score to include (default: 10)",
        },
        maxCoveragePct: {
          type: "number",
          description: "Maximum containing-file coverage % to include (default: 50)",
        },
        minChurn: {
          type: "number",
          description:
            "Minimum containing-file 90-day commit count to include (default: 0). Ignored when gitStats wasn't enabled at analyze time.",
        },
        limit: {
          type: "number",
          description: "Max results to return, worst-first by metric (default: 20)",
        },
      },
      required: ["root"],
    },
  },
  {
    name: "find_duplicates",
    description:
      "Find duplicated code blocks across the project, largest-first. CSS/SCSS/Less are matched structurally by rule body; every other parsed language is tokenized and matched via suffix array. Lock files and ignored directories are always excluded. Requires a prior analyze() call. See docs/mcp.md for matching-strategy, normalization, and caching details.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Absolute path to the project root" },
        minLines: {
          type: "number",
          description: "Minimum duplicated block size in lines to report (default: 6)",
        },
        ignoreLiterals: {
          type: "boolean",
          description:
            "Normalize string/number literals too, not just identifiers, so only structural shape drives a match (default: true). Set false for stricter, exact-text-only matching.",
        },
        maxPunctuationRatio: {
          type: "number",
          description:
            "Maximum fraction of a token-shingled block's window that may be object/array-literal structural punctuation ({ } : , [ ]) (default: 0.5). Filters out blocks that are mostly schema/object-literal shape instead of substantive shared logic. Does not apply to the CSS/Less/SCSS structural comparator. Set 1 to disable.",
        },
        ignoreDirs: {
          type: "array",
          items: { type: "string" },
          description:
            "Directory names to exclude, matched against any path segment (default: DEFAULT_IGNORE_DIRS merged with this root's configured ignoreDirs, if any). Pass [] to disable.",
        },
        limit: {
          type: "number",
          description: "Max duplicate blocks to return, largest-first (default: 50)",
        },
      },
      required: ["root"],
    },
  },
  {
    name: "propose_tags",
    description:
      "Propose what to run based on changed files. Pass changedFiles explicitly or omit to use git diff. format='tags' (default) returns test tags for CI tag-filtering; format='paths' returns test file paths ready to pipe directly to a test runner (e.g. vitest). Feature hubs act as traversal boundaries in both modes.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        changedFiles: {
          type: "array",
          items: { type: "string" },
          description: "Changed files relative to root. Omit to read from git diff.",
        },
        featureThreshold: {
          type: "number",
          description:
            "Min importers for a file to be treated as a feature hub (default: 5). A hub short-circuits traversal and emits a feature:<name> tag instead of all downstream tags.",
        },
        format: {
          type: "string",
          enum: ["tags", "paths"],
          description:
            "Output format: 'tags' returns test tag names for CI filtering (default); 'paths' returns test file paths to pipe to a test runner.",
        },
      },
      required: ["root"],
    },
  },
  {
    name: "detect_features",
    description:
      "Identify feature hub files — non-test files that import many other internal modules (orchestrators / aggregators like src/parser.ts or src/cli/runner.ts). Returns a list sorted by import count descending.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        entryPoints: {
          type: "array",
          items: { type: "string" },
          description: "Entry point files relative to root. Omit to use the cached graph.",
        },
        featureThreshold: {
          type: "number",
          description:
            "Min internal imports a file must have to qualify as a feature hub (default: 5).",
        },
      },
      required: ["root"],
    },
  },
  {
    name: "query",
    description:
      "Filter the graph by category, tag, path, or other node metadata. Returns matching nodes as JSON or a Mermaid diagram. If entryPoints is omitted the cached graph from a prior 'analyze' call is used. See docs/mcp.md for the full query DSL reference.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        entryPoints: {
          type: "array",
          items: { type: "string" },
          description:
            "Entry points to build the graph. Omit to reuse the cached graph from a prior 'analyze' call.",
        },
        filter: {
          type: "string",
          description:
            "Query string e.g. 'category:logic' or 'category:logic,tag:auth'. Supports: category, type, tag, path, external, importsFile, importedBy, minImports, maxImports, minSize, maxSize, hasDocstring, minCoverage, maxCoverage, minExportUsage, maxExportUsage, minComplexity, maxComplexity, minCognitiveComplexity, maxCognitiveComplexity, minCommits, maxCommits, isDocumented, isStale, lastAuthor. OR logic: any(key:val|key:val) matches if any single-key clause holds, ANDed with the rest of the query. sort: size|imports|commitCount90d|exportUsage|complexity|cognitiveComplexity, with sortDir: asc|desc (default desc). limit: N.",
        },
        mermaid: { type: "boolean", description: "Return a Mermaid diagram (default: false)" },
        slim: {
          type: "boolean",
          description:
            "Compact response mode (default: true). Returns export names, meaningful tags, and a flat importsFiles path list — no edge objects, no mtime/size. Tags are filtered to kinds comment-marker and import only; function/class/variable/type/library tags are dropped in slim output. Use list_tags to see the full tag inventory, or pass slim: false to get every tag kind on matching nodes.",
        },
      },
      required: ["root", "filter"],
    },
  },
  {
    name: "get_workspace_packages",
    description:
      "List all workspace packages detected in a monorepo, with their node counts and inter-package dependencies. Requires a prior analyze() call with empty entryPoints on a monorepo root.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Absolute path to the monorepo root" },
      },
      required: ["root"],
    },
  },
  {
    name: "get_workspace_affected",
    description:
      "Cross-package blast-radius analysis. Returns every file that could be affected if a given file changes, annotated with the package it belongs to. Requires a prior analyze() call with empty entryPoints on a monorepo root.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Absolute path to the monorepo root" },
        file: {
          type: "string",
          description:
            "Monorepo-root-relative path of the changed file (e.g. 'packages/shared/src/utils.ts')",
        },
      },
      required: ["root", "file"],
    },
  },
  {
    name: "get_type_graph",
    description:
      "Return type-level relationships for the project. Without a type name, returns an inventory of all interfaces, classes, enums, and type aliases with their file and kind. With a type name, returns which files import that type (usedByFiles) and which types the defining file imports (uses). Requires a prior analyze() call. Only covers TypeScript/JavaScript files.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Absolute path to the project root" },
        type: {
          type: "string",
          description:
            "Exact exported name of the type to look up (e.g. 'FileNode'). Omit to get the full type inventory.",
        },
      },
      required: ["root"],
    },
  },
  {
    name: "get_module_responsibility",
    description:
      "Return what each file is responsible for: its semantic role, JSDoc description (when present), exported symbol names, and which feature hub it belongs to. Pass specific paths to filter, or omit paths to get all files. Requires a prior analyze() call.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Absolute path to the project root" },
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Project-relative file paths to include. Omit to return all files.",
        },
        minOutDegree: {
          type: "number",
          description: "Min imports for a file to qualify as a feature hub (default: 5).",
        },
      },
      required: ["root"],
    },
  },
  {
    name: "get_feature_graph",
    description:
      "Group files by domain: returns which files each feature hub (high-import orchestrator) transitively owns. Each file is assigned to the most specific hub that can reach it (lowest out-degree wins). Use this instead of a full query when answering 'what files are in the X feature/module?' — it returns only paths grouped by hub, so it's substantially smaller than a full graph query for the same question; compare output sizes yourself if you need an exact figure for your repo.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Absolute path to the project root" },
        minOutDegree: {
          type: "number",
          description:
            "Minimum internal imports a file must have to qualify as a feature hub (default: 5).",
        },
      },
      required: ["root"],
    },
  },
  {
    name: "get_call_graph",
    description:
      "Look up callers and callees for a named function. Returns the file that defines the function, all files/functions that call it, and all files/functions it calls. Always requires a function name — never returns the full call graph unfiltered. Call edges are only populated for TypeScript/JavaScript files.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Absolute path to the project root" },
        function: {
          type: "string",
          description: "Exact name of the function to look up (e.g. 'parseFile').",
        },
      },
      required: ["root", "function"],
    },
  },
  {
    name: "find_symbol",
    description:
      "Find every file that exports a symbol by exact name, with the best available usage info per match. Precision varies by the defining file's language — check each match's `precision` field ('call' | 'file-level') before trusting caller/importer results as symbol-exact. See docs/mcp.md for per-language coverage details.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Absolute path to the project root" },
        name: {
          type: "string",
          description: "Exact export name to look up (e.g. 'parseFile').",
        },
      },
      required: ["root", "name"],
    },
  },
  {
    name: "get_api_surface",
    description:
      "Build the API surface report for a project: every exported symbol resolved to its defining file and kind, partitioned into internalFiles, unreachableFromEntry, and testFiles. Requires a prior analyze() call. When entryPoints is omitted, auto-detects from package.json exports/main/module. See docs/mcp.md for the export* expansion and partition semantics.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Absolute path to the project root" },
        entryPoints: {
          type: "array",
          items: { type: "string" },
          description:
            "Project-relative paths of public entry points (e.g. ['src/index.ts', 'src/utils.ts']). Omit to auto-detect from package.json exports / main / module fields.",
        },
      },
      required: ["root"],
    },
  },
  {
    name: "clear_cache",
    description:
      "Drop the cached dependency graph for a project root, forcing the next analyze() call to rebuild from disk. Call this after editing source files mid-session — otherwise get_affected, get_dependencies, and other query tools will reason from stale data.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Absolute path to the project root to invalidate." },
      },
      required: ["root"],
    },
  },
  {
    name: "apply_tags",
    description:
      "Write @tag annotations into test file source code based on the dependency graph, as an idempotent block — re-running is safe, the existing block is replaced in place. Use dryRun=true to preview changes without writing to disk. Requires a prior analyze() call. See docs/mcp.md for tag-kind and per-language block syntax details.",
    inputSchema: {
      type: "object",
      properties: {
        root: {
          type: "string",
          description: "Absolute path to the project root.",
        },
        dryRun: {
          type: "boolean",
          description:
            "When true, computes which files would change but does not write to disk (default: false).",
        },
      },
      required: ["root"],
    },
  },
] as const;
