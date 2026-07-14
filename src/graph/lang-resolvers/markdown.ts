/** Language resolver for Markdown: resolves bare doc-style paths (e.g. `src/graph/builder.ts`), the project-root-relative convention used throughout mokosh's own docs, since those don't start with `.` or `/` and would otherwise fall through to "external". */
import path from "node:path";
import type { LangResolver, ResolvedImport } from "./types";

export class MarkdownLangResolver implements LangResolver {
  extensions = [".md", ".mdx"];

  /**
   * @description Treats a bare specifier as relative to the project root rather than the
   *   markdown file's own directory, by probing it against a dummy file inside `rootDir`.
   * @param {string} _currentFile - Absolute path of the markdown file (unused; resolution is root-relative).
   * @param {string} specifier - The raw bare specifier extracted from a link or code span, e.g. `"src/graph/builder.ts"`.
   * @param {string} rootDir - Absolute project root directory.
   * @param {Function} resolveLocal - Generic resolver callback for extension and index-file probing.
   * @returns {ResolvedImport[] | null} The resolved local file, or `null` to fall through to external.
   */
  resolve(
    _currentFile: string,
    specifier: string,
    rootDir: string,
    resolveLocal: (currentFile: string, specifier: string) => ResolvedImport | null,
  ): ResolvedImport[] | null {
    const resolved = resolveLocal(path.join(rootDir, "_dummy"), `./${specifier}`);
    return resolved ? [resolved] : null;
  }
}
