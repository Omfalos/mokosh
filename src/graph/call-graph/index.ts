/** Queries the call-edge graph to find callers and callees at the function level. */
import type { Graph } from "../model";
import type { CalleeEntry, CallerEntry, FunctionCallInfo } from "./types";

export type { CalleeEntry, CallerEntry, FunctionCallInfo } from "./types";

/** Optional disambiguation for a function/method name that collides across files. */
export interface QueryCallGraphOptions {
  /**
   * Narrow the definition search to this one project-relative path. When passed, the search
   * considers only this file — this bypasses the ambiguity path entirely (even if the name
   * collides elsewhere in the graph) and behaves exactly like the single-match case: a precise,
   * unambiguous `definedIn`/`callees` for that file specifically. `callers` is never scoped by
   * `file` — it's independent of which file defines the callee (see `queryCallGraph`'s doc).
   *
   * A per-receiver-type disambiguator (e.g. a Go method's receiver type) is deferred — see
   * docs/known_issues/13-call-graph-definition-ambiguity.md decision 4. `file` is the only
   * disambiguator shipped so far.
   */
  file?: string;
  /**
   * When `true`, adds a `candidates: string[]` field listing every file whose exports match
   * `functionName` (length === `definedInCandidateCount`). Opt-in to keep the common,
   * unambiguous response small. Default `false`.
   */
  includeCandidates?: boolean;
}

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
 * Disambiguation: when `functionName` is exported by more than one file (an interface method
 * implemented by several receiver types, or a common helper name reused across packages),
 * `definedInCandidateCount` reports how many files matched. In the unambiguous case (exactly
 * one match, the common case) `definedIn`/`callees` behave exactly as before — zero regression.
 * When it's ambiguous and no `options.file` was passed, `definedIn` is `null` (not a guess) and
 * `callees` is empty (computing it would require picking one file, which is exactly the silent
 * guess this exists to avoid); `callers` is unaffected, since it's computed independently of
 * which file "really" defines the name. Pass `options.file` to narrow the search to one
 * specific file and get a precise answer anyway, or `options.includeCandidates` to see every
 * matching file. See docs/known_issues/13-call-graph-definition-ambiguity.md.
 *
 * @param {Graph} graph - The import graph that carries `callEdges` on each node.
 * @param {string} functionName - Exact name of the function to look up.
 * @param {QueryCallGraphOptions} [options] - Optional `file` disambiguator and/or
 *   `includeCandidates` flag.
 * @returns {FunctionCallInfo} Caller/callee lists plus `definedInCandidateCount`; `definedIn` is
 *   `null` if the function is not exported anywhere, or if it's ambiguous and not disambiguated.
 */
export function queryCallGraph(
  graph: Graph,
  functionName: string,
  options: QueryCallGraphOptions = {},
): FunctionCallInfo {
  const { file, includeCandidates = false } = options;

  // Mirrors findSymbol's (src/graph/symbol.ts) "collect every matching node" pattern rather than
  // overwriting a single variable while iterating — that overwrite-on-match bug is exactly what
  // this function used to have. Not factored into a shared helper with findSymbol/issue 12 on
  // purpose — see docs/known_issues/13-call-graph-definition-ambiguity.md decision 5.
  const candidates: string[] = [];
  for (const node of graph.nodes.values()) {
    if (file !== undefined && node.path !== file) continue;
    if (node.exports.some((exportedSym) => exportedSym.name === functionName)) {
      candidates.push(node.path);
    }
  }

  const callers: CallerEntry[] = [];
  for (const node of graph.nodes.values()) {
    for (const edge of node.callEdges ?? []) {
      if (edge.to === functionName) {
        callers.push({ file: node.path, callerFunction: edge.from });
      }
    }
  }

  const definedInCandidateCount = candidates.length;
  const definedIn = candidates.length === 1 ? (candidates[0] ?? null) : null;

  const callees: CalleeEntry[] = [];
  if (definedIn) {
    const defNode = graph.nodes.get(definedIn);
    for (const edge of defNode?.callEdges ?? []) {
      if (edge.from === functionName) {
        callees.push({ file: edge.toFile, calleeFunction: edge.to });
      }
    }
  }

  return {
    functionName,
    definedIn,
    definedInCandidateCount,
    callers,
    callees,
    ...(includeCandidates && { candidates }),
  };
}
