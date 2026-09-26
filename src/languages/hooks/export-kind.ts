import type { ExportKind } from "../types";

/**
 * Infers a coarse `ExportKind` from the leading keyword of a TS/JS-style signature string. The
 * default for languages without their own `exportKind` hook.
 *
 * @param {string | undefined} signature - Raw signature string from an `ExportedSymbol`.
 * @returns {ExportKind} Inferred kind, or `"unknown"` when the signature is absent or unrecognised.
 */
export function inferJsExportKind(signature: string | undefined): ExportKind {
  if (!signature) return "unknown";
  const trimmed = signature.trimStart();
  if (trimmed.startsWith("interface ")) return "interface";
  if (trimmed.startsWith("class ")) return "class";
  if (trimmed.startsWith("enum ")) return "enum";
  if (trimmed.startsWith("type ")) return "type";
  if (trimmed.startsWith("namespace ")) return "namespace";
  if (
    trimmed.startsWith("const ") ||
    trimmed.startsWith("let ") ||
    trimmed.startsWith("var ") ||
    trimmed.startsWith("readonly ")
  )
    return "const";
  // Function signatures: leading `(`, async keyword, or contains `=>`
  if (
    trimmed.startsWith("(") ||
    trimmed.startsWith("async ") ||
    trimmed.startsWith("function ") ||
    trimmed.includes("=>")
  )
    return "function";
  return "unknown";
}
