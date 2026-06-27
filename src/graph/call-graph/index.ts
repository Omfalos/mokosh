/** Queries the call-edge graph to find callers and callees at the function level. */
import type { Graph } from "../model";
import type { CalleeEntry, CallerEntry, FunctionCallInfo } from "./types";

export type { CalleeEntry, CallerEntry, FunctionCallInfo } from "./types";

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
 * @param {Graph} graph - The import graph that carries `callEdges` on each node.
 * @param {string} functionName - Exact name of the function to look up.
 * @returns {FunctionCallInfo} Caller/callee lists; `definedIn` is `null` if the function is not exported.
 */
export function queryCallGraph(graph: Graph, functionName: string): FunctionCallInfo {
  let definedIn: string | null = null;
  const callers: CallerEntry[] = [];

  for (const node of graph.nodes.values()) {
    if (node.exports.some((exportedSym) => exportedSym.name === functionName)) {
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
