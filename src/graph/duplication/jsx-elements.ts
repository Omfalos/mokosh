/**
 * Declaration-level duplicate detection for JSX/TSX element trees — the direct fix for the
 * "structurally-templated-by-design" false-positive class (icon components, and similar):
 * `maxPunctuationRatio`/token-shingling can't reliably tell "two different icons that share the
 * same wrapper boilerplate" from "the same icon copy-pasted twice," because under the default
 * `ignoreLiterals: true` the one thing that actually distinguishes two icons — the SVG `d`
 * path-data string — collapses to a `STR` placeholder *before* matching happens. Two completely
 * different icons can token-match as "duplicates" purely because the token-shingle path never
 * sees the content that would tell them apart.
 *
 * Content-based, like `object-literals.ts` and unlike `type-defs.ts`'s shape matching: two JSX
 * trees are canonicalized by tag name, sorted attribute `name=printedValue` pairs, and
 * *in-order* children (text normalized, `{expr}` printed, nested elements canonicalized
 * recursively) — real written content, not a placeholder-collapsed shape. Two elements only match
 * when that's byte-identical.
 *
 * Scans **every** JSX/TSX element in a file (not just whole-component-return shapes), so a
 * genuinely duplicated element embedded inside a larger, otherwise-unrelated component is still
 * found. This means a matched outer element (e.g. a whole `<svg>...</svg>`) and its matched inner
 * elements (e.g. the `<path>` inside it) would, before filtering, register as *separate* groups
 * for the same underlying duplication — the exact "family of nodes" redundancy
 * `applyDominanceFilter` (`suffix-duplicates.ts`) was built to fix for the token-shingle path.
 * {@link dropContainedGroups} applies the same containment-based fix here, independently (AST line
 * spans instead of token-index spans, but the same "drop an occurrence once it's already covered
 * by an accepted, larger match in that file" idea, and the same accepted trade-off: it's a lossy
 * heuristic that can rarely under-report a real pairing whose only representative span happens to
 * sit inside an unrelated larger match — see ADR-015's addendum for the full reasoning this
 * mirrors).
 *
 * Performance note: this is a third independent `ts.createSourceFile` parse of every TS/JS file,
 * on top of `type-defs.ts` and `object-literals.ts` (neither of which caches its parse either —
 * ADR-018 already flagged this gap for the first two). Not consolidated into one shared parse
 * pass here deliberately: that would mean changing two already-shipped, tested modules for a
 * performance concern nothing has actually measured yet. Worth revisiting if profiling on a real
 * large repo shows the repeated parsing matters in practice.
 */
import ts from "typescript";
import type { DuplicateGroup, DuplicateOccurrence } from "./shingle";
import type { TypeScriptSourceFile } from "./type-defs";

interface JsxDeclaration {
  file: string;
  startLine: number;
  endLine: number;
  canonicalShape: string;
}

type JsxOpeningLike = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

/**
 * @description Canonicalizes a JSX opening tag (or self-closing element)'s tag name and
 *   attributes to comparable text: `"Tag attr1=val1 attr2=val2"`, attributes sorted by their full
 *   `name=value` text so declaration-order differences don't prevent a match.
 * @param opening - The opening tag or self-closing element.
 * @param sourceFile - Owning source file (required by the printer).
 * @param printer - Shared `ts.Printer` for this file.
 * @returns The canonical text, or `undefined` if a spread attribute (`{...props}`) is present —
 *   a spread's actual contents aren't visible here, so a whole-content match can't be verified.
 */
function canonicalizeOpening(
  opening: JsxOpeningLike,
  sourceFile: ts.SourceFile,
  printer: ts.Printer,
): string | undefined {
  const tagName = opening.tagName.getText(sourceFile);
  const attrs: string[] = [];
  for (const prop of opening.attributes.properties) {
    if (ts.isJsxSpreadAttribute(prop)) return undefined;
    const name = prop.name.getText(sourceFile);
    if (!prop.initializer) {
      attrs.push(name);
    } else if (ts.isStringLiteral(prop.initializer)) {
      attrs.push(`${name}=${prop.initializer.text}`);
    } else if (ts.isJsxExpression(prop.initializer)) {
      if (!prop.initializer.expression) {
        attrs.push(`${name}={}`);
      } else {
        const printed = printer.printNode(
          ts.EmitHint.Unspecified,
          prop.initializer.expression,
          sourceFile,
        );
        attrs.push(`${name}=${printed}`);
      }
    } else {
      // JsxElement/JsxSelfClosingElement/JsxFragment as a direct attribute value — vanishingly
      // rare in practice (real JSX always wraps a nested element in `{}`), but the type permits
      // it; bail rather than guess at a canonicalization for a form real code doesn't use.
      return undefined;
    }
  }
  attrs.sort();
  return attrs.length > 0 ? `${tagName} ${attrs.join(" ")}` : tagName;
}

