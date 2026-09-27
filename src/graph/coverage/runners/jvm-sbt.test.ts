import { describe, expect, it } from "vitest";
import { parseScoverageReport } from "./jvm-sbt";

function statement(opts: {
  source: string;
  line: number;
  count: number;
  ignored?: boolean;
}): string {
  return `<statement>
    <source>${opts.source}</source>
    <line>${opts.line}</line>
    <count>${opts.count}</count>
    <ignored>${opts.ignored ?? false}</ignored>
  </statement>`;
}

describe("parseScoverageReport", () => {
  it("computes per-file line coverage from statement counts, deduping by line", () => {
    const xml = `<statements>
      ${statement({ source: "src/main/scala/Foo.scala", line: 1, count: 1 })}
      ${statement({ source: "src/main/scala/Foo.scala", line: 1, count: 0 })}
      ${statement({ source: "src/main/scala/Foo.scala", line: 2, count: 0 })}
    </statements>`;

    const result = parseScoverageReport(xml, "/proj");
    // line 1 covered by the first statement even though a second statement on the same line
    // has count 0; line 2 uncovered — 1/2 lines covered.
    expect(result.get("src/main/scala/Foo.scala")).toBe(50);
  });

  it("ignores statements marked <ignored>true</ignored>", () => {
    const xml = `<statements>
      ${statement({ source: "src/main/scala/Foo.scala", line: 1, count: 0, ignored: true })}
      ${statement({ source: "src/main/scala/Foo.scala", line: 2, count: 1 })}
    </statements>`;
    const result = parseScoverageReport(xml, "/proj");
    expect(result.get("src/main/scala/Foo.scala")).toBe(100);
  });

  it("relativizes an absolute source path against projectDir", () => {
    const xml = `<statements>${statement({
      source: "/proj/src/main/scala/Foo.scala",
      line: 1,
      count: 1,
    })}</statements>`;
    const result = parseScoverageReport(xml, "/proj");
    expect(result.has("src/main/scala/Foo.scala")).toBe(true);
  });

  it("returns an empty map for no statements", () => {
    expect(parseScoverageReport("<statements></statements>", "/proj").size).toBe(0);
  });
});
