/** Declaration keywords a leading doc comment may document, after annotations and modifiers. */
const DOCUMENTED_DECL_RE =
  /^\s*(?:@[\w.]+(?:\([^)]*\))?\s+)*(?:[a-z]+\s+)*(?:class|interface|object|enum|typealias|fun|trait|record|@interface)\b/;

/**
 * @description Extracts the file-level description of a Kotlin/Java source file: the first
 *   paragraph of the first `/** … *​/` doc comment that directly precedes a declaration
 *   (annotations and modifiers allowed in between). Plain `/* … *​/` license headers never match.
 *   Block tags (`@param`, `@see`, …) end the description; `{@link X}` is reduced to `X`.
 * @param {string} source - Raw file content.
 * @returns {string | undefined} The description, or `undefined` when no documenting KDoc/Javadoc exists.
 */
export function extractLeadingDoc(source: string): string | undefined {
  for (const match of source.matchAll(/\/\*\*([\s\S]*?)\*\//g)) {
    const after = source.slice((match.index ?? 0) + match[0].length);
    if (!DOCUMENTED_DECL_RE.test(after)) continue;
    const lines = (match[1] ?? "").split("\n").map((line) => line.replace(/^\s*\*?\s?/, "").trim());
    const paragraph: string[] = [];
    for (const line of lines) {
      if (line.startsWith("@")) break;
      if (line === "") {
        if (paragraph.length > 0) break;
        continue;
      }
      paragraph.push(line);
    }
    const text = paragraph
      .join(" ")
      .replace(/\{@(?:link|code|linkplain)\s+([^}]+)\}/g, "$1")
      .replace(/\[([^\]]+)\]/g, "$1")
      .trim();
    return text || undefined;
  }
  return undefined;
}