/**
 * @description Canonicalizes one JSX child node to comparable text — whitespace-normalized text
 *   for `JsxText`, printed expression text for `{expr}`, or a recursive canonicalization for a
 *   nested element/fragment.
 * @param child - One entry of a `JsxElement`/`JsxFragment`'s `children`.
 * @param sourceFile - Owning source file.
 * @param printer - Shared `ts.Printer` for this file.
 * @returns Canonical text (`""` for whitespace-only text or an empty `{}`), or `undefined` if the
 *   child disqualifies the whole element (a spread child, or a nested element that itself bailed).
 */
function canonicalizeChild(
  child: ts.JsxChild,
  sourceFile: ts.SourceFile,
  printer: ts.Printer,
): string | undefined {
  if (ts.isJsxText(child)) {
    const text = child.text.trim().replace(/\s+/g, " ");
    return text.length === 0 ? "" : `T:${text}`;
  }
  if (ts.isJsxExpression(child)) {
    if (!child.expression) return "";
    return `E:${printer.printNode(ts.EmitHint.Unspecified, child.expression, sourceFile)}`;
  }
  if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
    return canonicalizeJsx(child, sourceFile, printer);
  }
  return undefined;
}

/**
 * @description Canonicalizes one JSX element/self-closing element/fragment, and everything inside
 *   it, to one comparable string — the content-based unit two elements are compared on.
 * @param node - A `JsxElement`, `JsxSelfClosingElement`, or `JsxFragment`.
 * @param sourceFile - Owning source file.
 * @param printer - Shared `ts.Printer` for this file.
 * @returns Canonical text, or `undefined` if any attribute/child disqualifies the whole subtree
 *   (a spread attribute or spread child anywhere inside it).
 */
function canonicalizeJsx(
  node: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment,
  sourceFile: ts.SourceFile,
  printer: ts.Printer,
): string | undefined {
  if (ts.isJsxSelfClosingElement(node)) {
    const opening = canonicalizeOpening(node, sourceFile, printer);
    return opening === undefined ? undefined : `<${opening}/>`;
  }

  const children: string[] = [];
  for (const child of node.children) {
    const canonicalChild = canonicalizeChild(child, sourceFile, printer);
    if (canonicalChild === undefined) return undefined;
    children.push(canonicalChild);
  }

  if (ts.isJsxFragment(node)) return `<>${children.join("")}</>`;
  const opening = canonicalizeOpening(node.openingElement, sourceFile, printer);
  return opening === undefined ? undefined : `<${opening}>${children.join("")}</>`;
}

/**
 * @description Walks one source file, canonicalizing *every* JSX element/self-closing
 *   element/fragment it contains (not just whole-component-return shapes) — a genuinely
 *   duplicated element nested inside an otherwise-unrelated component is still found.
 * @param file - The TypeScript or JavaScript source file to scan.
 * @param minLength - Minimum canonical-text length (in characters) to record — filters out
 *   trivial elements (a bare `<div className="row" />` canonicalizes to ~20 chars) while keeping
 *   content-rich ones (an SVG `d` path is typically 60+ characters on its own).
 * @returns One {@link JsxDeclaration} per element clearing `minLength`, at every nesting depth.
 */
