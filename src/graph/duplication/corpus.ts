import { readFile } from "node:fs/promises";
import path from "node:path";
import type Piscina from "piscina";
import { typesInFamily } from "../../languages";
import { LOCK_FILE_NAMES } from "../../parser/lockfile";
import type { FileNode } from "../../types/node";
import type { FileType } from "../../types/parse";
import type { Graph } from "../model";
import { type DuplicateFamily, getDuplicateFamily } from "./families";
import { hasGeneratedMarker, isGeneratedPath } from "./generated";
import type { FileTokens } from "./shingle";
import type { StyleSourceFile } from "./style-blocks";
import type { DuplicationTokenCache } from "./token-cache-store";
import { type NormalizedToken, tokenize } from "./tokenizer";
import type { TypeScriptSourceFile } from "./type-defs";

/** JS-like languages whose source feeds the JSX/object-literal/type-def duplicate extractors. */
const JS_FAMILY = typesInFamily("js");

/** CSS-family types with a shared PostCSS AST available — routed through the structural rule-body
 *  comparator instead of the generic token-shingle pipeline. Stylus has no such AST here, so it
 *  stays on the token-shingle path (still isolated to the `"style"` family, see `families.ts`). */
export const STRUCTURAL_STYLE_TYPES: ReadonlySet<FileType> = new Set<FileType>([
  "css",
  "scss",
  "less",
]);

/**
 * @description Lock files (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`) contain large
 *   blocks of genuinely repeated JSON/YAML structure — every dependency entry looks like every
 *   other one — but that's not code duplication, and it swamps real findings by sheer line
 *   count. Excluded regardless of `ignoreDirs`, since lock files sit at the project root, not in
 *   an ignorable directory.
 * @param relPath - Project-relative file path.
 * @returns Whether `relPath`'s basename is a known lock file.
 */
function isLockFile(relPath: string): boolean {
  return LOCK_FILE_NAMES.includes(path.basename(relPath));
}

/**
 * @description Whether any path segment of `relPath` matches an ignored directory name.
 * @param relPath - Project-relative file path.
 * @param ignoreDirs - Directory names to treat as excluded.
 * @returns `true` if `relPath` lives under one of `ignoreDirs`.
 */
function isUnderIgnoredDir(relPath: string, ignoreDirs: readonly string[]): boolean {
  if (ignoreDirs.length === 0) return false;
  const ignored = new Set(ignoreDirs);
  return relPath.split(path.sep).some((segment) => ignored.has(segment));
}

/**
 * @description The per-scan input every duplicate strategy reads from: the candidate files after
 *   loading, tokenizing, generated-file filtering and token-cache reuse, bucketed by what each
 *   strategy needs.
 */
export interface ScanCorpus {
  /** CSS/SCSS/Less sources for the structural rule-body comparator and style-var extractor. */
  structuralStyleFiles: StyleSourceFile[];
  /** TS ∪ JS sources — shared input for type-def, object-literal and JSX-element extraction. */
  jsLikeFiles: TypeScriptSourceFile[];
  /** Normalized token streams per language family — the suffix-array matcher's input. */
  filesByFamily: Map<DuplicateFamily, FileTokens[]>;
  /** Paths kept only because `includeGenerated: true`; used to tag matches `"generated"`. */
  generatedPaths: Set<string>;
  /** Total line count per scanned file, for per-file cluster coverage. */
  fileLineCounts: Map<string, number>;
  /** Retained source text per JS/TS file, for the `"svg-markup"` signal. */
  sourceByFile: Map<string, string>;
}

/** The subset of `FindDuplicatesOptions` the corpus-loading phase depends on (Interface
 *  Segregation — it needs none of the matching or reporting options). */
export interface CorpusOptions {
  ignoreLiterals: boolean;
  includeGenerated: boolean;
  ignoreGlobs: readonly string[];
  tokenCache?: DuplicationTokenCache | undefined;
}

