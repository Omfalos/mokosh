/** Integration: `createWorkspaceGraph` must build the JVM package-declaration index once for
 *  the whole monorepo, not once per package (see
 *  docs/known_issues/01-monorepo-workspace-packages-timeout.md, fix 1A). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createWorkspaceGraph } from "../../index";

let root: string;

function write(rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-shared-jvm-"));
  write("settings.gradle", "include ':app', ':lib', ':util'\n");
  write(
    "app/src/main/java/com/example/app/App.java",
    "package com.example.app;\nimport com.example.lib.Lib;\npublic class App { Lib l; }\n",
  );
  write(
    "lib/src/main/java/com/example/lib/Lib.java",
    "package com.example.lib;\nimport com.example.util.Util;\npublic class Lib { Util u; }\n",
  );
  write(
    "util/src/main/java/com/example/util/Util.java",
    "package com.example.util;\npublic class Util {}\n",
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("createWorkspaceGraph — shared JVM package index", { tags: ["workspace", "jvm"] }, () => {
  test("reads each .java file's package line once, not once per package build", async () => {
    const openSpy = vi.spyOn(fs, "openSync");

    const wg = await createWorkspaceGraph(root, { silent: true, parallelParsing: false });

    const javaPackageReads = openSpy.mock.calls.filter((call) =>
      String(call[0]).endsWith(".java"),
    ).length;

    // 3 source files → 3 package-line reads. A per-package index rebuild would be 3 × 3 = 9.
    expect(wg.packages.size).toBe(3);
    expect(javaPackageReads).toBe(3);
  });

  test("resolves cross-module FQN imports into workspace dependency edges", async () => {
    const wg = await createWorkspaceGraph(root, { silent: true, parallelParsing: false });
    const deps = wg.getPackageDependencies();

    expect(deps.get("app")).toContain("lib");
    expect(deps.get("lib")).toContain("util");
  });

  test("additionalIgnoreDirs prunes a generated source tree from the package index", async () => {
    write("codegen/com/example/gen/Gen.java", "package com.example.gen;\npublic class Gen {}\n");
    write(
      "app/src/main/java/com/example/app/UsesGen.java",
      "package com.example.app;\nimport com.example.gen.Gen;\npublic class UsesGen { Gen g; }\n",
    );

    const indexed = await createWorkspaceGraph(root, { silent: true, parallelParsing: false });
    expect(indexed.packages.get("app")?.graph.nodes.has("codegen/com/example/gen/Gen.java")).toBe(
      true,
    );

    const pruned = await createWorkspaceGraph(root, {
      silent: true,
      parallelParsing: false,
      additionalIgnoreDirs: ["codegen"],
    });
    expect(pruned.packages.get("app")?.graph.nodes.has("codegen/com/example/gen/Gen.java")).toBe(
      false,
    );
  });

  test("package order and edges are identical under sequential and concurrent builds", async () => {
    process.env.MOKOSH_WORKSPACE_CONCURRENCY = "1";
    const sequential = await createWorkspaceGraph(root, { silent: true, parallelParsing: false });
    process.env.MOKOSH_WORKSPACE_CONCURRENCY = "8";
    const concurrent = await createWorkspaceGraph(root, { silent: true, parallelParsing: false });
    delete process.env.MOKOSH_WORKSPACE_CONCURRENCY;

    expect([...concurrent.packages.keys()]).toEqual([...sequential.packages.keys()]);
    expect(Object.fromEntries(concurrent.getPackageDependencies())).toEqual(
      Object.fromEntries(sequential.getPackageDependencies()),
    );
  });
});

// Issue 22: a Gradle composite build (`includeBuild`) outside the analyzed root, named
// explicitly via `extraRoots` — the one case the ordinary `include(...)` path above doesn't
// cover, since that detector only ever sees modules inside `root`.
describe("createWorkspaceGraph — extraRoots (external composite build)", {
  tags: ["workspace", "jvm"],
}, () => {
  let externalRoot: string;

  beforeEach(() => {
    externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-external-build-"));
    fs.mkdirSync(path.join(externalRoot, "src/main/kotlin/com/example/shared"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(externalRoot, "src/main/kotlin/com/example/shared/Shared.kt"),
      "package com.example.shared\nclass Shared\n",
    );
  });

  afterEach(() => {
    fs.rmSync(externalRoot, { recursive: true, force: true });
  });

  test("without extraRoots, an in-root package can't see the external build at all", async () => {
    write(
      "app/src/main/java/com/example/app/UsesShared.java",
      "package com.example.app;\nimport com.example.shared.Shared;\npublic class UsesShared { Shared s; }\n",
    );
    const wg = await createWorkspaceGraph(root, { silent: true, parallelParsing: false });
    expect(wg.packages.size).toBe(3);
    expect(wg.getPackageDependencies().get("app")).not.toContain(path.basename(externalRoot));
  });

  test("an extraRoot becomes its own package, flagged externalRoot, with an escaping relativeRoot", async () => {
    const wg = await createWorkspaceGraph(root, {
      silent: true,
      parallelParsing: false,
      extraRoots: [externalRoot],
    });
    const name = path.basename(externalRoot);
    expect(wg.packages.size).toBe(4);
    const entry = wg.packages.get(name);
    expect(entry?.pkg.externalRoot).toBe(true);
    expect(entry?.pkg.relativeRoot.startsWith("..")).toBe(true);
  });

  test("an in-root file resolves a type declared only in the external build, no Gradle involved", async () => {
    write(
      "app/src/main/java/com/example/app/UsesShared.java",
      "package com.example.app;\nimport com.example.shared.Shared;\npublic class UsesShared { Shared s; }\n",
    );
    const wg = await createWorkspaceGraph(root, {
      silent: true,
      parallelParsing: false,
      extraRoots: [externalRoot],
    });
    const name = path.basename(externalRoot);
    expect(wg.getPackageDependencies().get("app")).toContain(name);
  });

  test("the external build's own file resolves a type declared in the main tree", async () => {
    fs.writeFileSync(
      path.join(externalRoot, "src/main/kotlin/com/example/shared/Shared.kt"),
      "package com.example.shared\nimport com.example.util.Util\nclass Shared { val u: Util? = null }\n",
    );
    const wg = await createWorkspaceGraph(root, {
      silent: true,
      parallelParsing: false,
      extraRoots: [externalRoot],
    });
    const name = path.basename(externalRoot);
    expect(wg.getPackageDependencies().get(name)).toContain("util");
  });

  test("a relative extraRoots entry resolves against rootDir", async () => {
    const relativeExtraRoot = path.relative(root, externalRoot);
    const wg = await createWorkspaceGraph(root, {
      silent: true,
      parallelParsing: false,
      extraRoots: [relativeExtraRoot],
    });
    expect(wg.packages.has(path.basename(externalRoot))).toBe(true);
  });

  test("an extraRoots entry with no JVM source files is silently skipped", async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-external-empty-"));
    try {
      const wg = await createWorkspaceGraph(root, {
        silent: true,
        parallelParsing: false,
        extraRoots: [empty],
      });
      expect(wg.packages.size).toBe(3);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
