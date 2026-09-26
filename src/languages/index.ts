export { detectNonJsEntryPoints, exportKindFor, looksLikeTestPath } from "./dispatch";
export {
  fileTypeForExtension,
  getAdapter,
  LANGUAGE_ADAPTERS,
  typesInFamily,
  typesWithCapability,
} from "./registry";
export type {
  ExportKind,
  FidelityLevel,
  LanguageAdapter,
  LanguageCapabilities,
  LanguageFamily,
  LanguageFidelity,
  LanguageHooks,
  TypeKind,
} from "./types";
