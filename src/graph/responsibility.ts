/** Builds a ResponsibilityGraph assigning each file a semantic role (gateway, orchestrator, leaf, etc.) based on its connectivity and feature membership. */
import type { FileNode } from "../types/node";
import { buildFeatureGraph } from "./features/feature-graph";
import type { FeatureDetectionOptions } from "./features/index";
import type { Graph } from "./model";

/**
 * Semantic role of a module derived from its file path and category.
 * Used as a coarse grouping for display and filtering.
 */
export type ModuleRole =
  | "parser"
  | "builder"
  | "resolver"
  | "enricher"
  | "model"
  | "cli"
  | "mcp"
  | "test"
  | "config"
  | "types"
  | "exporter"
  | "query"
  | "tags"
  | "workspace"
  | "other";

/**
 * What a single module is responsible for, derived purely from graph data.
 * No inference or hallucination — only data already present in the `FileNode`.
 */
export interface ModuleResponsibility {
  /** Project-relative file path. */
  path: string;
  /** Coarse semantic role inferred from file path and category. */
  role: ModuleRole;
  /**
   * Human-readable description extracted from the file's leading JSDoc comment.
   * `undefined` when the file has no file-level JSDoc.
   */
  description?: string;
  /** Names of all exported symbols (functions, types, classes). */
  exports: string[];
  /**
   * Name of the feature hub this file belongs to, if any.
   * Derived from `buildFeatureGraph` with default threshold.
   */
  featureHub?: string;
}

/**
 * Map from project-relative path to its responsibility record.
 * A token-efficient answer to "what does module X do?" across many files at once.
 */
export type ResponsibilityGraph = Map<string, ModuleResponsibility>;

/**
 * Infers a coarse `ModuleRole` from a file's path and graph category.
 * Matches by path substring so it works across any project layout.
 *
 * @param node - The file node to classify.
 * @returns The best-matching role, defaulting to `"other"`.
 */
function inferRole(node: FileNode): ModuleRole {
  if (node.category === "test") return "test";
  if (node.category === "config") return "config";
  if (node.category === "type-only") return "types";

  const p = node.path;
  if (p.includes("/mcp/") || p.endsWith("mcp.ts")) return "mcp";
  if (p.includes("/cli/") || p.endsWith("cli.ts")) return "cli";
  if (p.includes("/workspace/")) return "workspace";
  if (p.includes("/exporters/") || p.includes("exporter")) return "exporter";
  if (p.includes("/query/")) return "query";
  if (p.includes("/tags/")) return "tags";
  if (p.includes("enrichment")) return "enricher";
  if (p.includes("resolver")) return "resolver";
  if (p.includes("builder")) return "builder";
  if (p.includes("/parser/") || p.endsWith("parser.ts")) return "parser";
  if (p.includes("model")) return "model";
  return "other";
}

/**
 * Builds a responsibility map for every non-test file in the graph.
 *
 * Each entry is derived entirely from data already present in the `FileNode`:
 * - `description` comes from the file's leading JSDoc (`FileNode.description`)
 * - `exports` are the exported symbol names
 * - `role` is inferred from file path and category
 * - `featureHub` is resolved via `buildFeatureGraph` with default options
 *
 * Test files are included with `role: "test"` so callers can filter them if needed.
 *
 * @param graph - The import graph to derive responsibilities from.
 * @param featureOptions - Options forwarded to `buildFeatureGraph` (e.g. `minOutDegree`).
 * @returns A `ResponsibilityGraph` mapping each file path to its `ModuleResponsibility`.
 */
export function buildResponsibilityGraph(
  graph: Graph,
  featureOptions?: FeatureDetectionOptions,
): ResponsibilityGraph {
  const featureGraph = buildFeatureGraph(graph, featureOptions);

  // Build a reverse map: file path → feature hub name.
  const fileToHub = new Map<string, string>();
  for (const [featureName, domain] of featureGraph.features) {
    for (const filePath of domain.files) {
      fileToHub.set(filePath, featureName);
    }
    // The hub itself belongs to its own feature.
    fileToHub.set(domain.hub, featureName);
  }

  const result: ResponsibilityGraph = new Map();
  for (const node of graph.nodes.values()) {
    const hub = fileToHub.get(node.path);
    result.set(node.path, {
      path: node.path,
      role: inferRole(node),
      ...(node.description ? { description: node.description } : {}),
      exports: node.exports.map((e) => e.name),
      ...(hub ? { featureHub: hub } : {}),
    });
  }

  return result;
}
