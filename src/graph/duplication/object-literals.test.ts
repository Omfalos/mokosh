import { describe, expect, it } from "vitest";
import { findObjectLiteralDuplicates } from "./object-literals";

describe("findObjectLiteralDuplicates", () => {
  it("matches const object literals with identical keys and values, order-independent", () => {
    const a = {
      file: "a.ts",
      source: "export const CONFIG = { host: 'x', port: 80, retries: 3 };",
    };
    const b = {
      file: "b.ts",
      source: "const CONFIG_B = { retries: 3, host: 'x', port: 80 };",
    };

    const groups = findObjectLiteralDuplicates([a, b]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.defKind).toBe("objectLiteral");
    expect(groups[0]?.kind).toBe("definition");
    expect(groups[0]?.occurrences.map((o) => o.file).sort()).toEqual(["a.ts", "b.ts"]);
  });

  it("does not match literals with the same shape but different values (the false-positive case this fixes)", () => {
    const a = { file: "a.ts", source: "const A = { host: 'x', port: 80, retries: 3 };" };
    const b = { file: "b.ts", source: "const B = { host: 'y', port: 443, retries: 5 };" };

    expect(findObjectLiteralDuplicates([a, b])).toEqual([]);
  });

  it("does not match literals with different keys", () => {
    const a = { file: "a.ts", source: "const A = { alpha: 1, beta: 2, gamma: 3 };" };
    const b = { file: "b.ts", source: "const B = { delta: 1, epsilon: 2, zeta: 3 };" };

    expect(findObjectLiteralDuplicates([a, b])).toEqual([]);
  });

  it("respects minMembers, skipping small option bags by default", () => {
    const a = { file: "a.ts", source: "const A = { enabled: true, timeout: 5 };" };
    const b = { file: "b.ts", source: "const B = { enabled: true, timeout: 5 };" };

    expect(findObjectLiteralDuplicates([a, b])).toEqual([]);
    expect(findObjectLiteralDuplicates([a, b], 2)).toHaveLength(1);
  });

  it("skips let/var declarations, only matching const", () => {
    const a = { file: "a.ts", source: "let A = { alpha: 1, beta: 2, gamma: 3 };" };
    const b = { file: "b.ts", source: "const B = { alpha: 1, beta: 2, gamma: 3 };" };

    expect(findObjectLiteralDuplicates([a, b])).toEqual([]);
  });

  it("unwraps 'as const' and 'satisfies' before comparing", () => {
    const a = { file: "a.ts", source: "const A = { alpha: 1, beta: 2, gamma: 3 } as const;" };
    const b = {
      file: "b.ts",
      source: "const B = { alpha: 1, beta: 2, gamma: 3 } satisfies Record<string, number>;",
    };

    const groups = findObjectLiteralDuplicates([a, b]);
    expect(groups).toHaveLength(1);
  });

  it("skips literals containing a spread or computed key entirely, rather than partially matching", () => {
    const a = { file: "a.ts", source: "const A = { alpha: 1, beta: 2, ...rest };" };
    const b = { file: "b.ts", source: "const B = { alpha: 1, beta: 2, gamma: 3 };" };
    const c = { file: "c.ts", source: "const C = { alpha: 1, beta: 2, ...rest };" };

    // a and c share the same disqualifying spread shape but neither becomes comparable.
    expect(findObjectLiteralDuplicates([a, b, c], 2)).toEqual([]);
  });

  it("works on plain JavaScript files, not just TypeScript", () => {
    const a = { file: "a.js", source: "const A = { alpha: 1, beta: 2, gamma: 3 };" };
    const b = { file: "b.js", source: "const B = { gamma: 3, alpha: 1, beta: 2 };" };

    const groups = findObjectLiteralDuplicates([a, b]);
    expect(groups).toHaveLength(1);
  });

  it("matches shorthand properties by name", () => {
    const a = {
      file: "a.ts",
      source: "const alpha = 1, beta = 2, gamma = 3;\nconst A = { alpha, beta, gamma };",
    };
    const b = {
      file: "b.ts",
      source: "const alpha = 1, beta = 2, gamma = 3;\nconst B = { gamma, beta, alpha };",
    };

    const groups = findObjectLiteralDuplicates([a, b]);
    expect(groups).toHaveLength(1);
  });
});
