/** CLI usage and options text, displayed with --help or when no arguments are given. */
export const HELP_TEXT = `
Usage: mokosh [options] <entry-point1> <entry-point2> ...

Options:
  --cache [file]              Path to cache file (default: mokosh-cache/graph.json)
  --config <file>             Path to mokosh config file (overrides auto-discovery)
  --mermaid                   Output Mermaid chart instead of JSON
  --propose-tags              Propose test tags based on git diff
  --plain                     Output tags as plain text instead of JSON (use with --propose-tags)
  --affected-tests            List test files affected by git diff
  --apply-tags                Write @tag annotations into test files from graph tags
  --dry-run                   Preview tag changes without writing to disk (use with --apply-tags)
  --detect-features           Output files with high out-degree (orchestrators/aggregators)
  --feature-threshold <N>     Min internal imports to be a feature hub (default: 5)
  --find-unused               Find files that are not reachable from entry points
  --exclude-tests             Exclude test files from --find-unused output
  --check-cycles              Check for circular dependencies; exits non-zero if found (CI gate)
  --type-graph                Output type-level graph (interfaces, classes, enums, type aliases)
  --type <name>               Filter --type-graph to a single type name
  --module-responsibility     Output each file's semantic role, description, and exports
  --paths <a,b,...>           Comma-separated file paths to filter --module-responsibility output
  --min-out-degree <N>        Min internal imports for hub detection (--module-responsibility, --feature-graph)
  --feature-graph             Group files into feature domains under their hub orchestrators
  --call-graph                Look up callers and callees for a named function
  --function <name>           Function name to look up with --call-graph
  --api-surface               Output the public API surface (expands export * chains)
  --silent                    Suppress progress output on stderr
  --query <query>             Filter output using a query (e.g., category:logic,tag:auth)
  --query-help                Show all supported query filter keys and examples
  --root <dir>                Project root directory (default: current directory)
  --help                      Show help

Notes:
  Add mokosh-cache/ to your .gitignore to avoid committing the cache directory.
`;

/** Reference for all supported --query filter keys, shown with --query-help. */
export const QUERY_HELP_TEXT = `
Query filter reference  (--query "key:value,key:value,...")
All keys are case-insensitive. Multiple keys are AND'd together.

FILTERING
  category:<value>       Exact match on file category. Negate with !.
                         Values: logic | ui | test | config | barrel | type-only | other
                         Examples: category:logic   category:!test

  type:<value>           Exact match on language. Negate with !.
                         Values: typescript | javascript | css | scss | less | stylus |
                                 coffeescript | livescript | lua | gherkin
                         Example: type:typescript

  tag:<value>            File has this tag (OR across multiple tag: entries).
                         Negate with ! to exclude.  Use + to require all (AND).
                         Examples: tag:auth          (has "auth")
                                   tag:!generated    (does not have "generated")
                                   tag:auth+core     (has both "auth" AND "core")

  path:<substr>          File path contains substring. Negate with !.
                         Examples: path:src/api   path:!__tests__

  external:<bool>        true = node has at least one external (node_modules) import.
                         Example: external:true

  importsFile:<substr>   Node directly imports a file whose path contains the substring.
                         Example: importsFile:src/utils/logger

  importedBy:<substr>    Node is directly imported by a file whose path contains the substring.
                         Example: importedBy:src/index

  minImports:<N>         Out-degree (direct import count) >= N.
  maxImports:<N>         Out-degree <= N.
                         Examples: minImports:5   maxImports:2

  minSize:<bytes>        File size >= N bytes.
  maxSize:<bytes>        File size <= N bytes.
                         Examples: minSize:1024   maxSize:4096

  hasDocstring:<bool>    true = node has a JSDoc description on its first statement.
                         false = undocumented files only.
                         Example: hasDocstring:false

SORTING & LIMITING  (applied after all filters)
  sort:<field>           Sort results descending by one of:
                           size           — file size in bytes
                           imports        — number of direct imports
                           commitCount90d — commits in the last 90 days (requires gitStats: true)
                         Example: sort:imports

  limit:<N>              Return at most N results.
                         Example: limit:20

COMMON PATTERNS
  Token-efficient context (logic only):
    --query "category:logic"

  Undocumented logic files:
    --query "category:logic,hasDocstring:false"

  10 most-imported files in a subsystem:
    --query "path:src/api,sort:imports,limit:10"

  Files using a specific library:
    --query "tag:react,category:logic"

  Files that import a specific module:
    --query "importsFile:src/auth/session"

  Large TypeScript logic files:
    --query "type:typescript,category:logic,sort:size,limit:5"
`;
