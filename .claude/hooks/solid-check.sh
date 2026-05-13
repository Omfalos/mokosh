#!/bin/bash
# Injected after Edit/Write — triggers SOLID analysis for TS/JS files only.
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // .input.file_path // empty' 2>/dev/null)
if [[ "$FILE" =~ \.(ts|tsx|js|jsx|mts|cts)$ ]]; then
  echo "SOLID: Analyze $FILE for SOLID violations per the /solid skill rules. Stay silent if clean."
fi