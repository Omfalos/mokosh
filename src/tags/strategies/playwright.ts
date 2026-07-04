/**
 * Tag applier strategy for Playwright: injects { tag: [...] } with @ prefix into
 * test.describe/test calls. Playwright uses the singular `tag` option (not `tags`) and
 * conventionally prefixes tag names with `@` (e.g. `@auth`, `@parseArgs`).
 * Filter at CI time with: `playwright test --grep @tagname`
 */
import path from "node:path";
import ts from "typescript";
import {
  applyReplacements,
  buildInjectReplacement,
  buildRemoveReplacement,
  findTopLevelCalls,
  readArrayProp,
  TS_EXTENSIONS,
  toArrayLiteral,
} from "./ts-ast-utils";
import type { TagApplierStrategy } from "./types";

function toPlaywrightLiteral(tags: string[]): string {
  // Playwright tag convention: prefix each name with '@'
  return toArrayLiteral(tags.map((t) => `@${t}`));
}

function normaliseExisting(raw: string[]): string[] {
  // Strip @ prefix so we can compare against unprefixed computed tags
  return raw.map((t) => (t.startsWith("@") ? t.slice(1) : t));
}

export class PlaywrightStrategy implements TagApplierStrategy {
  readonly name = "playwright";

  canHandle(absPath: string): boolean {
    return TS_EXTENSIONS.has(path.extname(absPath).toLowerCase());
  }

  apply(absPath: string, source: string, tags: string[]): string {
    const sf = ts.createSourceFile(path.basename(absPath), source, ts.ScriptTarget.Latest, true);
    const calls = findTopLevelCalls(sf);

    if (calls.length === 0) return source;

    // Idempotency: compare normalised existing tags with computed tags
    const rawExisting = readArrayProp(calls[0]!, "tag", sf);
    const sortedTags = [...tags].sort();
    if (
      rawExisting !== null &&
      JSON.stringify(normaliseExisting(rawExisting).sort()) === JSON.stringify(sortedTags)
    ) {
      return source;
    }

    const replacements = calls.flatMap((call) => {
      const r =
        tags.length === 0
          ? buildRemoveReplacement(call, "tag", sf)
          : buildInjectReplacement(call, "tag", toPlaywrightLiteral(sortedTags), sf);
      return r ? [r] : [];
    });

    return replacements.length > 0 ? applyReplacements(source, replacements) : source;
  }
}
