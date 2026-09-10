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

/** Shared `package` schema property for a tool that fans out across every workspace package's
 *  graph and concatenates results when `package` is omitted. */
const FAN_OUT_PACKAGE_PROPERTY = { type: "string" } as const;

/** Shared `package` schema property for a tool that runs against the flattened whole-workspace
 *  graph on a monorepo root — `package` optionally narrows it to one package. */
const SINGLE_PACKAGE_PROPERTY = {
  type: "string",
  description: "Monorepo: narrow to one package (else whole workspace).",
} as const;

export const TOOL_DEFINITIONS = [
  {
    name: "analyze",
    description:
      "Build the dependency graph from entry points; returns node count, categories, and cycles. Call before get_dependencies/get_dependents/get_affected/propose_tags. Empty entryPoints auto-detects a monorepo (pnpm/npm/yarn/Nx/Turborepo/Gradle/sbt): returns the layout at once, builds per-package graphs lazily on the first workspace-aware call — eager:true builds all up front. Whole-graph tools then run against the flattened workspace; pass package to narrow.",
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
        eager: {
          type: "boolean",
          description:
            "Monorepo only: build every package graph before returning (restores the { nodeCount, categories, cycles } payload) instead of the fast layout-only response. Default false.",
        },
        packages: {
          type: "array",
          items: { type: "string" },
          description:
            "Monorepo only: restrict the build to these package names or relative roots. The escape hatch for very large monorepos.",
        },
        cycleKinds: {
          type: "array",
          items: { type: "string", enum: ["docReference", "samePackage"] },
          description:
            "Include normally-filtered cycle edge kinds in the `cycles` output: 'docReference' (Markdown doc cross-links, ADR-009), 'samePackage' (JVM same-package siblings). Default: none — only genuine import cycles are reported.",
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
      "Get all files transitively affected if a given file changes — full incoming traversal upward. Use before a refactor to understand blast radius. On a monorepo root, blast radius is fully transitive across packages. See docs/mcp.md for the testsOnly, cached, changedSymbols, and withMeta options.",
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
    name: "compare_branches",
    description:
      "Compare the current graph (root) against baseRef, for reviewing a PR/branch: file diff, stale post-rename references, and deltas for duplication, complexity, doc drift, and coverage/risk hotspots. Returns a compact summary by default (verdict + headline + capped delta lists); pass detail:'full' for every entry. Monorepo root: whole flattened workspace, no entryPoints. See docs/mcp.md. Requires a prior analyze() call.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Absolute path to the project root" },
        baseRef: {
          type: "string",
          description: "Git ref to compare against, e.g. 'main', 'origin/main', or a commit sha",
        },
        headRef: {
          type: "string",
          description:
            "Git ref to label the head side of the comparison (default: 'HEAD'). The graph itself always comes from the already-analyzed root, not a checkout of this ref.",
        },
        entryPoints: {
          type: "array",
          items: { type: "string" },
          description:
            "Entry points to build the base-ref graph from, relative to root. Defaults to the entry points from the last analyze() call for this root.",
        },
        minDuplicateLines: {
          type: "number",
          description:
            "Minimum duplicated block size, in source lines, for the duplication delta (default: 6)",
        },
        complexityMetric: {
          type: "string",
          enum: ["cognitiveComplexity", "complexity"],
          description:
            "Which per-function score drives the complexity delta (default: cognitiveComplexity)",
        },
        complexityThreshold: {
          type: "number",
          description: "Minimum per-function score to count as a complexity hotspot (default: 10)",
        },
        maxCoveragePct: {
          type: "number",
          description:
            "Maximum containing-file coverage % to count as a risk hotspot (default: 50)",
        },
        detail: {
          type: "string",
          enum: ["summary", "full"],
          description:
            "'summary' (default): verdict, headline, and each delta list capped at maxItems with true counts; empty sections omitted. 'full': the complete BranchComparison with every entry.",
        },
        maxItems: {
          type: "number",
          description:
            "In summary mode, max entries kept per delta list (complexity/duplication/doc-drift/coverage); the true count is always reported alongside (default: 8). Stale references are never truncated.",
        },
      },
      required: ["root", "baseRef"],
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
        package: FAN_OUT_PACKAGE_PROPERTY,
      },
      required: ["root"],
    },
  },
  {
    name: "list_tags",
    description:
      "Discover tag:<name> values. Bounded: capped at 250 tags, no full mode. Default = comment-marker + import kinds, count>=2, top 50, plus a byKind histogram over all kinds, totalDistinct and a hint. Narrow with kind, prefix or minCount. See docs/mcp.md.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Absolute path to the project root" },
        kind: {
          type: "string",
          enum: ["comment-marker", "import", "function", "variable", "library", "all"],
          description:
            'One tag kind, or "all" — overrides the default comment-marker+import filter. import/library = per-imported file/package on tests; function/variable = declaration names.',
        },
        prefix: { type: "string", description: "Case-insensitive substring match on the name." },
        minCount: { type: "number", description: "Min node count per tag (default 2)." },
        limit: { type: "number", description: "Max tags returned (default 50, max 250)." },
        package: FAN_OUT_PACKAGE_PROPERTY,
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
        package: FAN_OUT_PACKAGE_PROPERTY,
      },
      required: ["root"],
    },
  },
  {
    name: "check_doc_drift",
    description:
      "Find markdown docs whose referenced files changed more recently than the doc itself — a commit-recency heuristic for stale docs, not a content diff. Requires a prior analyze() with gitStats: true in mokosh.config (else no commit-timestamp data, nothing flagged). See docs/adr-009-markdown-parsing.md for limitations.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Absolute path to the project root" },
        package: FAN_OUT_PACKAGE_PROPERTY,
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
        package: FAN_OUT_PACKAGE_PROPERTY,
      },
      required: ["root"],
    },
  },
  {
    name: "find_risk_hotspots",
    description:
      "Find functions that are complex, in a poorly-covered file, and — when gitStats is enabled in mokosh.config — frequently changed. Requires a prior analyze() and coverageReportPath in mokosh.config; errors if no coverage loaded. Churn filtering is skipped (churnDataAvailable: false) without gitStats, since complexity + low coverage alone is still a meaningful signal.",
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
        package: FAN_OUT_PACKAGE_PROPERTY,
      },
      required: ["root"],
    },
  },
  {
    name: "find_duplicates",
    description:
      "Find duplicated code, largest-first. Summary-first: default = `summary` + `clusters` preview + `hint`, no `groups`. Narrow with `filter`; `view` adds groups. Requires analyze().",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Absolute path to the project root" },
        minLines: {
          type: "number",
          description: "Min duplicated block size in lines (default 6)",
        },
        ignoreLiterals: {
          type: "boolean",
          description: "Normalize string/number literals (default true); false = exact text.",
        },
        maxPunctuationRatio: {
          type: "number",
          description: "Max object/array-punctuation fraction (default 0.5); 1 disables.",
        },
        ignoreDirs: {
          type: "array",
          items: { type: "string" },
          description:
            "Directory names to exclude (default: DEFAULT_IGNORE_DIRS + config). [] disables.",
        },
        limit: {
          type: "number",
          description: "Max clusters/groups returned (default 20); ignored for the summary view.",
        },
        includeGenerated: {
          type: "boolean",
          description: "Scan generated/vendored files too (default false). signals:['generated'].",
        },
        includeSameFile: {
          type: "boolean",
          description: "Include single-file matches (default false). signals:['same-file'].",
        },
        includeSvgMarkup: {
          type: "boolean",
          description:
            "Include inline-SVG/JSX-markup matches (default false). signals:['svg-markup'].",
        },
        scope: {
          type: "string",
          enum: ["src", "tests", "all"],
          description:
            "Test-file dups (default 'src'): 'src' drops test clusters, 'tests' only substantive test logic, 'all' keeps all.",
        },
        includeDocs: {
          type: "boolean",
          description: "Include markdown-family matches (default false). signals:['docs'].",
        },
        filter: {
          type: "string",
          description:
            "key:value result filter (AND across keys): path, allPaths, family, type, kind, defKind, min/maxLines, min/maxScore, minOccurrences, crossFile, signal ('!' negates), sort, sortDir, limit. See docs/query.md.",
        },
        view: {
          type: "string",
          enum: ["summary", "groups", "full"],
          description:
            "'summary' (default): clusters preview + hint, no groups. 'groups': raw spans, no clusters. 'full': both, groups de-duped vs clusters.",
        },
        slim: {
          type: "boolean",
          description:
            "Compact response (default true): terse groups, 'path:start-end' occurrences, clusters carry longestMatchAt not group bodies. false = full.",
        },
        package: FAN_OUT_PACKAGE_PROPERTY,
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
        base: {
          type: "string",
          description:
            "Diff against this ref (e.g. 'origin/main') instead of only local working-tree/staged/untracked changes. Ignored when changedFiles is given. Needed in CI, where the checkout is already clean.",
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
        package: FAN_OUT_PACKAGE_PROPERTY,
      },
      required: ["root"],
    },
  },
  {
    name: "query",
    description:
      "Filter the graph by category, tag, path, or other node metadata. Returns matching nodes as JSON or a Mermaid diagram. If entryPoints is omitted the cached graph from a prior 'analyze' call is used. On a monorepo root: runs against the flattened workspace (global sort/limit, cross-package edges, per-node package); package:<name> narrows. See docs/mcp.md for the full query DSL reference.",
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
            "Query string e.g. 'category:logic' or 'category:logic,tag:auth'. Keys: category, type, tag, path, package, external, importsFile, importedBy, min/maxImports, min/maxSize, hasDocstring, min/maxCoverage, min/maxExportUsage, min/maxComplexity, min/maxCognitiveComplexity, min/maxCommits, isDocumented, isStale, lastAuthor. OR: any(k:v|k:v). sort: size|imports|commitCount90d|exportUsage|complexity|cognitiveComplexity + sortDir asc|desc. limit: N. Full reference: docs/query.md.",
        },
        mermaid: { type: "boolean", description: "Return a Mermaid diagram (default: false)" },
        slim: {
          type: "boolean",
          description:
            "Compact response mode (default: true). Export names, meaningful tags (comment-marker + import kinds only), and a flat importsFiles path list — no edge objects, no mtime/size. Pass slim: false for every tag kind and full edge metadata; use list_tags (bounded; its byKind histogram shows per-kind totals) to discover tag names.",
        },
        package: {
          type: "string",
          description: "Monorepo: narrow to one package (same as a package:<name> filter clause).",
        },
      },
      required: ["root", "filter"],
    },
  },
  {
    name: "get_workspace_packages",
    description:
      "List workspace packages in a monorepo: name, relativeRoot, dependsOn. Reads repo layout + package.json manifests alone — no analyze(), no graph build, fast on large monorepos. Per-package nodeCount (and exact dependsOn edges for Gradle/sbt) appear only when a prior analyze() built the workspace graph; check the dependsOnResolved / nodeCountsResolved flags.",
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
      "Cross-package blast-radius analysis: files affected if a given file changes, grouped by owning package with each package's sample list capped (counts stay exact). For the full uncapped list call get_affected on the same file. Requires a prior analyze() with empty entryPoints on a monorepo root.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Absolute path to the monorepo root" },
        file: {
          type: "string",
          description:
            "Monorepo-root-relative path of the changed file (e.g. 'packages/shared/src/utils.ts')",
        },
        maxFilesPerPackage: {
          type: "number",
          description: "Cap each package's sample list (default 10; 0 = counts only).",
        },
      },
      required: ["root", "file"],
    },
  },
  {
    name: "get_type_graph",
    description:
      "Type-level relationships. Without a type name: an inventory of all interfaces, classes, enums and type aliases with their file and kind. With a type name: which files import it (usedByFiles) and which types the defining file imports (uses). Requires a prior analyze(). TypeScript/JavaScript only.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Absolute path to the project root" },
        type: {
          type: "string",
          description:
            "Exact exported name of the type to look up (e.g. 'FileNode'). Omit to get the full type inventory.",
        },
        package: SINGLE_PACKAGE_PROPERTY,
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
        package: FAN_OUT_PACKAGE_PROPERTY,
      },
      required: ["root"],
    },
  },
  {
    name: "get_feature_graph",
    description:
      "Group files by domain: which files each feature hub (high-import orchestrator) transitively owns. Each file goes to the most specific hub that can reach it (lowest out-degree wins). Prefer over a full query for 'what files are in feature X?' — returns only paths grouped by hub, so it's smaller than a full graph query for the same question.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Absolute path to the project root" },
        minOutDegree: {
          type: "number",
          description:
            "Minimum internal imports a file must have to qualify as a feature hub (default: 5).",
        },
        package: SINGLE_PACKAGE_PROPERTY,
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
        package: SINGLE_PACKAGE_PROPERTY,
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
        package: FAN_OUT_PACKAGE_PROPERTY,
      },
      required: ["root", "name"],
    },
  },
  {
    name: "get_api_surface",
    description:
      "API surface report: exported symbols resolved to defining file + kind, plus internalFiles / unreachableFromEntry / testFiles partitions. Needs a prior analyze(). Entry points auto-detect from package.json exports/bin/main (JS/TS) or every non-test source file (Go/Python/JVM). Summary-first: view 'summary' (default) = counts + byKind + a capped sample + the short unreachableFromEntry list; 'exports'/'full' widen it. Monorepo root without `package`: per-package breakdown + `skipped`. See docs/mcp.md.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Absolute path to the project root" },
        entryPoints: {
          type: "array",
          items: { type: "string" },
          description: "Public entry-point paths. Omit to auto-detect (exports / bin / main).",
        },
        package: FAN_OUT_PACKAGE_PROPERTY,
        view: {
          type: "string",
          enum: ["summary", "exports", "full"],
          description: "summary (default) | exports (+full publicExports) | full (+path lists).",
        },
        maxExports: {
          type: "number",
          description: "view 'summary': cap the {name,kind} sample (default 30).",
        },
        maxExportsPerPackage: {
          type: "number",
          description:
            "Monorepo, no `package`: cap each package's sample (default 10; 0 = counts).",
        },
      },
      required: ["root"],
    },
  },
  {
    name: "clear_cache",
    description:
      "Drop the cached dependency graph and mokosh.config.json for a root, forcing the next analyze() to rebuild from disk and re-read config. Call after editing source files or mokosh.config.json mid-session — otherwise get_affected, get_dependencies and other query tools reason from stale data.",
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
        package: FAN_OUT_PACKAGE_PROPERTY,
      },
      required: ["root"],
    },
  },
] as const;