function collectJsxDecls(file: TypeScriptSourceFile, minLength: number): JsxDeclaration[] {
  const sourceFile = ts.createSourceFile(
    file.file,
    file.source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const printer = ts.createPrinter({ removeComments: true });
  const decls: JsxDeclaration[] = [];

  const lineOf = (pos: number) => sourceFile.getLineAndCharacterOfPosition(pos).line + 1;

  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      const shape = canonicalizeJsx(node, sourceFile, printer);
      if (shape !== undefined && shape.length >= minLength) {
        decls.push({
          file: file.file,
          startLine: lineOf(node.getStart(sourceFile)),
          endLine: lineOf(node.getEnd()),
          canonicalShape: shape,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return decls;
}

/**
 * @description Consolidates the "family of nodes" redundancy that scanning every nesting depth
 *   necessarily produces — a matched outer element and its matched inner elements are, before
 *   this, separate groups for what a reader would see as one duplication. Mirrors
 *   `applyDominanceFilter` (`suffix-duplicates.ts`): processes buckets largest-canonical-text-first,
 *   drops an occurrence once its line span is fully contained in an already-accepted span in that
 *   same file, drops a bucket entirely once fewer than two occurrences survive. Same accepted
 *   trade-off as that filter — see its doc comment and ADR-015's addendum: this can rarely
 *   under-report a real pairing whose only representative span is spatially subsumed by an
 *   unrelated larger match, traded for meaningfully less "same duplication, N rows" noise.
 * @param buckets - Every canonical-shape bucket with ≥2 occurrences.
 * @returns Surviving occurrence sets, largest-first, each with ≥2 occurrences.
 */
function dropContainedGroups(buckets: JsxDeclaration[][]): JsxDeclaration[][] {
  const sorted = [...buckets].sort(
    (a, b) =>
      (b[0] as JsxDeclaration).canonicalShape.length -
      (a[0] as JsxDeclaration).canonicalShape.length,
  );
  const acceptedSpansByFile = new Map<string, Array<{ start: number; end: number }>>();
  const survivingBuckets: JsxDeclaration[][] = [];

  for (const bucket of sorted) {
    const survivors = bucket.filter((decl) => {
      const spans = acceptedSpansByFile.get(decl.file);
      return !spans?.some((span) => span.start <= decl.startLine && decl.endLine <= span.end);
    });
    if (survivors.length < 2) continue;

    for (const decl of survivors) {
      const span = { start: decl.startLine, end: decl.endLine };
      const spans = acceptedSpansByFile.get(decl.file);
      if (spans) spans.push(span);
      else acceptedSpansByFile.set(decl.file, [span]);
    }
    survivingBuckets.push(survivors);
  }

  return survivingBuckets;
}

/**
 * @description Finds JSX/TSX elements that are content-identical across files — same tag, same
 *   attribute values as written, same in-order children — at any nesting depth, independent of
 *   the token-shingle path (which can't distinguish this from same-shaped-different-content
 *   elements once literals normalize to placeholders — see this module's top-of-file comment).
 * @param files - TypeScript/JavaScript source files to scan.
 * @param minLength - Minimum canonical-text length to compare (default 40 — see
 *   {@link collectJsxDecls}).
 * @returns `defKind: "jsxElement"` groups, two or more occurrences each, family redundancy from
 *   nested matches of the same duplication already consolidated (see {@link dropContainedGroups}).
 */
export function findJsxElementDuplicates(
  files: TypeScriptSourceFile[],
  minLength = 40,
): DuplicateGroup[] {
  const buckets = new Map<string, JsxDeclaration[]>();
  for (const file of files) {
    for (const decl of collectJsxDecls(file, minLength)) {
      const bucket = buckets.get(decl.canonicalShape);
      if (bucket) bucket.push(decl);
      else buckets.set(decl.canonicalShape, [decl]);
    }
  }

  const candidateBuckets = [...buckets.values()].filter((bucket) => bucket.length >= 2);
  const groups: DuplicateGroup[] = [];
  for (const survivors of dropContainedGroups(candidateBuckets)) {
    const first = survivors[0] as JsxDeclaration;
    const occurrences: DuplicateOccurrence[] = survivors.map((decl) => ({
      file: decl.file,
      startLine: decl.startLine,
      endLine: decl.endLine,
    }));
    groups.push({
      occurrences,
      lines: Math.max(...survivors.map((decl) => decl.endLine - decl.startLine + 1)),
      tokens: first.canonicalShape.length,
      kind: "definition",
      defKind: "jsxElement",
    });
  }

  return groups;
}
