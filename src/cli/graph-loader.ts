import fs from "node:fs";
import path from "node:path";
import { createImportMap, Graph } from "../index";

export function loadGraphFromCache(cachePath: string): Graph | null {
  if (!fs.existsSync(cachePath)) return null;
  const raw = fs.readFileSync(cachePath, "utf-8");
  return Graph.deserialize(JSON.parse(raw));
}

export function saveGraphToCache(graph: Graph, cachePath: string): void {
  const cacheDir = path.dirname(cachePath);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  fs.writeFileSync(cachePath, JSON.stringify(graph.serialize(), null, 2));
}

export async function buildGraph(
  rootDir: string,
  entryPoints: string[],
  cachedGraph: Graph | null,
  silent = false,
): Promise<Graph> {
  return createImportMap(rootDir, entryPoints, cachedGraph, { silent });
}
