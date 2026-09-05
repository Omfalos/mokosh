/**
 * Detects whether a duplicate group's occurrences are predominantly inline SVG (or SVG-shaped
 * JSX) markup rather than substantive shared logic — the residual "icon component" false-positive
 * the token-shingle block matcher can't avoid on its own.
 *
 * `jsx-elements.ts` already handles genuine, *byte-identical* SVG copy-paste as a content-based
 * `defKind: "jsxElement"` group. But the block (token-shingle) matcher still runs over the same
 * TSX/JSX files independently, and under the default `ignoreLiterals: true` the one thing that
 * distinguishes two different icons — the `d=` path-data string, `points=`, gradient stops, the
 * `<feMorphology>`/`<feColorMatrix>` filter constants — collapses to a `STR`/`NUM` placeholder
 * *before* matching. Two completely different icons then share an identical token skeleton
 * (`< ID ID = STR > < ID ID = STR /> …`) that clears `windowSize`, `minLines`, and
 * `maxPunctuationRatio` (which counts `{ } : , [ ]`, not JSX's `< > / =`), so the block matcher
 * reports them as a duplicate. Raising `minLines` doesn't help — an icon's `<defs><filter>…`
 * skeleton is genuinely many lines long.
 *
 * Rather than special-case the tokenizer (per-file-type `ignoreLiterals` breaks the single
 * shared suffix-array stream and the token cache's one-bool key), this runs on the *source text*
 * of each reported group: if every occurrence's line span is mostly markup and at least one line
 * carries an SVG-specific tag or attribute, the group is tagged `signals: ["svg-markup"]` and
 * — like `same-file` and `generated` — excluded from `findDuplicates`' results by default,
 * recoverable with `includeSvgMarkup: true`. Requiring an actual SVG signal (not just "looks like
 * JSX") keeps ordinary component composition — `<Row><Col>…</Col></Row>` — from being suppressed.
 */

/** An opening/closing/self-closing tag for an element that only ever appears inside `<svg>`. `fe*`
 *  covers the whole SVG filter-primitive family (`feGaussianBlur`, `feColorMatrix`, …). */
const SVG_TAG =
  /<\/?\s*(?:svg|path|g|circle|ellipse|rect|line|polygon|polyline|defs|use|symbol|mask|clipPath|linearGradient|radialGradient|stop|pattern|filter|fe[A-Z][A-Za-z]*|marker|foreignObject|tspan|textPath)\b/;

/** An attribute that is meaningful essentially only on SVG elements — the content `ignoreLiterals`
 *  normalizes away, which is exactly why two different icons token-match. */
const SVG_ATTR =
  /\b(?:viewBox|xmlns(?::xlink)?|xlink:href|fill-rule|clip-rule|stroke-width|stroke-linecap|stroke-linejoin|stroke-dasharray|stroke-miterlimit|gradientUnits|gradientTransform|patternUnits|patternTransform|preserveAspectRatio|pathLength|d|points|cx|cy|rx|ry)\s*=/;

/** A line that is structurally markup: a tag open/close, a lone `>` / `/>` closer, or a bare
 *  attribute continued onto its own line (`stroke="currentColor"`). */
const MARKUP_LINE = /^\s*(?:<\/?[A-Za-z>]|\/?>\s*$|[A-Za-z_$][\w:.$-]*\s*=\s*["'{])/;

/**
 * @description Whether the source lines `[startLine, endLine]` (1-based, inclusive) are
 *   predominantly SVG / SVG-shaped-JSX markup. True when at least one non-blank line carries an
 *   SVG-specific tag or attribute and at least `threshold` (default 0.6) of the non-blank lines
 *   are markup lines.
 * @param source - Full source text of the file the span belongs to.
 * @param startLine - 1-based first line of the span (inclusive).
 * @param endLine - 1-based last line of the span (inclusive).
 * @param threshold - Minimum markup-line fraction to treat the span as SVG markup.
 * @returns `true` if the span reads as inline SVG markup rather than logic.
 */
export function isSvgMarkupSpan(
  source: string,
  startLine: number,
  endLine: number,
  threshold = 0.6,
): boolean {
  const lines = source.split("\n").slice(Math.max(0, startLine - 1), endLine);
  let nonBlank = 0;
  let markup = 0;
  let sawSvgSignal = false;

  for (const line of lines) {
    if (line.trim().length === 0) continue;
    nonBlank++;
    const svgish = SVG_TAG.test(line) || SVG_ATTR.test(line);
    if (svgish) sawSvgSignal = true;
    if (svgish || MARKUP_LINE.test(line)) markup++;
  }

  return sawSvgSignal && nonBlank > 0 && markup / nonBlank >= threshold;
}
