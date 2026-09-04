/**
 * Declaration-level duplicate detection for TypeScript `interface`/`type` object shapes —
 * independent of the token-shingle matching `tokenizer.ts`/`shingle.ts` do over code *bodies*.
 * Two structurally-identical shapes (same member names, same member types, same optionality) are
 * a real "these should be one declaration" refactor target, even when they textually differ too
 * much for token-shingling to catch (different member order, different formatting) or too little
 * for it to bother reporting (a short declaration falls under `windowSize`).
 *
 * Uses the TypeScript Compiler API directly (`ts.createSourceFile`), the same pattern
 * `src/parser/lang/typescript.ts` uses for signature printing — self-contained here rather than
 * imported, since that module's printer is scoped to its own single-file `analyzeNode` traversal.
 * See docs/adr-018-per-language-definition-duplicates.md.
 */
import ts from "typescript";
import type { DuplicateGroup, DuplicateOccurrence } from "./shingle";

export interface TypeScriptSourceFile {
  file: string;
  source: string;
}

type DefKind = "interface" | "type";

interface TypeDeclaration {
  file: string;
  name: string;
  defKind: DefKind;
  startLine: number;
  endLine: number;
  memberCount: number;
  canonicalShape: string;
}

/**
 * @description Prints a member's type annotation to comparable text, resolving nothing beyond
 *   what the printer already does — two members are only considered equal when their type
 *   annotations are textually identical after printing, which is enough to catch copy-pasted
 *   shapes without the cost of full type resolution.
 * @param printer - Shared `ts.Printer` for this file.
 * @param sourceFile - The member's owning source file (required by the printer).
 * @param member - A `PropertySignature`-like member.
 * @returns `"name?:Type"` (or `"name:Type"` when required), the unit canonicalization sorts on.
 */
function printMember(
  printer: ts.Printer,
  sourceFile: ts.SourceFile,
  member: ts.TypeElement,
): string | undefined {
  if (!ts.isPropertySignature(member) || !member.type) return undefined;
  const name = member.name.getText(sourceFile);
  const optional = member.questionToken ? "?" : "";
  const typeText = printer.printNode(ts.EmitHint.Unspecified, member.type, sourceFile);
  return `${name}${optional}:${typeText}`;
}

/**
 * @description Canonicalizes a list of printed members into one comparable string: sorted by
 *   member name so declaration-order differences don't prevent a match.
 * @param members - Printed `"name?:Type"` entries.
 * @returns The members joined in sorted order, or `undefined` when fewer than two are printable
 *   (interfaces/type-literals can extend/spread members this walk doesn't resolve — those without
 *   at least two directly-printable members are too weak a signal to compare).
 */
function canonicalize(members: (string | undefined)[]): string | undefined {
  const printable = members.filter((m): m is string => m !== undefined);
  if (printable.length < 2 || printable.length !== members.length) return undefined;
  return [...printable].sort().join(";");
}

/**
 * @description Walks one TypeScript file's top-level `interface` and `type` declarations,
 *   extracting an object-shape canonicalization for each. Type aliases that don't resolve to a
 *   plain object shape (unions, primitives, `unknown`/`any`, mapped/conditional types, …) are
 *   skipped — only `TypeLiteralNode` aliases are structurally comparable to an interface.
 * @param file - The TypeScript source file to scan.
 * @returns One {@link TypeDeclaration} per comparable declaration.
 */
function collectTypeDecls(file: TypeScriptSourceFile): TypeDeclaration[] {
  const sourceFile = ts.createSourceFile(
    file.file,
    file.source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const printer = ts.createPrinter({ removeComments: true });
  const decls: TypeDeclaration[] = [];

  const lineOf = (pos: number) => sourceFile.getLineAndCharacterOfPosition(pos).line + 1;

  const visit = (node: ts.Node) => {
    let name: string | undefined;
    let defKind: DefKind | undefined;
    let members: ts.NodeArray<ts.TypeElement> | undefined;

    if (ts.isInterfaceDeclaration(node)) {
      name = node.name.text;
      defKind = "interface";
      members = node.members;
    } else if (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type)) {
      name = node.name.text;
      defKind = "type";
      members = node.type.members;
    }

    if (name && defKind && members) {
      const canonicalShape = canonicalize(
        members.map((member) => printMember(printer, sourceFile, member)),
      );
      if (canonicalShape !== undefined) {
        decls.push({
          file: file.file,
          name,
          defKind,
          startLine: lineOf(node.getStart(sourceFile)),
          endLine: lineOf(node.getEnd()),
          memberCount: members.length,
          canonicalShape,
        });
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return decls;
}

/**
 * @description Finds structurally-identical `interface`/`type` object shapes across files — same
 *   member names, same printed member types, same optionality, independent of member order or
 *   declaration formatting. An `interface` matching a `type` alias of the same shape is reported
 *   too, since that's the same "these should be one declaration" signal.
 * @param files - TypeScript source files to scan.
 * @param minMembers - Minimum member count a shape must have to be compared (default 2) — a
 *   single-member shape is too weak a signal.
 * @returns `defKind: "interface"` or `"type"` groups (the first declaration's kind in the group;
 *   mixed-kind groups are still one group), two or more occurrences each.
 */
export function findTypeDefDuplicates(
  files: TypeScriptSourceFile[],
  minMembers = 2,
): DuplicateGroup[] {
  const buckets = new Map<string, TypeDeclaration[]>();
  for (const file of files) {
    for (const decl of collectTypeDecls(file)) {
      if (decl.memberCount < minMembers) continue;
      const bucket = buckets.get(decl.canonicalShape);
      if (bucket) bucket.push(decl);
      else buckets.set(decl.canonicalShape, [decl]);
    }
  }

  const groups: DuplicateGroup[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    const first = bucket[0] as TypeDeclaration;
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
      defKind: first.defKind,
    });
  }

  return groups;
}
