/** Shared TypeScript AST helpers for framework-specific tag injection strategies. */
import ts from "typescript";

export interface Replacement {
  start: number;
  end: number;
  text: string;
}

const ANNOTATABLE_NAMES = new Set(["describe", "test", "it"]);

/** Returns top-level describe/test/it call expressions from a parsed source file. */
export function findTopLevelCalls(sourceFile: ts.SourceFile): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  for (const stmt of sourceFile.statements) {
    if (!ts.isExpressionStatement(stmt)) continue;
    const expr = stmt.expression;
    if (!ts.isCallExpression(expr)) continue;
    const callee = expr.expression;
    if (ts.isIdentifier(callee) && ANNOTATABLE_NAMES.has(callee.text)) {
      calls.push(expr);
    }
    // Also handle property-access forms: test.describe, test.skip, etc.
    if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      ANNOTATABLE_NAMES.has(callee.expression.text)
    ) {
      calls.push(expr);
    }
  }
  return calls;
}

/**
 * @description Reads an options-object argument from a call expression and extracts
 *   the value of a named array property (e.g. `tags` or `tag`).
 * @param {ts.CallExpression} call - The call expression to inspect.
 * @param {string} propName - Name of the property to read from the options object.
 * @param {ts.SourceFile} sf - Source file needed for position information.
 * @returns {string[] | null} The array contents, or null if the property is not found.
 */
export function readArrayProp(
  call: ts.CallExpression,
  propName: string,
  sf: ts.SourceFile,
): string[] | null {
  void sf; // used by callers for getStart/getEnd, not needed here
  for (const arg of call.arguments) {
    if (!ts.isObjectLiteralExpression(arg)) continue;
    const prop = arg.properties.find(
      (p): p is ts.PropertyAssignment =>
        ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === propName,
    );
    if (!prop || !ts.isArrayLiteralExpression(prop.initializer)) continue;
    return prop.initializer.elements.filter(ts.isStringLiteral).map((e) => e.text);
  }
  return null;
}

/**
 * @description Builds the source replacement needed to write an array property (e.g.
 *   `tags` or `tag`) into a single call expression. Handles three cases:
 *   1. No options arg yet — inserts `{ <prop>: <value> }, ` before the last argument.
 *   2. Options object exists with the property — replaces the array in-place.
 *   3. Options object exists without the property — appends it before the closing brace.
 * @param {ts.CallExpression} call - The call expression to modify.
 * @param {string} propName - Name of the options property to inject (e.g. `"tags"` or `"tag"`).
 * @param {string} tagsLiteral - The serialised array literal to write (e.g. `'["a", "b"]'`).
 * @param {ts.SourceFile} sf - Source file for position resolution.
 * @returns {Replacement | null} The replacement descriptor, or null when the call has no arguments.
 */
export function buildInjectReplacement(
  call: ts.CallExpression,
  propName: string,
  tagsLiteral: string,
  sf: ts.SourceFile,
): Replacement | null {
  if (call.arguments.length === 0) return null;

  for (let i = 1; i < call.arguments.length; i++) {
    const arg = call.arguments[i]!;
    if (!ts.isObjectLiteralExpression(arg)) continue;

    const existingProp = arg.properties.find(
      (p): p is ts.PropertyAssignment =>
        ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === propName,
    );

    if (existingProp) {
      return {
        start: existingProp.initializer.getStart(sf),
        end: existingProp.initializer.getEnd(),
        text: tagsLiteral,
      };
    }

    const closeBrace = arg.getEnd() - 1;
    return {
      start: closeBrace,
      end: closeBrace,
      text: `${arg.properties.length > 0 ? ", " : ""}${propName}: ${tagsLiteral}`,
    };
  }

  // No options object — insert before the callback (last argument)
  const callback = call.arguments[call.arguments.length - 1]!;
  return {
    start: callback.getStart(sf),
    end: callback.getStart(sf),
    text: `{ ${propName}: ${tagsLiteral} }, `,
  };
}

/**
 * @description Builds the replacement to remove a previously injected options property.
 *   When the options object has only the target property, the whole options arg is removed.
 *   When it has other properties, only the target property is removed.
 * @param {ts.CallExpression} call - The call expression to modify.
 * @param {string} propName - Name of the property to remove.
 * @param {ts.SourceFile} sf - Source file for position resolution.
 * @returns {Replacement | null} The replacement descriptor, or null when nothing to remove.
 */
export function buildRemoveReplacement(
  call: ts.CallExpression,
  propName: string,
  sf: ts.SourceFile,
): Replacement | null {
  const args = call.arguments;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (!ts.isObjectLiteralExpression(arg)) continue;

    const idx = arg.properties.findIndex(
      (p): p is ts.PropertyAssignment =>
        ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === propName,
    );
    if (idx < 0) continue;

    if (arg.properties.length === 1) {
      // Remove the entire options argument including the preceding `, `
      return { start: args[i - 1]!.getEnd(), end: arg.getEnd(), text: "" };
    }

    const prop = arg.properties[idx]!;
    if (idx === arg.properties.length - 1) {
      // Last property — also remove the preceding comma
      return { start: arg.properties[idx - 1]!.getEnd(), end: prop.getEnd(), text: "" };
    }
    // Not last — remove the property and the following separator
    return { start: prop.getStart(sf), end: arg.properties[idx + 1]!.getStart(sf), text: "" };
  }
  return null;
}

/** Applies a list of replacements to a source string in reverse-position order. */
export function applyReplacements(source: string, replacements: Replacement[]): string {
  const sorted = [...replacements].sort((a, b) => b.start - a.start);
  let result = source;
  for (const r of sorted) {
    result = result.slice(0, r.start) + r.text + result.slice(r.end);
  }
  return result;
}

/** Serialises a list of string tag names to an inline array literal: `["a", "b"]`. */
export function toArrayLiteral(tags: string[]): string {
  return `[${tags.map((t) => JSON.stringify(t)).join(", ")}]`;
}

export const TS_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);
