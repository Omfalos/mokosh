import { describe, expect, it } from "vitest";
import { findJsxElementDuplicates } from "./jsx-elements";

const ICON_A = `
export function IconAlpha(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" {...props}>
      <path d="M8 1 L15 15 L1 15 Z M8 4 L3 13 L13 13 Z" fill="currentColor" />
    </svg>
  );
}
`;

const ICON_B_DIFFERENT_PATH = `
export function IconBeta(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" {...props}>
      <path d="M2 2 L14 2 L14 14 L2 14 Z" fill="currentColor" />
    </svg>
  );
}
`;

const ICON_A_COPY = `
export function IconAlphaCopy(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" {...props}>
      <path d="M8 1 L15 15 L1 15 Z M8 4 L3 13 L13 13 Z" fill="currentColor" />
    </svg>
  );
}
`;

describe("findJsxElementDuplicates", () => {
  it("does not match icon components with the same wrapper but different path data", () => {
    const a = { file: "IconAlpha.tsx", source: ICON_A };
    const b = { file: "IconBeta.tsx", source: ICON_B_DIFFERENT_PATH };

    // The <svg> wrapper has a spread attribute ({...props}), so it never becomes a candidate on
    // its own; the inner <path> is the one with real, distinguishing content, and it must not
    // match since the d attribute differs.
    expect(findJsxElementDuplicates([a, b])).toEqual([]);
  });

  it("matches a genuinely copy-pasted icon (identical path data)", () => {
    const a = { file: "IconAlpha.tsx", source: ICON_A };
    const b = { file: "IconAlphaCopy.tsx", source: ICON_A_COPY };

    const groups = findJsxElementDuplicates([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.defKind).toBe("jsxElement");
    expect(groups[0]?.kind).toBe("definition");
    expect(groups[0]?.occurrences.map((o) => o.file).sort()).toEqual([
      "IconAlpha.tsx",
      "IconAlphaCopy.tsx",
    ]);
  });

  it("does not match trivial elements below minLength", () => {
    const a = { file: "a.tsx", source: 'const A = () => <div className="row" />;' };
    const b = { file: "b.tsx", source: 'const B = () => <div className="row" />;' };

    expect(findJsxElementDuplicates([a, b])).toEqual([]);
    expect(findJsxElementDuplicates([a, b], 5)).toHaveLength(1);
  });

  it("collapses a matched outer element and its matched inner element into one group, not two", () => {
    const long = "M8 1 L15 15 L1 15 Z M8 4 L3 13 L13 13 Z M8 1 L15 15 L1 15 Z M8 4 L3 13 L13 13 Z";
    const source = `const Icon = () => (
      <svg viewBox="0 0 16 16">
        <path d="${long}" fill="currentColor" />
      </svg>
    );`;
    const a = { file: "a.tsx", source };
    const b = { file: "b.tsx", source };

    const groups = findJsxElementDuplicates([a, b]);
    // Both the whole <svg>...</svg> and the inner <path .../> independently clear minLength and
    // are identical across a/b — without dominance filtering this would be 2 groups.
    expect(groups).toHaveLength(1);
    expect(groups[0]?.lines).toBeGreaterThanOrEqual(1);
  });

  it("skips elements containing a spread attribute", () => {
    const a = {
      file: "a.tsx",
      source: '<div className="a-long-enough-class-name-here" {...rest} />;',
    };
    const b = {
      file: "b.tsx",
      source: '<div className="a-long-enough-class-name-here" {...rest} />;',
    };

    expect(findJsxElementDuplicates([a, b])).toEqual([]);
  });

  it("matches nested elements embedded inside a larger, otherwise different component", () => {
    const shared = '<Badge color="red" label="Important notice for the user" size="large" />';
    const a = { file: "a.tsx", source: `function Foo() { return <div>{${shared}}</div>; }` };
    const b = {
      file: "b.tsx",
      source: `function Bar() { return <section><header>{${shared}}</header></section>; }`,
    };

    const groups = findJsxElementDuplicates([a, b]);
    expect(groups.some((g) => g.occurrences.some((o) => o.file === "a.tsx"))).toBe(true);
    expect(groups.some((g) => g.occurrences.some((o) => o.file === "b.tsx"))).toBe(true);
  });
});
