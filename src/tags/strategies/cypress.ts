/**
 * Tag applier strategy for Cypress with @cypress/grep: injects { tags: ['@tag'] } into
 * describe/it/context calls.
 *
 * Requires: `npm install --save-dev @cypress/grep`
 * Setup: add `require('@cypress/grep/src/support')()` in cypress/support/e2e.ts
 * Filter at CI time with: `cypress run --env grepTags=@tagname`
 *
 * @see https://github.com/cypress-io/cypress/tree/develop/npm/grep
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

function toCypressLiteral(tags: string[]): string {
  // @cypress/grep convention: prefix each tag with '@'
  return toArrayLiteral(tags.map((tag) => `@${tag}`));
}

function normaliseExisting(raw: string[]): string[] {
  return raw.map((tag) => (tag.startsWith("@") ? tag.slice(1) : tag));
}

export class CypressStrategy implements TagApplierStrategy {
  readonly name = "cypress";

  canHandle(absPath: string): boolean {
    return TS_EXTENSIONS.has(path.extname(absPath).toLowerCase());
  }

  apply(absPath: string, source: string, tags: string[]): string {
    const sf = ts.createSourceFile(path.basename(absPath), source, ts.ScriptTarget.Latest, true);
    const calls = findTopLevelCalls(sf);

    if (calls.length === 0) return source;

    const rawExisting = readArrayProp(calls[0]!, "tags", sf);
    const sortedTags = [...tags].sort();
    if (
      rawExisting !== null &&
      JSON.stringify(normaliseExisting(rawExisting).sort()) === JSON.stringify(sortedTags)
    ) {
      return source;
    }

    const replacements = calls.flatMap((call) => {
      const replacement =
        tags.length === 0
          ? buildRemoveReplacement(call, "tags", sf)
          : buildInjectReplacement(call, "tags", toCypressLiteral(sortedTags), sf);
      return replacement ? [replacement] : [];
    });

    return replacements.length > 0 ? applyReplacements(source, replacements) : source;
  }
}
