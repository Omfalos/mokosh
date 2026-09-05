/**
 * Declaration-level duplicate detection for plain `const` object literals — the JS/TS counterpart
 * to `type-defs.ts`'s `interface`/`type` matching, and a targeted fix for a false-positive class
 * the token-shingle path can't avoid on its own: `maxPunctuationRatio` (shingle.ts) gates out
 * blocks that are *mostly* object-literal punctuation, but two unrelated literals with the same
 * key *count* and nesting can still clear that gate and register as a "duplicate" purely on shape
 * — `{ a: 1, b: 2 }` and `{ x: 3, y: 4 }` tokenize identically once identifiers/literals normalize
 * to placeholders, same root cause ADR-013 fixed for CSS declaration shape (`display: flex` vs
 * `display: block`).
 *
 * **Deliberately stricter than `type-defs.ts`'s shape matching.** A `type`/`interface` member is a
 * type position — matching two declarations with the same member names and types regardless of
 * how they're eventually populated is exactly the "these should be one declaration" signal ADR-018
 * targets. A `const` object literal's members are *values* — two unrelated config objects sharing
 * the same key names but different values are not obviously a duplication candidate the way two
 * identically-shaped types are (many small option bags legitimately share key names like
 * `{ enabled, timeout }` without being copies of each other). So this compares canonicalized
 * `key:printedValue` pairs, not just key names — both the keys *and* the values must match
 * (order-independent) for two literals to be grouped. This is closer to `style-blocks.ts`'s
 * content-based CSS rule-body comparator than to `type-defs.ts`'s shape-based one: it compares what
 * was actually written, not a structural approximation of it.
 *
 * Reuses `type-defs.ts`'s `TypeScriptSourceFile` input shape and `ts.createSourceFile` approach —
 * runs over both TypeScript and JavaScript files (`index.ts` feeds both in), unlike `type-defs.ts`
 * itself, since `interface`/`type` are TS-only syntax but object literals are equally common in
 * plain JS.
 */
import ts from "typescript";
import type { DuplicateGroup, DuplicateOccurrence } from "./shingle";
import type { TypeScriptSourceFile } from "./type-defs";

interface ObjectLiteralDeclaration {
  file: string;
  name: string;
  startLine: number;
  endLine: number;
  memberCount: number;
  canonicalShape: string;
}

/**
 * @description Strips `as const` / `satisfies X` / redundant parens down to the underlying
 *   expression, so `const x = { ... } as const` is still recognized as an object literal.
 * @param expr - A variable declaration's initializer expression.
 * @returns The unwrapped inner expression.
 */
