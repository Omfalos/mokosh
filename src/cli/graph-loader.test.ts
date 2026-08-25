import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configToGraphOptions, Graph } from "../index";
import { buildGraph, loadGraphFromCache, saveGraphToCache } from "./graph-loader";

describe("graph-loader", { tags: ["graph-loader"] }, () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-graph-loader-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("loadGraphFromCache", () => {
    it("returns null when the cache file does not exist", () => {
      expect(loadGraphFromCache(path.join(dir, "graph.json"))).toBeNull();
    });

    it("deserializes a previously saved graph", () => {
      const cachePath = path.join(dir, "graph.json");
      const original = Graph.deserialize({
        nodes: [
          {
            path: "src/a.ts",
            type: "typescript",
            category: "logic",
            tags: [],
            imports: [],
            exports: [],
            mtime: 0,
            size: 0,
          },
        ],
      });
      saveGraphToCache(original, cachePath);

      const restored = loadGraphFromCache(cachePath);

      expect(restored?.nodes.get("src/a.ts")?.path).toBe("src/a.ts");
    });
  });

  describe("saveGraphToCache", () => {
    it("creates missing parent directories before writing", () => {
      const cachePath = path.join(dir, "nested", "cache", "graph.json");

      saveGraphToCache(new Graph(new Map()), cachePath);

      expect(fs.existsSync(cachePath)).toBe(true);
    });

    it("writes a JSON-serialized snapshot readable by loadGraphFromCache", () => {
      const cachePath = path.join(dir, "graph.json");
      saveGraphToCache(new Graph(new Map()), cachePath);

      const raw = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
      expect(raw).toEqual({ nodes: [] });
    });
  });

  describe("buildGraph", () => {
    it("builds a graph by walking real entry points from disk", async () => {
      fs.writeFileSync(path.join(dir, "index.ts"), "export const a = 1;\n");

      const graph = await buildGraph(dir, [path.join(dir, "index.ts")], null, {
        silent: true,
        ...configToGraphOptions(undefined),
      });

      expect(graph.nodes.has("index.ts")).toBe(true);
    });

    it("reuses a previously built graph as an incremental base", async () => {
      fs.writeFileSync(path.join(dir, "index.ts"), "export const a = 1;\n");
      const first = await buildGraph(dir, [path.join(dir, "index.ts")], null, {
        silent: true,
        ...configToGraphOptions(undefined),
      });

      const second = await buildGraph(dir, [path.join(dir, "index.ts")], first, {
        silent: true,
        ...configToGraphOptions(undefined),
      });

      expect(second.nodes.has("index.ts")).toBe(true);
    });
  });
});
