import { GoLangResolver } from "./go";
import { JvmLangResolver } from "./jvm";
import { LuaLangResolver } from "./lua";
import { MarkdownLangResolver } from "./markdown";
import { PythonLangResolver } from "./python";
import { StyleLangResolver } from "./style";
import type { LangResolver } from "./types";

export { GoLangResolver } from "./go";
export { JvmLangResolver } from "./jvm";
export { LuaLangResolver } from "./lua";
export { MarkdownLangResolver } from "./markdown";
export { PythonLangResolver } from "./python";
export { StyleLangResolver } from "./style";
export type { LangResolver, ResolvedImport } from "./types";

/**
 * @description Builds the default ordered list of language resolvers used by `DefaultResolver`
 *   for bare-specifier resolution (Python, Lua, Go, JVM, style, Markdown).
 * @param overrides - Pre-constructed resolver instances to substitute by class. Used by
 *   `createWorkspaceGraph` to inject a single `JvmLangResolver` whose package index is then
 *   built once and shared across every package build instead of rebuilt per package.
 * @returns A fresh array of resolver instances.
 */
export function defaultLangResolvers(overrides: { jvm?: JvmLangResolver } = {}): LangResolver[] {
  return [
    new PythonLangResolver(),
    new LuaLangResolver(),
    new GoLangResolver(),
    overrides.jvm ?? new JvmLangResolver(),
    new StyleLangResolver(),
    new MarkdownLangResolver(),
  ];
}
