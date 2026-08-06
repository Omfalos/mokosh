/**
 * @description Removes a single surrounding quote pair (`'` or `"`) from a string if one
 *   is present. Safe to call on already-unquoted values — returns the input unchanged.
 * @param value - The string to unquote.
 * @returns The unquoted string, or the original value if it was not quoted.
 */
export function stripQuotes(value: string): string {
  return value.startsWith("'") || value.startsWith('"') ? value.slice(1, -1) : value;
}

/**
 * @description Scans raw source text for `@tag <name>` comment annotations and collects the
 *   tag names. Shared across languages whose parser has no dedicated comment/annotation AST
 *   node (CoffeeScript, LiveScript, Lua), so tags are extracted via regex ahead of/instead of
 *   full parsing. Runs before category resolution so `@tag test` can influence classification.
 * @param content - Raw source text to scan.
 * @returns Set of tag name strings found in `@tag` annotations.
 */
export function extractTagAnnotations(content: string): Set<string> {
  const tags = new Set<string>();
  const tagRegex = /@tag\s+([a-zA-Z0-9_-]+)/g;
  let match = tagRegex.exec(content);
  while (match !== null) {
    if (match[1]) tags.add(match[1]);
    match = tagRegex.exec(content);
  }
  return tags;
}

/**
 * @description Determines whether a file is a test or production-logic file by checking
 *   path naming conventions (`.test.`, `.spec.`) and an explicit `@tag test` annotation. Shared
 *   classification rule for the regex-tagged languages (CoffeeScript, LiveScript, Lua).
 * @param filePath - Path to the file being classified.
 * @param tags - Tag names extracted from the file's content (see `extractTagAnnotations`).
 * @returns `"test"` if the file is a test file, `"logic"` otherwise.
 */
export function classifyTestOrLogic(filePath: string, tags: Set<string>): "test" | "logic" {
  const lower = filePath.toLowerCase();
  if (lower.includes(".test.") || lower.includes(".spec.") || tags.has("test")) {
    return "test";
  }
  return "logic";
}
