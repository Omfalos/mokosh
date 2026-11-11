import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { detectAllEntryPoints } from "./api-surface";
import { Graph } from "./model";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-entry-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const graphWith = (...paths: string[]) =>
  new Graph(
    new Map(
      paths.map((p) => [
        p,
        {
          path: p,
          type: "typescript",
          category: "logic",
          imports: [],
          exports: [],
          tags: [],
          mtime: 1,
          size: 1,
        },
      ]),
    ),
  );
const writePkg = (value: string) => fs.writeFileSync(path.join(root, "package.json"), value);

describe("detectAllEntryPoints — package.json edge cases", () => {
  test("a string `exports` field resolves to a single entry point", () => {
    writePkg(JSON.stringify({ exports: "./dist/index.js" }));
    expect(detectAllEntryPoints(graphWith("src/index.ts"), root)).toEqual(["src/index.ts"]);
  });

  test("malformed package.json is ignored and the well-known candidates are used", () => {
    writePkg("{ not json");
    expect(detectAllEntryPoints(graphWith("index.js"), root)).toEqual(["index.js"]);
  });

  test("an array-valued exports/bin is ignored rather than treated as a map", () => {
    writePkg(JSON.stringify({ exports: ["./a.js"], bin: ["./b.js"], main: "./dist/index.js" }));
    expect(detectAllEntryPoints(graphWith("src/index.ts"), root)).toEqual(["src/index.ts"]);
  });

  test("`module` is used when `main` does not resolve", () => {
    writePkg(JSON.stringify({ main: "./dist/missing.js", module: "./dist/esm.js" }));
    expect(detectAllEntryPoints(graphWith("src/esm.ts"), root)).toEqual(["src/esm.ts"]);
  });
});
