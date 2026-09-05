import { describe, expect, test } from "vitest";
import { isSvgMarkupSpan } from "./svg-markup";

describe("isSvgMarkupSpan", () => {
  test("flags an inline-SVG icon body", () => {
    const source = [
      "export const IconAlert = (props) => (",
      '  <svg viewBox="0 0 24 24" width={16} height={16} {...props}>',
      '    <path fillRule="evenodd" clipRule="evenodd" d="M12 2L2 22h20L12 2zm0 6l6 12H6l6-12z" />',
      '    <circle cx="12" cy="17" r="1" />',
      "  </svg>",
      ");",
    ].join("\n");
    // span covers the three markup lines
    expect(isSvgMarkupSpan(source, 2, 5)).toBe(true);
  });

  test("flags a filter-primitive skeleton that has no path data at all", () => {
    const source = [
      "<svg>",
      "  <defs>",
      '    <filter id="blur">',
      "      <feGaussianBlur stdDeviation={2} />",
      '      <feColorMatrix type="matrix" values={MATRIX} />',
      "    </filter>",
      "  </defs>",
      "</svg>",
    ].join("\n");
    expect(isSvgMarkupSpan(source, 1, 8)).toBe(true);
  });

  test("does not flag ordinary component composition with no SVG tag or attribute", () => {
    const source = [
      "return (",
      "  <Row className={styles.row}>",
      "    <Col span={12}>{left}</Col>",
      "    <Col span={12}>{right}</Col>",
      "  </Row>",
      ");",
    ].join("\n");
    expect(isSvgMarkupSpan(source, 1, 6)).toBe(false);
  });

  test("does not flag real logic even when an <svg> tag sits nearby", () => {
    const source = [
      "function pickIcon(kind) {",
      "  const table = buildLookup(kind);",
      "  const entry = table.get(kind) ?? table.get('default');",
      "  if (!entry) throw new Error('no icon for ' + kind);",
      "  return entry.render();",
      "}",
      "const fallback = <svg viewBox='0 0 1 1' />;",
    ].join("\n");
    expect(isSvgMarkupSpan(source, 1, 6)).toBe(false);
  });

  test("returns false for an empty / whitespace-only span", () => {
    expect(isSvgMarkupSpan("\n\n\n", 1, 3)).toBe(false);
  });
});
