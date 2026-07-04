/**
 * Tag applier strategy for Go test files (*_test.go): writes a `//go:build` constraint
 * using a `mokosh_<tag>` prefix so the tags remain opt-in and don't affect normal builds.
 *
 * Example output (inserted before the package declaration):
 *   //go:build mokosh_auth || mokosh_parseArgs
 *
 * The `||` (OR) semantics mean: include this file when ANY of the listed tags is active.
 * Filter at CI time with: `go test -tags mokosh_auth ./...`
 *
 * If the file already has a non-mokosh `//go:build` line (e.g. `//go:build integration`),
 * the strategy leaves it untouched and writes a separate mokosh build tag line.
 *
 * Note: Go has no runtime test-tag system comparable to pytest marks or Vitest tags.
 * Build tags are the closest standard mechanism. Teams preferring a non-build-constraint
 * approach may skip this strategy by not using mokosh with Go test files.
 */
import path from "node:path";
import type { TagApplierStrategy } from "./types";

const MOKOSH_BUILD_TAG_RE = /^\/\/go:build mokosh_[^\n]+\n/m;
const PACKAGE_LINE_RE = /^package\s+\S+/m;

function buildBuildTag(tags: string[]): string {
  const constraints = tags.map((t) => `mokosh_${t}`).join(" || ");
  return `//go:build ${constraints}\n`;
}

function readExistingTags(source: string): string[] | null {
  const match = MOKOSH_BUILD_TAG_RE.exec(source);
  if (!match) return null;
  const line = match[0]!;
  const re = /mokosh_([a-zA-Z0-9_-]+)/g;
  const tags: string[] = [];
  let m = re.exec(line);
  while (m !== null) {
    if (m[1]) tags.push(m[1]);
    m = re.exec(line);
  }
  return tags;
}

export class GoStrategy implements TagApplierStrategy {
  readonly name = "go";

  canHandle(absPath: string): boolean {
    const base = path.basename(absPath);
    return base.endsWith("_test.go");
  }

  apply(_absPath: string, source: string, tags: string[]): string {
    const existing = readExistingTags(source);
    const sortedTags = [...tags].sort();

    // Idempotency check
    if (existing !== null && JSON.stringify([...existing].sort()) === JSON.stringify(sortedTags)) {
      return source;
    }

    if (tags.length === 0) {
      return source.replace(MOKOSH_BUILD_TAG_RE, "");
    }

    const buildTag = buildBuildTag(sortedTags);

    if (existing !== null) {
      return source.replace(MOKOSH_BUILD_TAG_RE, buildTag);
    }

    // Insert before the package declaration
    const packageMatch = PACKAGE_LINE_RE.exec(source);
    if (!packageMatch) return source;

    const insertAt = packageMatch.index!;
    return source.slice(0, insertAt) + buildTag + "\n" + source.slice(insertAt);
  }
}
