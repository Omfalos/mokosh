/** Public types for the call-graph subsystem. */

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
