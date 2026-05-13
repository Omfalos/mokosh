/**
 * @description Removes a single surrounding quote pair (`'` or `"`) from a string if one
 *   is present. Safe to call on already-unquoted values — returns the input unchanged.
 * @param value - The string to unquote.
 * @returns The unquoted string, or the original value if it was not quoted.
 */
export function stripQuotes(value: string): string {
  return value.startsWith("'") || value.startsWith('"') ? value.slice(1, -1) : value;
}