/**
 * @description Selects the graph nodes eligible for a duplicate scan: drops `type: "unknown"`
 *   assets, lock files and anything under an ignored directory.
 * @param graph - The graph to scan.
 * @param ignoreDirs - Directory names to exclude.
 * @returns The candidate `FileNode`s.
 */
export function selectCandidateNodes(graph: Graph, ignoreDirs: readonly string[]): FileNode[] {
  return [...graph.nodes.values()].filter(
    (node) =>
      node.type !== "unknown" &&
      !isLockFile(node.path) &&
      !isUnderIgnoredDir(node.path, ignoreDirs),
  );
}

/** One candidate file after loading: either a structural-style source or a tokenized code file. */
type LoadedFile =
  | { kind: "style"; node: FileNode; source: string; generated: boolean; lineCount: number }
  | {
      kind: "code";
      node: FileNode;
      tokens: NormalizedToken[];
      /** Source text, retained only for JS-family files (type-def/object-literal/JSX extraction). */
      source: string | undefined;
      generated: boolean;
      lineCount: number;
    };

/** Reads `relPath`; `undefined` when the file is listed in the graph but no longer readable
 *  (deleted/moved since the build). */
async function readSource(rootDir: string, relPath: string): Promise<string | undefined> {
  try {
    return await readFile(path.join(rootDir, relPath), "utf8");
  } catch {
    return undefined;
  }
}

/**
 * @description Loads a CSS/SCSS/Less file for the structural comparator.
 * @param node - The candidate node.
 * @param rootDir - Absolute project root.
 * @param pathGenerated - Whether the path alone marks the file generated.
 * @param includeGenerated - Whether generated files are kept.
 * @returns The loaded file, or `null` when unreadable or dropped as generated.
 */
async function loadStyleFile(
  node: FileNode,
  rootDir: string,
  pathGenerated: boolean,
  includeGenerated: boolean,
): Promise<LoadedFile | null> {
  const source = await readSource(rootDir, node.path);
  if (source === undefined) return null;
  const generated = pathGenerated || hasGeneratedMarker(source);
  if (generated && !includeGenerated) return null;
  return { kind: "style", node, source, generated, lineCount: source.split("\n").length };
}

/**
 * @description Loads and tokenizes a non-structural file, reusing the token cache when the entry's
 *   `mtime`/`size`/`ignoreLiterals` still match and offloading to the worker pool when provided.
 * @param node - The candidate node.
 * @param rootDir - Absolute project root.
 * @param pathGenerated - Whether the path alone marks the file generated.
 * @param options - Loading-phase options.
 * @param pool - Optional tokenizing worker pool.
 * @returns The loaded file, or `null` when unreadable or dropped as generated.
 */
async function loadCodeFile(
  node: FileNode,
  rootDir: string,
  pathGenerated: boolean,
  options: CorpusOptions,
  pool: Piscina | null,
): Promise<LoadedFile | null> {
  const { ignoreLiterals, includeGenerated, tokenCache } = options;
  const cached = tokenCache?.get(node.path);
  const cacheHit =
    cached &&
    cached.mtime === node.mtime &&
    cached.size === node.size &&
    cached.ignoreLiterals === ignoreLiterals;

  let tokens: NormalizedToken[];
  let generated: boolean;
  // Only populated on the non-cache-hit path: a cache hit skips reading the source entirely, so
  // JS-family files re-read it below for type-def extraction (an accepted extra read on the
  // minority repeated-call path, since type-def results aren't cached like tokens are).
  let source: string | undefined;
  if (cacheHit) {
    tokens = cached.tokens;
    generated = cached.generated;
  } else {
    source = await readSource(rootDir, node.path);
    if (source === undefined) return null;
    generated = pathGenerated || hasGeneratedMarker(source);
    if (generated && !includeGenerated) return null;
    tokens = pool
      ? await pool.run({ source, fileType: node.type, ignoreLiterals })
      : tokenize(source, node.type, ignoreLiterals);
    tokenCache?.set(node.path, {
      mtime: node.mtime,
      size: node.size,
      ignoreLiterals,
      generated,
      tokens,
    });
  }
  if (generated && !includeGenerated) return null;

  // Exact line count when freshly read; falls back to the last token's line on a cache hit — a
  // slight undercount if the file ends in blank lines, acceptable for a coverage estimate.
  const lineCount = source !== undefined ? source.split("\n").length : (tokens.at(-1)?.line ?? 0);

  // Type-def extraction is TS-only, but object-literal and JSX extraction run on every JS-family
  // file — const object literals are equally common in plain JS.
  if (JS_FAMILY.has(node.type) && source === undefined) {
    source = await readSource(rootDir, node.path);
  }
  return {
    kind: "code",
    node,
    tokens,
    source: JS_FAMILY.has(node.type) ? source : undefined,
    generated,
    lineCount,
  };
}

