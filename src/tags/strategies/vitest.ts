/** Tag applier strategy for Vitest: injects { tags: [...] } into describe/test/it calls. */
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

// Strips legacy comment blocks written by older versions of mokosh.
const LEGACY_BLOCK_REGEX = /\/\/ <mokosh-tags>[\s\S]*?\/\/ <\/mokosh-tags>\n*/;

export class VitestStrategy implements TagApplierStrategy {
  readonly name = "vitest";

  canHandle(absPath: string): boolean {
    return TS_EXTENSIONS.has(path.extname(absPath).toLowerCase());
  }

  apply(absPath: string, source: string, tags: string[]): string {
    const stripped = source.replace(LEGACY_BLOCK_REGEX, "");
    const sf = ts.createSourceFile(path.basename(absPath), stripped, ts.ScriptTarget.Latest, true);
    const calls = findTopLevelCalls(sf);

    if (calls.length === 0) return stripped;

    // Idempotency check — if first call already has the exact sorted tags, nothing to do
    const existing = readArrayProp(calls[0]!, "tags", sf);
    const sortedTags = [...tags].sort();
    if (existing !== null && JSON.stringify([...existing].sort()) === JSON.stringify(sortedTags)) {
      return stripped;
    }

    const replacements = calls.flatMap((call) => {
      const r =
        tags.length === 0
          ? buildRemoveReplacement(call, "tags", sf)
          : buildInjectReplacement(call, "tags", toArrayLiteral(sortedTags), sf);
      return r ? [r] : [];
    });

    return replacements.length > 0 ? applyReplacements(stripped, replacements) : stripped;
  }
}
