#!/usr/bin/env bash
# Runs only the test files affected by the current git diff, per mokosh's
# own dependency graph. Falls back to a no-op (not a full run) when nothing
# is affected, so an empty diff never accidentally triggers the full suite.
#
# Locally (dirty working tree), diffs against local uncommitted changes.
# In CI (clean checkout), pass a base ref so committed changes are picked up
# too, e.g.: scripts/test-affected.sh origin/main
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f dist/cli.js ]; then
  echo "dist/cli.js missing — run 'npm run build' first" >&2
  exit 1
fi

base_args=()
if [ -n "${1:-}" ]; then
  base_args=(--base "$1")
fi

files=()
while IFS= read -r line; do
  [ -n "$line" ] && files+=("$line")
done < <(node ./dist/cli.js src/index.ts src/cli.ts src/mcp.ts --affected-tests --plain --silent "${base_args[@]+"${base_args[@]}"}")

if [ ${#files[@]} -eq 0 ]; then
  echo "No affected tests for the current diff."
  exit 0
fi

echo "Running ${#files[@]} affected test file(s):"
printf '  %s\n' "${files[@]}"
npx vitest run "${files[@]}"
