#!/bin/bash
# Injected after Edit/Write — scans TS/JS files for single-letter identifiers.
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // .input.file_path // empty' 2>/dev/null)

if [[ ! "$FILE" =~ \.(ts|tsx|js|jsx|mts|cts)$ ]]; then
  exit 0
fi

if [[ ! -f "$FILE" ]]; then
  exit 0
fi

if ! command -v perl >/dev/null 2>&1; then
  exit 0
fi

# Uses perl (not `grep -P`) for PCRE support — BSD grep on macOS lacks -P, which would
# silently no-op this whole check in a plain hook subprocess.

# Likely single-letter identifiers — arrow params, const/let/var decls, catch bindings.
# Excludes: loop counters (i/j/k in for), discard (_), generic type params (T/K/V/E/R/N/P/S/U/W).
HITS=$(perl -ne '
  print "$ARGV:$.:$_"
    if (/(\(|,\s*)\b([a-wyzA-Z])\b(\s*[,):?]|\s*=>)|\b(?:const|let|var)\s+([a-z])\s*[=;:]|catch\s*\(\s*([a-z])\s*\)/)
    && !/^\s*for\s*\(/
    && !/\b[TKVERNS]\b/
    && !/\b_\b/;
' "$FILE" 2>/dev/null)

if [[ -n "$HITS" ]]; then
  echo "RENAME-SINGLES: Single-letter identifiers found in $FILE — apply /rename-singles to fix them:"
  echo "$HITS"
fi

# Denylist of specific 2-3 char abbreviations known to be unclear out of context.
# NOT a length-based rule — most short names in this codebase (abs, dir, ext, rel,
# pkg, src, raw, ctx, arg, key, map, hub, sig, ret, fn, doc, git, pct, ...) are
# established, self-explanatory conventions and must not be flagged. Add to this
# list only when a specific abbreviation is found to be genuinely unclear (e.g.
# `wg` for WorkspaceGraph, caught in review — see [[feedback_short_variable_names]]).
DENYLIST=(wg)

DENY_HITS=""
for name in "${DENYLIST[@]}"; do
  match=$(perl -ne '
    print "$ARGV:$.:$_"
      if /\b(?:const|let|var)\s+'"$name"'\s*[=;:]|catch\s*\(\s*'"$name"'\s*\)|\((?:.*,\s*)?'"$name"'\s*[,):]/;
  ' "$FILE" 2>/dev/null)
  if [[ -n "$match" ]]; then
    DENY_HITS+="$match"$'\n'
  fi
done

if [[ -n "$DENY_HITS" ]]; then
  echo "RENAME-SINGLES: Known-unclear short identifiers found in $FILE — apply /rename-singles to fix them:"
  echo "$DENY_HITS"
fi