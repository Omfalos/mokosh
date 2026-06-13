/** Parses Gherkin .feature files to extract scenario tag annotations using the official Cucumber parser. */
import { AstBuilder, GherkinClassicTokenMatcher, Parser } from "@cucumber/gherkin";
import { IdGenerator } from "@cucumber/messages";
import { registerParser } from "../registry";
import type { ParseResult } from "../types";

const uuidFn = IdGenerator.uuid();

/**
 * @description Parses a Gherkin `.feature` file using the official Cucumber AST builder.
 *   Walks the feature, scenario, example, and rule hierarchy to collect all `@tag` annotations.
 *   Gherkin files are always categorized as `"test"`.
 * @param _filePath - Path to the feature file; used only in error messages.
 * @param content - Raw Gherkin source text.
 * @returns A `ParseResult` with no imports, no exports, all collected tags, and category `"test"`.
 */
export function parseGherkin(_filePath: string, content: string): ParseResult {
  const rawTags = new Set<string>();

  try {
    const builder = new AstBuilder(uuidFn);
    const matcher = new GherkinClassicTokenMatcher();
    const parser = new Parser(builder, matcher);

    const gherkinDocument = parser.parse(content);

    if (gherkinDocument.feature) {
      // Feature tags
      gherkinDocument.feature.tags.forEach((tag) => {
        rawTags.add(tag.name.startsWith("@") ? tag.name.slice(1) : tag.name);
      });

      // Child tags (Scenarios, Rules, etc.)
      gherkinDocument.feature.children.forEach((child) => {
        if (child.scenario) {
          child.scenario.tags.forEach((tag) => {
            rawTags.add(tag.name.startsWith("@") ? tag.name.slice(1) : tag.name);
          });

          // Example tags
          child.scenario.examples.forEach((example) => {
            example.tags.forEach((tag) => {
              rawTags.add(tag.name.startsWith("@") ? tag.name.slice(1) : tag.name);
            });
          });
        }

        if (child.rule) {
          child.rule.children.forEach((ruleChild) => {
            if (ruleChild.scenario) {
              ruleChild.scenario.tags.forEach((tag) => {
                rawTags.add(tag.name.startsWith("@") ? tag.name.slice(1) : tag.name);
              });
            }
          });
        }
      });
    }
  } catch (error) {
    console.warn(`[GherkinParser] Failed to parse ${_filePath}:`, error);
  }

  return {
    imports: [],
    exports: [],
    tags: Array.from(rawTags).map((name) => ({ name, kind: "comment-marker" as const })),
    category: "test",
  };
}

registerParser("gherkin", parseGherkin);