/**
 * @description Reads and tokenizes every candidate file (via the worker pool when provided, the
 *   token cache when it hits) and buckets the results into a {@link ScanCorpus}.
 * @param nodes - Candidate nodes from {@link selectCandidateNodes}.
 * @param rootDir - Absolute project root that node paths are relative to.
 * @param options - Loading-phase options.
 * @param pool - Optional tokenizing worker pool; `null` tokenizes in-process.
 * @returns The populated corpus.
 */
export async function collectCorpus(
  nodes: FileNode[],
  rootDir: string,
  options: CorpusOptions,
  pool: Piscina | null,
): Promise<ScanCorpus> {
  const { includeGenerated, ignoreGlobs, tokenCache } = options;
  const loaded = await Promise.all(
    nodes.map((node) => {
      const pathGenerated = isGeneratedPath(node.path, ignoreGlobs);
      if (pathGenerated && !includeGenerated) return null;
      return STRUCTURAL_STYLE_TYPES.has(node.type)
        ? loadStyleFile(node, rootDir, pathGenerated, includeGenerated)
        : loadCodeFile(node, rootDir, pathGenerated, options, pool);
    }),
  );

  // Paths kept only because `includeGenerated: true` — used to tag matches `"generated"`.
  const generatedPaths = new Set<string>();
  // Total line count per scanned file — powers clusters' per-file coverage % (see clusters.ts).
  const fileLineCounts = new Map<string, number>();
  const structuralStyleFiles: StyleSourceFile[] = [];
  const jsLikeFiles: TypeScriptSourceFile[] = [];
  const filesByFamily = new Map<DuplicateFamily, FileTokens[]>();

  for (const file of loaded) {
    if (!file) continue;
    const { node } = file;
    if (file.generated) generatedPaths.add(node.path);
    fileLineCounts.set(node.path, file.lineCount);
    if (file.kind === "style") {
      structuralStyleFiles.push({ file: node.path, source: file.source, fileType: node.type });
      continue;
    }
    if (file.source !== undefined) jsLikeFiles.push({ file: node.path, source: file.source });
    const family = getDuplicateFamily(node.type);
    const fileTokens: FileTokens = { file: node.path, tokens: file.tokens };
    const bucket = filesByFamily.get(family);
    if (bucket) bucket.push(fileTokens);
    else filesByFamily.set(family, [fileTokens]);
  }

  if (tokenCache) {
    // Drop entries for files no longer in this scan's candidate set (deleted, moved, or newly
    // excluded by ignoreDirs) so a long-lived session cache doesn't grow unboundedly.
    const current = new Set(nodes.map((node) => node.path));
    for (const cachedPath of tokenCache.keys()) {
      if (!current.has(cachedPath)) tokenCache.delete(cachedPath);
    }
  }

  const sourceByFile = new Map(jsLikeFiles.map((file) => [file.file, file.source]));
  return {
    structuralStyleFiles,
    jsLikeFiles,
    filesByFamily,
    generatedPaths,
    fileLineCounts,
    sourceByFile,
  };
}
