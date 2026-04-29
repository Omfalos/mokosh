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
  --detect-features           Output files with high out-degree (orchestrators/aggregators)
  --feature-threshold <N>     Min internal imports to be a feature hub (default: 5)
  --find-unused               Find files that are not reachable from entry points
  --exclude-tests             Exclude test files from --find-unused output
  --check-cycles              Check for circular dependencies; exits non-zero if found (CI gate)
  --silent                    Suppress progress output on stderr
  --query <query>             Filter output using a query (e.g., category:logic,tag:auth)
  --root <dir>                Project root directory (default: current directory)
  --help                      Show help

Notes:
  Add mokosh-cache/ to your .gitignore to avoid committing the cache directory.
`;
