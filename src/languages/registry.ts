/** Language adapter registry — the one place that knows which languages exist and what each provides. */
import type { FileType } from "../types/parse";
import { GO_ADAPTER } from "./adapters/go";
import { JAVASCRIPT_ADAPTER, TYPESCRIPT_ADAPTER } from "./adapters/js";
import { GROOVY_ADAPTER, JAVA_ADAPTER, KOTLIN_ADAPTER, SCALA_ADAPTER } from "./adapters/jvm";
import {
  COFFEESCRIPT_ADAPTER,
  GHERKIN_ADAPTER,
  LIVESCRIPT_ADAPTER,
  LUA_ADAPTER,
  MARKDOWN_ADAPTER,
  UNKNOWN_ADAPTER,
} from "./adapters/misc";
import { PYTHON_ADAPTER } from "./adapters/python";
import { CSS_ADAPTER, LESS_ADAPTER, SCSS_ADAPTER, STYLUS_ADAPTER } from "./adapters/style";
import type { LanguageAdapter, LanguageCapabilities, LanguageFamily } from "./types";

/** Every adapter, in a stable order. Adding a language means adding its adapter here. */
export const LANGUAGE_ADAPTERS: readonly LanguageAdapter[] = [
  TYPESCRIPT_ADAPTER,
  JAVASCRIPT_ADAPTER,
  PYTHON_ADAPTER,
  GO_ADAPTER,
  JAVA_ADAPTER,
  KOTLIN_ADAPTER,
  SCALA_ADAPTER,
  GROOVY_ADAPTER,
  COFFEESCRIPT_ADAPTER,
  LIVESCRIPT_ADAPTER,
  LUA_ADAPTER,
  CSS_ADAPTER,
  SCSS_ADAPTER,
  LESS_ADAPTER,
  STYLUS_ADAPTER,
  GHERKIN_ADAPTER,
  MARKDOWN_ADAPTER,
  UNKNOWN_ADAPTER,
];

const byType = new Map<FileType, LanguageAdapter>(
  LANGUAGE_ADAPTERS.map((adapter) => [adapter.type, adapter]),
);

const byExtension = new Map<string, FileType>(
  LANGUAGE_ADAPTERS.flatMap((adapter) =>
    adapter.extensions.map((ext): [string, FileType] => [ext, adapter.type]),
  ),
);

/**
 * @description Looks up the adapter for a file type.
 * @param {FileType} type - The language to look up.
 * @returns {LanguageAdapter} Its adapter; every `FileType` has one (`"unknown"` included).
 */
export function getAdapter(type: FileType): LanguageAdapter {
  return byType.get(type) as LanguageAdapter;
}

/**
 * @description Maps a lower-case file extension to its language.
 * @param {string} ext - Extension including the leading dot (e.g. `".kt"`).
 * @returns {FileType} The language, or `"unknown"` for an unregistered extension.
 */
export function fileTypeForExtension(ext: string): FileType {
  return byExtension.get(ext) ?? "unknown";
}

/**
 * @description Collects the file types whose adapter declares a capability.
 * @param {keyof LanguageCapabilities} capability - The capability flag to filter on.
 * @returns {ReadonlySet<FileType>} Every language with that flag set.
 */
export function typesWithCapability(capability: keyof LanguageCapabilities): ReadonlySet<FileType> {
  return new Set(
    LANGUAGE_ADAPTERS.filter((adapter) => adapter.capabilities[capability]).map(
      (adapter) => adapter.type,
    ),
  );
}

/**
 * @description Collects the file types belonging to a language family.
 * @param {LanguageFamily} family - The family (e.g. `"jvm"`).
 * @returns {ReadonlySet<FileType>} Every language in that family.
 */
export function typesInFamily(family: LanguageFamily): ReadonlySet<FileType> {
  return new Set(
    LANGUAGE_ADAPTERS.filter((adapter) => adapter.family === family).map((adapter) => adapter.type),
  );
}
