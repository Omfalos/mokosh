import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseJacocoReport } from "./jvm-gradle";

describe("parseJacocoReport", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-jacoco-test-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("resolves a sourcefile under src/main/java when it exists there", () => {
    fs.mkdirSync(path.join(dir, "src/main/java/com/example"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src/main/java/com/example/Foo.java"), "class Foo {}");

    const xml = `<report>
      <package name="com/example">
        <sourcefile name="Foo.java">
          <counter type="INSTRUCTION" missed="4" covered="6"/>
          <counter type="LINE" missed="2" covered="8"/>
        </sourcefile>
      </package>
    </report>`;

    const result = parseJacocoReport(xml, dir);
    expect(result.get("src/main/java/com/example/Foo.java")).toBe(80);
  });

  it("falls back to src/main/kotlin when the java path doesn't exist", () => {
    fs.mkdirSync(path.join(dir, "src/main/kotlin/com/example"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src/main/kotlin/com/example/Bar.kt"), "class Bar");

    const xml = `<package name="com/example"><sourcefile name="Bar.kt">
      <counter type="LINE" missed="0" covered="10"/>
    </sourcefile></package>`;

    const result = parseJacocoReport(xml, dir);
    expect(result.get("src/main/kotlin/com/example/Bar.kt")).toBe(100);
  });

  it("skips a sourcefile that resolves under no known source root", () => {
    const xml = `<package name="com/nowhere"><sourcefile name="Ghost.java">
      <counter type="LINE" missed="1" covered="1"/>
    </sourcefile></package>`;
    expect(parseJacocoReport(xml, dir).size).toBe(0);
  });

  it("skips a sourcefile with a zero-total LINE counter", () => {
    fs.mkdirSync(path.join(dir, "src/main/java/com/example"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src/main/java/com/example/Empty.java"), "");
    const xml = `<package name="com/example"><sourcefile name="Empty.java">
      <counter type="LINE" missed="0" covered="0"/>
    </sourcefile></package>`;
    expect(parseJacocoReport(xml, dir).size).toBe(0);
  });
});
