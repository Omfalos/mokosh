import { describe, expect, test } from "vitest";
import type { FileNode } from "../types/node";
import { SymbolTraversalContext } from "./symbol-traversal";

function makeNode(p: string, importsFrom: { path: string; symbols?: string[] }[] = []): FileNode {
  return {
    path: p,
    type: "typescript",
    category: "logic",
    imports: importsFrom.map(({ path: toPath, symbols }) => ({
      fromPath: p,
      toPath,
      rawSpecifier: `./${toPath}`,
      type: "static" as const,
      isStyle: false,
      isExternal: false,
      symbols,
    })),
    exports: [],
    tags: [],
    mtime: 1000,
    size: 100,
  };
}

describe("SymbolTraversalContext", {
  tags: ["FileNode", "SymbolTraversalContext", "node", "symbol-traversal"],
}, () => {
  describe("constructor seeding", () => {
    test("seeds the start path with provided symbols plus 'default'", () => {
      const ctx = new SymbolTraversalContext("src/a.ts", ["foo"]);
      const consumer = makeNode("src/b.ts", [{ path: "src/a.ts", symbols: ["foo"] }]);
      expect(ctx.updateAffectedSymbols(consumer, "src/a.ts")).toBe(true);
    });

    test("always seeds 'default' even when no symbols provided", () => {
      const ctx = new SymbolTraversalContext("src/a.ts", []);
      const consumer = makeNode("src/b.ts", [{ path: "src/a.ts", symbols: ["default"] }]);
      expect(ctx.updateAffectedSymbols(consumer, "src/a.ts")).toBe(true);
    });

    test("passes ['*'] to treat the whole file as changed", () => {
      const ctx = new SymbolTraversalContext("src/a.ts", ["*"]);
      const consumer = makeNode("src/b.ts", [{ path: "src/a.ts", symbols: ["anything"] }]);
      expect(ctx.updateAffectedSymbols(consumer, "src/a.ts")).toBe(true);
    });
  });

  describe("updateAffectedSymbols — pruning", () => {
    test("returns false when visitedNode has no import edge from childPath", () => {
      const ctx = new SymbolTraversalContext("src/a.ts", ["foo"]);
      const unrelated = makeNode("src/b.ts", [{ path: "src/c.ts", symbols: ["foo"] }]);
      expect(ctx.updateAffectedSymbols(unrelated, "src/a.ts")).toBe(false);
    });

    test("returns false when none of the imported symbols are affected", () => {
      const ctx = new SymbolTraversalContext("src/a.ts", ["foo"]);
      const consumer = makeNode("src/b.ts", [{ path: "src/a.ts", symbols: ["bar"] }]);
      expect(ctx.updateAffectedSymbols(consumer, "src/a.ts")).toBe(false);
    });

    test("returns false when childPath has no entry in the context yet", () => {
      const ctx = new SymbolTraversalContext("src/a.ts", ["foo"]);
      const consumer = makeNode("src/b.ts", [{ path: "src/unknown.ts", symbols: ["foo"] }]);
      expect(ctx.updateAffectedSymbols(consumer, "src/unknown.ts")).toBe(false);
    });
  });

  describe("updateAffectedSymbols — named symbol match", () => {
    test("returns true when exactly the affected symbol is imported", () => {
      const ctx = new SymbolTraversalContext("src/a.ts", ["foo"]);
      const consumer = makeNode("src/b.ts", [{ path: "src/a.ts", symbols: ["foo"] }]);
      expect(ctx.updateAffectedSymbols(consumer, "src/a.ts")).toBe(true);
    });

    test("returns true when one of multiple imported symbols is affected", () => {
      const ctx = new SymbolTraversalContext("src/a.ts", ["foo"]);
      const consumer = makeNode("src/b.ts", [{ path: "src/a.ts", symbols: ["bar", "foo"] }]);
      expect(ctx.updateAffectedSymbols(consumer, "src/a.ts")).toBe(true);
    });
  });

  describe("wildcard propagation", () => {
    test("namespace import ('*' in importedSymbols) is always affected", () => {
      const ctx = new SymbolTraversalContext("src/a.ts", ["foo"]);
      const consumer = makeNode("src/b.ts", [{ path: "src/a.ts", symbols: ["*"] }]);
      expect(ctx.updateAffectedSymbols(consumer, "src/a.ts")).toBe(true);
    });

    test("undefined symbols (no named bindings) treated as namespace import", () => {
      const ctx = new SymbolTraversalContext("src/a.ts", ["foo"]);
      const consumer = makeNode("src/b.ts", [{ path: "src/a.ts" }]);
      expect(ctx.updateAffectedSymbols(consumer, "src/a.ts")).toBe(true);
    });

    test("'*' in currentSymbols means any import from that path is affected", () => {
      const ctx = new SymbolTraversalContext("src/a.ts", ["*"]);
      const consumer = makeNode("src/b.ts", [{ path: "src/a.ts", symbols: ["specificFn"] }]);
      expect(ctx.updateAffectedSymbols(consumer, "src/a.ts")).toBe(true);
    });
  });

  describe("symbol propagation through the chain", () => {
    test("propagates affected set to visitedNode for the next hop", () => {
      const ctx = new SymbolTraversalContext("src/a.ts", ["foo"]);

      const b = makeNode("src/b.ts", [{ path: "src/a.ts", symbols: ["foo"] }]);
      expect(ctx.updateAffectedSymbols(b, "src/a.ts")).toBe(true);

      // c imports from b; b is now in the context so c should also be affected
      const c = makeNode("src/c.ts", [{ path: "src/b.ts", symbols: ["*"] }]);
      expect(ctx.updateAffectedSymbols(c, "src/b.ts")).toBe(true);
    });

    test("stops propagation when intermediate node imported an unaffected symbol", () => {
      const ctx = new SymbolTraversalContext("src/a.ts", ["foo"]);

      const b = makeNode("src/b.ts", [{ path: "src/a.ts", symbols: ["bar"] }]);
      expect(ctx.updateAffectedSymbols(b, "src/a.ts")).toBe(false);

      // b was not added to the context, so c should also be pruned
      const c = makeNode("src/c.ts", [{ path: "src/b.ts", symbols: ["anything"] }]);
      expect(ctx.updateAffectedSymbols(c, "src/b.ts")).toBe(false);
    });

    test("merges new symbols into an existing entry rather than overwriting", () => {
      const ctx = new SymbolTraversalContext("src/a.ts", ["foo"]);

      const b = makeNode("src/b.ts", [{ path: "src/a.ts", symbols: ["foo"] }]);
      ctx.updateAffectedSymbols(b, "src/a.ts");

      // second call via a different ancestor adds more affected info
      const b2 = makeNode("src/b.ts", [{ path: "src/a.ts", symbols: ["bar"] }]);
      ctx.updateAffectedSymbols(b2, "src/a.ts");

      // both paths should leave b in the context; c importing from b should still be affected
      const c = makeNode("src/c.ts", [{ path: "src/b.ts", symbols: ["*"] }]);
      expect(ctx.updateAffectedSymbols(c, "src/b.ts")).toBe(true);
    });
  });
});
