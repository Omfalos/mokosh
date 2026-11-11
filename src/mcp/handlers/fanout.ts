/** Adds a `package` field to each `{ path }`-shaped result, looked up in `packageOf`. A no-op
 *  when `packageOf` is empty (plain, non-workspace root) so single-package output is untouched. */
export function withPackageMeta<T extends { path: string }>(
  items: T[],
  packageOf: Map<string, string>,
): Array<T & { package?: string }> {
  if (packageOf.size === 0) return items;
  return items.map((item) => {
    const pkg = packageOf.get(item.path);
    return pkg ? { ...item, package: pkg } : item;
  });
}

/** Tags each item in a list-shaped result with its owning package, but only when more than one
 *  package graph was actually queried — a single/non-monorepo result stays untouched. */
export function tagPackage<T extends object>(
  items: T[],
  pkg: string,
  multi: boolean,
): Array<T & { package?: string }> {
  return multi && pkg ? items.map((item) => ({ ...item, package: pkg })) : items;
}
