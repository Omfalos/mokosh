import type { ModuleRole } from "../../graph/responsibility/types";
import type { FileNode } from "../../types/node";
import type { ExportKind, LanguageHooks, TypeKind } from "../types";
import { inferJsExportKind } from "./export-kind";

/**
 * Classifies a JVM export from its declaration keyword (`class Foo`, `object Foo`, `fun foo`,
 * `val x`, `typealias A`, …), falling back to the TS/JS inference for shared keywords.
 *
 * @param {string | undefined} signature - Raw signature string from an `ExportedSymbol`.
 * @returns {ExportKind} Inferred kind, or `"unknown"` when absent or unrecognised.
 */
function jvmExportKind(signature: string | undefined): ExportKind {
  const trimmed = signature?.trimStart() ?? "";
  if (trimmed.startsWith("object ")) return "class";
  if (trimmed.startsWith("typealias ")) return "type";
  if (trimmed.startsWith("fun ")) return "function";
  if (trimmed.startsWith("val ")) return "const";
  return inferJsExportKind(signature);
}

/**
 * Every non-test source file is a public entry point — covers a single-repo JVM project not
 * detected as a Gradle/sbt workspace.
 *
 * @param {readonly FileNode[]} sources - Non-test JVM source nodes.
 * @returns {string[]} Sorted project-relative paths.
 */
function jvmEntryPoints(sources: readonly FileNode[]): string[] {
  return sources.map((node) => node.path).sort();
}

/**
 * Type-like exports: class / object / interface / enum / typealias declarations.
 *
 * @param {string | undefined} signature - Raw signature string from an `ExportedSymbol`.
 * @returns {TypeKind | undefined} The kind, or `undefined` for functions and values.
 */
function jvmTypeKind(signature: string | undefined): TypeKind | undefined {
  const trimmed = signature?.trimStart() ?? "";
  if (trimmed.startsWith("class ") || trimmed.startsWith("object ")) return "class";
  if (trimmed.startsWith("interface ")) return "interface";
  if (trimmed.startsWith("enum ")) return "enum";
  if (trimmed.startsWith("typealias ")) return "type";
  return undefined;
}

/** Type-name suffix → role, most specific first; the first suffix the file's type name ends with wins. */
const ROLE_SUFFIXES: readonly (readonly [string, ModuleRole])[] = [
  ["Controller", "controller"],
  ["Resource", "controller"],
  ["Endpoint", "controller"],
  ["Interceptor", "middleware"],
  ["Filter", "middleware"],
  ["Middleware", "middleware"],
  ["Repository", "store"],
  ["Dao", "store"],
  ["Store", "store"],
  ["Service", "service"],
  ["Manager", "service"],
  ["UseCase", "service"],
  ["Handler", "handler"],
  ["Listener", "handler"],
  ["Callback", "handler"],
  ["Adapter", "adapter"],
  ["Factory", "builder"],
  ["Builder", "builder"],
  ["Parser", "parser"],
  ["Decoder", "parser"],
  ["Resolver", "resolver"],
  ["Client", "api"],
  ["Api", "api"],
  ["Utils", "util"],
  ["Util", "util"],
  ["Helper", "util"],
  ["Extensions", "util"],
  ["Config", "config"],
  ["Configuration", "config"],
  ["Settings", "config"],
  ["Dto", "model"],
  ["Entity", "model"],
  ["Model", "model"],
];

/**
 * Role from JVM naming conventions: a type-name suffix (`*Client`, `*Repository`, …), or a file
 * whose primary export is an interface (a public contract → `"api"`).
 *
 * @param {FileNode} node - The file node to classify.
 * @returns {ModuleRole | undefined} The role, or `undefined` when no convention matches.
 */
function jvmRoleHint(node: FileNode): ModuleRole | undefined {
  const base = (node.path.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
  for (const [suffix, role] of ROLE_SUFFIXES) {
    if (base.length > suffix.length && base.endsWith(suffix)) return role;
  }
  const primary = node.exports.find((sym) => sym.name === base) ?? node.exports[0];
  if (primary?.signature?.startsWith("interface ")) return "api";
  return undefined;
}

export const JVM_HOOKS: LanguageHooks = {
  typeKind: jvmTypeKind,
  roleHint: jvmRoleHint,
  exportKind: jvmExportKind,
  entryPoints: jvmEntryPoints,
};
