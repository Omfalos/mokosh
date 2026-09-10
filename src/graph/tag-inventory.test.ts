import { describe, expect, it } from "vitest";
import type { StructuredTag } from "../types/node";
import type { TagKind } from "../types/parse";
import { Graph } from "./model";
import {
  buildTagInventory,
  DEFAULT_TAG_MIN_COUNT,
  summarizeTagInventory,
  TAG_RESPONSE_HARD_CAP,
} from "./tag-inventory";

function graphOf(...nodes: Array<{ path: string; tags: StructuredTag[] }>): Graph {
  return Graph.deserialize({
    nodes: nodes.map((node) => ({
      path: node.path,
      type: "typescript",
      category: "logic",
      tags: node.tags,
      imports: [],
      exports: [],
      mtime: 0,
      size: 0,
    })),
  });
}

const cm = (name: string): StructuredTag => ({ name, kind: "comment-marker" });
const fn = (name: string): StructuredTag => ({ name, kind: "function" });
const imp = (name: string): StructuredTag => ({ name, kind: "import" });

describe("buildTagInventory", () => {
  it("sums count across kinds and dedupes kinds in declaration order", () => {
    const inv = buildTagInventory([
      graphOf(
        { path: "src/a.ts", tags: [cm("auth"), fn("auth")] },
        { path: "src/b.ts", tags: [imp("auth"), cm("core")] },
      ),
    ]);

    const auth = inv.entries.get("auth");
    expect(auth?.count).toBe(3);
    // TagKind order: function, class, variable, type, import, library, comment-marker
    expect(auth?.kinds).toEqual(["function", "import", "comment-marker"]);
    expect(inv.totalDistinct).toBe(2);
  });

  it("byKind counts distinct names per kind, once per kind a name carries", () => {
    const inv = buildTagInventory([
      graphOf(
        { path: "src/a.ts", tags: [cm("auth"), fn("auth"), fn("makeNode")] },
        { path: "src/b.ts", tags: [cm("core")] },
      ),
    ]);

    expect(inv.byKind).toEqual({ "comment-marker": 2, function: 2 });
  });

  it("merges tags across multiple graphs", () => {
    const inv = buildTagInventory([
      graphOf({ path: "src/a.ts", tags: [cm("auth")] }),
      graphOf({ path: "pkg/b.ts", tags: [cm("auth")] }),
    ]);

    expect(inv.entries.get("auth")?.count).toBe(2);
    expect(inv.totalDistinct).toBe(1);
  });
});

describe("summarizeTagInventory", () => {
  const inv = buildTagInventory([
    graphOf(
      { path: "src/a.ts", tags: [cm("core"), cm("auth"), fn("makeNode")] },
      { path: "src/b.ts", tags: [cm("core"), cm("auth")] },
      { path: "src/c.ts", tags: [cm("core"), fn("makeNode")] },
      { path: "src/d.ts", tags: [cm("rare")] },
    ),
  ]);

  it("defaults to comment-marker + import kinds with count >= 2, sorted by count then name", () => {
    const summary = summarizeTagInventory(inv);

    expect(summary.tags).toEqual([
      { name: "core", count: 3, kinds: ["comment-marker"] },
      { name: "auth", count: 2, kinds: ["comment-marker"] },
    ]);
    expect(summary.matched).toBe(2);
    expect(summary.totalDistinct).toBe(4);
    expect(summary.byKind).toEqual({ "comment-marker": 3, function: 1 });
    expect(DEFAULT_TAG_MIN_COUNT).toBe(2);
  });

  it("minCount:1 includes the single-occurrence meaningful tag", () => {
    const summary = summarizeTagInventory(inv, { minCount: 1 });
    expect(summary.tags.map((tag) => tag.name)).toEqual(["core", "auth", "rare"]);
  });

  it("kind:'function' selects a declaration kind hidden by default", () => {
    const summary = summarizeTagInventory(inv, { kind: "function", minCount: 1 });
    expect(summary.tags).toEqual([{ name: "makeNode", count: 2, kinds: ["function"] }]);
  });

  it("kind:'all' spans every kind", () => {
    const summary = summarizeTagInventory(inv, { kind: "all" });
    expect(summary.tags.map((tag) => tag.name)).toEqual(["core", "auth", "makeNode"]);
  });

  it("prefix matches a case-insensitive substring of the name", () => {
    const summary = summarizeTagInventory(inv, { minCount: 1, prefix: "AR" });
    expect(summary.tags.map((tag) => tag.name)).toEqual(["rare"]);
  });

  it("limit truncates and flags truncated; matched stays the pre-cap total", () => {
    const summary = summarizeTagInventory(inv, { limit: 1 });
    expect(summary.tags).toEqual([{ name: "core", count: 3, kinds: ["comment-marker"] }]);
    expect(summary.count).toBe(1);
    expect(summary.matched).toBe(2);
    expect(summary.truncated).toBe(true);
  });

  it("clamps limit to TAG_RESPONSE_HARD_CAP", () => {
    const many: StructuredTag[] = Array.from({ length: TAG_RESPONSE_HARD_CAP + 50 }, (_, i) =>
      cm(`t${String(i).padStart(4, "0")}`),
    );
    const bigInv = buildTagInventory([
      graphOf({ path: "src/a.ts", tags: many }, { path: "src/b.ts", tags: many }),
    ]);

    const summary = summarizeTagInventory(bigInv, { limit: 10_000 });
    expect(summary.count).toBe(TAG_RESPONSE_HARD_CAP);
    expect(summary.matched).toBe(TAG_RESPONSE_HARD_CAP + 50);
    expect(summary.truncated).toBe(true);
  });

  it("returns an empty, well-formed shape for an inventory with no matching tags", () => {
    const empty = buildTagInventory([graphOf({ path: "src/a.ts", tags: [] })]);
    const summary = summarizeTagInventory(empty);
    expect(summary).toMatchObject({ tags: [], count: 0, matched: 0, totalDistinct: 0, byKind: {} });
    expect(summary.truncated).toBeUndefined();
    expect(typeof summary.hint).toBe("string");
  });
});