function unwrap(expr: ts.Expression): ts.Expression {
  let current = expr;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * @description Canonicalizes one object-literal property to comparable `"key:printedValue"` text,
 *   or `undefined` when it's not a plain, statically-keyed value (a spread, computed key, or
 *   method/accessor changes the object's actual shape or behavior in a way textual value-printing
 *   alone doesn't safely capture).
 * @param printer - Shared `ts.Printer` for this file.
 * @param sourceFile - The property's owning source file (required by the printer).
 * @param property - One `ObjectLiteralExpression` member.
 * @returns `"key:printedValue"`, or `undefined` if this property disqualifies the whole literal.
 */
function printProperty(
  printer: ts.Printer,
  sourceFile: ts.SourceFile,
  property: ts.ObjectLiteralElementLike,
): string | undefined {
  if (ts.isPropertyAssignment(property)) {
    if (ts.isComputedPropertyName(property.name)) return undefined;
    const key = property.name.getText(sourceFile);
    const value = printer.printNode(ts.EmitHint.Unspecified, property.initializer, sourceFile);
    return `${key}:${value}`;
  }
  if (ts.isShorthandPropertyAssignment(property)) {
    const key = property.name.getText(sourceFile);
    return `${key}:${key}`;
  }
  return undefined;
}

/**
 * @description Canonicalizes a list of printed `"key:printedValue"` properties into one comparable
 *   string, sorted so declaration-order differences don't prevent a match.
 * @param properties - Printed properties, `undefined` entries mark a disqualifying member.
 * @returns The joined, sorted canonical form, or `undefined` when any member was disqualifying or
 *   fewer than two members printed at all (too weak a signal to compare, mirrors `type-defs.ts`).
 */
function canonicalize(properties: (string | undefined)[]): string | undefined {
  const printable = properties.filter((p): p is string => p !== undefined);
  if (printable.length < 2 || printable.length !== properties.length) return undefined;
  return [...printable].sort().join(";");
}

/**
 * @description Walks one source file's `const` declarations, extracting a canonicalization for
 *   every one directly initialized with an object literal (through `as const`/`satisfies`/parens).
 *   `let`/`var` declarations are skipped — a reassignable binding's initial shape is a weaker
 *   duplication signal, and narrowing to `const` keeps this targeted at the "config object" case
 *   the false-positive report was about.
 * @param file - The TypeScript or JavaScript source file to scan.
 * @returns One {@link ObjectLiteralDeclaration} per comparable declaration.
 */
function collectObjectLiteralDecls(file: TypeScriptSourceFile): ObjectLiteralDeclaration[] {
  const sourceFile = ts.createSourceFile(
    file.file,
    file.source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const printer = ts.createPrinter({ removeComments: true });
  const decls: ObjectLiteralDeclaration[] = [];

  const lineOf = (pos: number) => sourceFile.getLineAndCharacterOfPosition(pos).line + 1;

  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      const initializer = unwrap(node.initializer);
      if (ts.isObjectLiteralExpression(initializer)) {
        const canonicalShape = canonicalize(
          initializer.properties.map((property) => printProperty(printer, sourceFile, property)),
        );
        if (canonicalShape !== undefined) {
          decls.push({
            file: file.file,
            name: node.name.text,
            startLine: lineOf(node.getStart(sourceFile)),
            endLine: lineOf(node.getEnd()),
            memberCount: initializer.properties.length,
            canonicalShape,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return decls;
}

/**
 * @description Finds `const` object literals that are content-identical across files — same key
 *   names *and* same printed values (order-independent) — independent of the token-shingle path,
 *   which can't reliably tell "same shape, different content" apart from a real duplicate for
 *   object literals (see this module's top-of-file comment).
 * @param files - TypeScript/JavaScript source files to scan.
 * @param minMembers - Minimum key count a literal must have to be compared (default 3 — higher
 *   than `type-defs.ts`'s 2, since small option bags sharing 1-2 common keys like
 *   `{ enabled, timeout }` are extremely common and too weak a signal on their own).
 * @returns `defKind: "objectLiteral"` groups, two or more occurrences each.
 */
export function findObjectLiteralDuplicates(
  files: TypeScriptSourceFile[],
  minMembers = 3,
): DuplicateGroup[] {
  const buckets = new Map<string, ObjectLiteralDeclaration[]>();
  for (const file of files) {
    for (const decl of collectObjectLiteralDecls(file)) {
      if (decl.memberCount < minMembers) continue;
      const bucket = buckets.get(decl.canonicalShape);
      if (bucket) bucket.push(decl);
      else buckets.set(decl.canonicalShape, [decl]);
    }
  }

  const groups: DuplicateGroup[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    const first = bucket[0] as ObjectLiteralDeclaration;
    const occurrences: DuplicateOccurrence[] = bucket.map((decl) => ({
      file: decl.file,
      startLine: decl.startLine,
      endLine: decl.endLine,
      name: decl.name,
    }));
    groups.push({
      occurrences,
      lines: Math.max(...bucket.map((decl) => decl.endLine - decl.startLine + 1)),
      tokens: first.memberCount,
      kind: "definition",
      defKind: "objectLiteral",
    });
  }

  return groups;
}
