/** Queries the call-edge graph to find callers and callees at the function level. */
import type { Graph } from "./model";

/** A file and function name that calls the target function. */
export interface CallerEntry {
  /** Project-relative path of the file containing the caller. */
  file: string;
  /** Name of the function that makes the call. */
  callerFunction: string;
}

/** A file and function name that the target function calls. */
export interface CalleeEntry {
  /** Project-relative path of the file containing the callee. */
  file: string;
  /** Name of the function being called. */
  calleeFunction: string;
}

/**
 * Function-level call relationships for a single named function.
 * A token-efficient answer to "who calls X?" and "what does X call?"
 * without sending the full graph to the AI.
 */
export interface FunctionCallInfo {
  /** The function name that was queried. */
  functionName: string;
  /**
   * Project-relative path of the file that exports or defines this function.
   * `null` when no file in the graph exports a symbol with this name.
   */
  definedIn: string | null;
  /** Files and functions that call this function. */
  callers: CallerEntry[];
  /** Files and functions that this function calls. */
  callees: CalleeEntry[];
}

/**
 * Queries the call graph for a named function, returning its callers and callees.
 *
 * Callers are found by scanning every node's `callEdges` for edges whose `to`
 * field matches `functionName`. Callees are found by looking at the defining
 * file's `callEdges` for edges whose `from` field matches `functionName`.
 *
 * Call edges are populated only for TypeScript/JavaScript files. Functions in
 * other language files will return empty `callers` and `callees` arrays.
 *
 * @param graph - The import graph that carries `callEdges` on each node.
 * @param functionName - Exact name of the function to look up.
 * @returns `FunctionCallInfo` with caller/callee lists; `definedIn` is `null` if the function is not exported.
 */
export function queryCallGraph(graph: Graph, functionName: string): FunctionCallInfo {
  let definedIn: string | null = null;
  const callers: CallerEntry[] = [];

  for (const node of graph.nodes.values()) {
    if (node.exports.some((e) => e.name === functionName)) {
      definedIn = node.path;
    }

    for (const edge of node.callEdges ?? []) {
      if (edge.to === functionName) {
        callers.push({ file: node.path, callerFunction: edge.from });
      }
    }
  }

  const callees: CalleeEntry[] = [];
  if (definedIn) {
    const defNode = graph.nodes.get(definedIn);
    for (const edge of defNode?.callEdges ?? []) {
      if (edge.from === functionName) {
        callees.push({ file: edge.toFile, calleeFunction: edge.to });
      }
    }
  }

  return { functionName, definedIn, callers, callees };
}
