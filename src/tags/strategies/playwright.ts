/**
 * Tag applier strategy for Playwright: injects { tag: [...] } with @ prefix into
 * test.describe/test calls. Playwright uses the singular `tag` option (not `tags`) and
 * conventionally prefixes tag names with `@` (e.g. `@auth`, `@parseArgs`).
 * Filter at CI time with: `playwright test --grep @tagname`
 */
import path from "node:path";
import { applyAtPrefixedTagProp, TS_EXTENSIONS } from "./ts-ast-utils";
import type { TagApplierStrategy } from "./types";

export class PlaywrightStrategy implements TagApplierStrategy {
  readonly name = "playwright";

  canHandle(absPath: string): boolean {
    return TS_EXTENSIONS.has(path.extname(absPath).toLowerCase());
  }

  apply(absPath: string, source: string, tags: string[]): string {
    return applyAtPrefixedTagProp(absPath, source, tags, "tag");
  }
}
