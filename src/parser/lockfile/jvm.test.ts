import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { loadLockFile } from "./index";
import { loadJvmDependencies } from "./jvm";

describe("loadJvmDependencies", { tags: ["lockfile", "jvm", "gradle", "sbt"] }, () => {
  test("merges sources with catalog winning over build script", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-jvm-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "gradle"));
      fs.writeFileSync(
        path.join(tmpDir, "gradle", "libs.versions.toml"),
        `[libraries]\nokhttp = "com.squareup.okhttp3:okhttp:4.12.0"\n`,
      );
      fs.mkdirSync(path.join(tmpDir, "app"));
      fs.writeFileSync(
        path.join(tmpDir, "app", "build.gradle"),
        `dependencies {\n  implementation "com.squareup.okhttp3:okhttp:3.0.0"\n  implementation "com.google.code.gson:gson:2.10.1"\n}\n`,
      );

      const deps = loadJvmDependencies(tmpDir);
      expect(deps).not.toBeNull();
      expect(deps?.["com.squareup.okhttp3"]?.version).toBe("4.12.0"); // catalog wins
      expect(deps?.["com.google.code.gson"]?.version).toBe("2.10.1"); // from per-module script
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("returns null when no JVM metadata exists", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-jvm-"));
    try {
      expect(loadJvmDependencies(tmpDir)).toBeNull();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("loadLockFile ecosystem composition", { tags: ["lockfile", "jvm"] }, () => {
  test("attaches jvmDependencies with no JS lock file present", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-jvm-"));
    try {
      fs.writeFileSync(
        path.join(tmpDir, "build.sbt"),
        `libraryDependencies += "org.typelevel" %% "cats-core" % "2.10.0"\n`,
      );
      const result = loadLockFile(tmpDir);
      expect(result).not.toBeNull();
      expect(result?.dependencies).toEqual({});
      expect(result?.jvmDependencies?.["org.typelevel"]?.version).toBe("2.10.0");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
