/** Minimal, best-effort XML tag/attribute extraction shared by the JaCoCo (Gradle) and scoverage
 *  (sbt) coverage report parsers — same regex-based "good enough for well-formed build-tool
 *  output" approach the lock-file readers (`src/parser/lockfile/gradle.ts`, `sbt.ts`) already
 *  use, rather than pulling in a full XML parser dependency for two known, simple report
 *  formats. */

/**
 * @description Returns every opening tag (self-closing or not) named `tagName` found in `xml`,
 *   as the raw tag text (`<tagName attr="v" .../>` or `<tagName attr="v">`) — good enough to
 *   then pull individual attributes with {@link extractAttr}. Does not handle nested tags of the
 *   same name specially; each opening tag is matched independently.
 * @param xml - Raw XML text.
 * @param tagName - Tag name to match, without angle brackets.
 * @returns Array of matched opening-tag strings, in document order.
 */
export function extractTags(xml: string, tagName: string): string[] {
  const re = new RegExp(`<${tagName}\\b[^>]*>`, "g");
  return xml.match(re) ?? [];
}

/**
 * @description Extracts one attribute's value from a raw tag string.
 * @param tag - A tag string as returned by {@link extractTags}.
 * @param attrName - Attribute name to read.
 * @returns The attribute value, or `null` if absent.
 */
export function extractAttr(tag: string, attrName: string): string | null {
  const match = new RegExp(`\\b${attrName}="([^"]*)"`).exec(tag);
  return match?.[1] ?? null;
}
