/** Parses Markdown/MDX files using remark to extract references to project files as import edges. */
import type { ImportEdge } from "../../types/node";
import type { ParseResult } from "../types";

/** Minimal shape of an mdast node — avoids depending on `@types/mdast` for a handful of fields. */
interface MdastNode {
  type: string;
  url?: string;
  value?: string;
  children?: MdastNode[];
}

const EXTERNAL_LINK_PREFIXES = ["http://", "https://", "mailto:", "//"];

const CODE_EXTENSIONS =
  "ts|tsx|js|jsx|mjs|cjs|py|go|lua|css|scss|less|styl|coffee|ls|feature|md|mdx|json";
const PATH_TOKEN_PATTERN = new RegExp(
  `(?:\\.{1,2}/)?[\\w.-]+(?:/[\\w.-]+)*\\.(?:${CODE_EXTENSIONS})\\b`,
  "g",
);

let processorPromise: Promise<{ parse(content: string): MdastNode }> | undefined;

/**
 * @description Lazily creates and caches a unified processor configured with `remark-parse`.
 *   Both packages are ESM-only, so they're loaded via dynamic import from this CommonJS codebase.
 * @returns A processor whose synchronous `parse()` yields an mdast tree.
 */
async function getProcessor(): Promise<{ parse(content: string): MdastNode }> {
  processorPromise ??= (async () => {
    const { unified } = await import("unified");
    const remarkParse = (await import("remark-parse")).default;
    return unified().use(remarkParse) as unknown as { parse(content: string): MdastNode };
  })();
  return processorPromise;
}

/**
 * @description Returns true when a markdown link target points outside the project
 *   (web URL, mailto, protocol-relative) or is a same-page anchor rather than a file reference.
 * @param url - The raw `url` field from an mdast `link` node.
 * @returns `true` if the link should be skipped rather than treated as a file reference.
 */
function isExternalLink(url: string): boolean {
  const trimmed = url.trim();
  return (
    trimmed.length === 0 ||
    trimmed.startsWith("#") ||
    EXTERNAL_LINK_PREFIXES.some((p) => trimmed.startsWith(p))
  );
}

/**
 * @description Scans the text of a code span or fenced code block for path-like tokens
 *   (e.g. `src/auth/reset.ts`), since docs commonly reference files this way in prose.
 * @param text - Raw text content of an mdast `code` or `inlineCode` node.
 * @param filePath - Path of the markdown file being parsed, used as `fromPath` on each edge.
 * @returns One `ImportEdge` per distinct path-like token found.
 */
function edgesFromCodeText(text: string, filePath: string): ImportEdge[] {
  const matches = text.match(PATH_TOKEN_PATTERN);
  if (!matches) return [];
  return matches.map((specifier) => ({
    fromPath: filePath,
    toPath: "",
    rawSpecifier: specifier,
    isStyle: false,
    type: "static" as const,
  }));
}

/**
 * @description Recursively walks an mdast tree collecting candidate file references from
 *   `link` node URLs and `code`/`inlineCode` node text.
 * @param node - Current mdast node (root or any content node).
 * @param filePath - Path of the markdown file being parsed, used as `fromPath` on each edge.
 * @param edges - Accumulator array mutated in place.
 */
function walk(node: MdastNode, filePath: string, edges: ImportEdge[]): void {
  if (node.type === "link" && typeof node.url === "string" && !isExternalLink(node.url)) {
    edges.push({
      fromPath: filePath,
      toPath: "",
      rawSpecifier: node.url,
      isStyle: false,
      type: "static",
    });
  }
  if ((node.type === "code" || node.type === "inlineCode") && typeof node.value === "string") {
    edges.push(...edgesFromCodeText(node.value, filePath));
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) walk(child, filePath, edges);
  }
}

/**
 * @description Parses a Markdown/MDX file into a `ParseResult` whose `imports` are candidate
 *   references to project files (from links and code spans/blocks). Markdown has no export or
 *   tag concept, so those arrays are always empty — mirroring the style-parser precedent.
 * @param filePath - Path of the markdown file being parsed.
 * @param content - Raw markdown source.
 * @returns A `ParseResult` with deduplicated import edges and `category: "other"`.
 */
export async function parseMarkdown(filePath: string, content: string): Promise<ParseResult> {
  const processor = await getProcessor();
  const tree = processor.parse(content);

  const edges: ImportEdge[] = [];
  walk(tree, filePath, edges);

  const seen = new Set<string>();
  const imports = edges.filter((edge) => {
    if (seen.has(edge.rawSpecifier)) return false;
    seen.add(edge.rawSpecifier);
    return true;
  });

  return { imports, exports: [], tags: [], category: "other" };
}
