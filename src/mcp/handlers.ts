/**
 * MCP tool handlers — barrel. Each concern lives in `./handlers/<concern>.ts`; this file only
 * preserves the original public import path (`./handlers`) for `server.ts` and tests.
 */
export { handleFindDuplicates } from "./handlers/duplicates";
export {
  handleCheckDocDrift,
  handleCompareBranches,
  handleFindComplexFunctions,
  handleFindRiskHotspots,
  handleFindUncovered,
  handleFindUnused,
} from "./handlers/quality";
export { handleAnalyze, handleClearCache } from "./handlers/session";
export {
  handleDetectFeatures,
  handleGetApiSurface,
  handleGetFeatureGraph,
  handleGetModuleResponsibility,
  handleGetTypeGraph,
} from "./handlers/structure";
export { handleApplyTags, handleListTags, handleProposeTags } from "./handlers/tags";
export {
  handleFindSymbol,
  handleGetAffected,
  handleGetCallers,
  handleGetCallGraph,
  handleGetDependencies,
  handleGetDependents,
  handleQuery,
} from "./handlers/traversal";
export type * from "./handlers/types";
export { handleGetWorkspaceAffected, handleGetWorkspacePackages } from "./handlers/workspace";
