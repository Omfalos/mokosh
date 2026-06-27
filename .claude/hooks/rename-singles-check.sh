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

# Grep for likely single-letter identifiers — arrow params, const/let/var decls, catch bindings.
# Excludes: loop counters (i/j/k in for), discard (_), generic type params (T/K/V/E/R/N/P/S/U/W).
HITS=$(grep -nP \
  '(\(|,\s*)\b([a-wyzA-Z])\b(\s*[,):?]|\s*=>)|\b(?:const|let|var)\s+([a-z])\s*[=;:]|catch\s*\(\s*([a-z])\s*\)' \
  "$FILE" \
  | grep -vP '^\s*(for\s*\()' \
  | grep -vP '\b[TKVERNS]\b' \
  | grep -vP '\b_\b' \
  2>/dev/null)

if [[ -n "$HITS" ]]; then
  echo "RENAME-SINGLES: Single-letter identifiers found in $FILE — apply /rename-singles to fix them:"
  echo "$HITS"
fi