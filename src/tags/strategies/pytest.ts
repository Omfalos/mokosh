/**
 * Tag applier strategy for Python/pytest: writes a module-level `pytestmark` variable.
 * `pytestmark` applies marks to every test in the file without touching individual functions.
 *
 * Example output:
 *   import pytest
 *   pytestmark = [pytest.mark.auth, pytest.mark.parseArgs]
 *
 * Filter at CI time with: `pytest -m "auth and parseArgs"` or `pytest -m auth`
 * @see https://docs.pytest.org/en/stable/how-to/mark.html#marking-whole-classes-or-modules
 */
import path from "node:path";
import type { TagApplierStrategy } from "./types";

// Matches: pytestmark = [pytest.mark.foo, pytest.mark.bar]
// Also handles the single-mark form: pytestmark = pytest.mark.foo
const PYTESTMARK_RE = /^pytestmark\s*=\s*.+$/m;

// Matches the mokosh-managed import line
const PYTEST_IMPORT_RE = /^import pytest\s*$/m;

function buildPytestmark(tags: string[]): string {
  const marks = tags.map((tag) => `pytest.mark.${tag}`).join(", ");
  return tags.length === 1 ? `pytestmark = pytest.mark.${tags[0]}` : `pytestmark = [${marks}]`;
}

function readExistingMarks(source: string): string[] | null {
  const match = PYTESTMARK_RE.exec(source);
  if (!match) return null;
  const line = match[0];
  // Extract names from pytest.mark.<name>
  const marks: string[] = [];
  const re = /pytest\.mark\.([a-zA-Z0-9_-]+)/g;
  let markMatch = re.exec(line);
  while (markMatch !== null) {
    if (markMatch[1]) marks.push(markMatch[1]);
    markMatch = re.exec(line);
  }
  return marks;
}

export class PytestStrategy implements TagApplierStrategy {
  readonly name = "pytest";

  canHandle(absPath: string): boolean {
    return path.extname(absPath).toLowerCase() === ".py";
  }

  apply(_absPath: string, source: string, tags: string[]): string {
    const existing = readExistingMarks(source);
    const sortedTags = [...tags].sort();

    // Idempotency check
    if (existing !== null && JSON.stringify([...existing].sort()) === JSON.stringify(sortedTags)) {
      return source;
    }

    if (tags.length === 0) {
      // Remove pytestmark line (and the pytest import if we added it and it's now unused)
      return source.replace(PYTESTMARK_RE, "").replace(/\n{3,}/g, "\n\n");
    }

    const pytestmarkLine = buildPytestmark(sortedTags);

    if (existing !== null) {
      // Replace in-place
      return source.replace(PYTESTMARK_RE, pytestmarkLine);
    }

    // Insert after the last import block (or at the top if no imports)
    const hasImport = PYTEST_IMPORT_RE.test(source);

    // Find insertion point: after the last top-level import line
    const importBlockEnd = findImportBlockEnd(source);

    const before = source.slice(0, importBlockEnd);
    const after = source.slice(importBlockEnd);

    const importLine = hasImport ? "" : "import pytest\n";
    const separator = before.endsWith("\n\n") ? "" : "\n";

    return before + separator + importLine + pytestmarkLine + "\n" + after;
  }
}

/** Returns the index just after the last top-level import/from-import line. */
function findImportBlockEnd(source: string): number {
  const lines = source.split("\n");
  let lastImportLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trimStart();
    if (line.startsWith("import ") || line.startsWith("from ")) {
      lastImportLine = i;
    }
  }

  if (lastImportLine < 0) return 0;

  // Compute character offset of the end of that line
  let offset = 0;
  for (let i = 0; i <= lastImportLine; i++) {
    offset += lines[i]!.length + 1; // +1 for \n
  }
  return offset;
}
