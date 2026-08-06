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
import { applyAtPrefixedTagProp, TS_EXTENSIONS } from "./ts-ast-utils";
import type { TagApplierStrategy } from "./types";

export class CypressStrategy implements TagApplierStrategy {
  readonly name = "cypress";

  canHandle(absPath: string): boolean {
    return TS_EXTENSIONS.has(path.extname(absPath).toLowerCase());
  }

  apply(absPath: string, source: string, tags: string[]): string {
    return applyAtPrefixedTagProp(absPath, source, tags, "tags");
  }
}
