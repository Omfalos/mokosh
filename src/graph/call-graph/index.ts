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
 * Call edges are populated only for languages whose adapter declares the `callEdges`
 * capability (see `CALL_EDGE_TYPES` in `../language-support`, and each adapter's `fidelity`/
 * `caveats` for how complete that language's extraction is). Functions in other language files
 * will return empty `callers` and `callees` arrays.
 *
 * Universal scope limit, regardless of language: extraction only tracks calls to a symbol
 * reached through an explicit import. A call within the same file — to a function declared in
 * that file, however it's written (qualified or not) — is never recorded as a call edge, so a
 * function can show zero callers here despite having real in-file callers. This isn't a
 * per-language fidelity gap; it's a deliberate scope decision (call edges exist to power
 * cross-file blast-radius analysis, not a full same-file call graph) that every language's
 * extractor shares. See docs/adr-011-go-python-call-edges.md and docs/adr-021-kotlin-parsing.md.
 *
 * `definedIn` also has no disambiguation for a function/method name that's exported from more
 * than one file (e.g. an interface method implemented by several receiver types) — whichever
 * node the graph happens to visit last wins, silently. See docs/known_issues/ for tracked gaps.
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
