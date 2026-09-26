import { describe, expect, test } from "vitest";
import { Graph } from "../../graph/model";
import { inferRole } from "../../graph/responsibility/infer-role";
import { buildTypeGraph } from "../../graph/type-graph";
import { parseJava } from "../../parser/lang/java";
import { parseKotlin } from "../../parser/lang/kotlin";
import type { FileNode } from "../../types/node";
import { exportKindFor } from "../dispatch";
import { extractLeadingDoc } from "./jvm-doc";

const node = (path: string, over: Partial<FileNode> = {}): FileNode => ({
  path,
  type: "kotlin",
  category: "logic",
  imports: [],
  exports: [],
  tags: [],
  mtime: 0,
  size: 0,
  ...over,
});

describe("JVM language hooks", { tags: ["languages", "jvm", "kotlin"] }, () => {
  test("exportKindFor maps Kotlin declaration keywords", () => {
    expect(exportKindFor("kotlin", "object Foo")).toBe("class");
    expect(exportKindFor("kotlin", "typealias A")).toBe("type");
    expect(exportKindFor("kotlin", "fun run")).toBe("function");
    expect(exportKindFor("kotlin", "val x")).toBe("const");
    expect(exportKindFor("java", "interface Api")).toBe("interface");
    expect(exportKindFor("typescript", "fun run")).toBe("unknown");
  });

  test("role hint: name suffix and interface contract", () => {
    expect(inferRole(node("okhttp3/OkHttpClient.kt"))).toBe("api");
    expect(inferRole(node("a/UserRepository.kt"))).toBe("store");
    expect(
      inferRole(
        node("okhttp3/Call.kt", { exports: [{ name: "Call", signature: "interface Call" }] }),
      ),
    ).toBe("api");
    expect(inferRole(node("okhttp3/Thing.kt"))).toBe("other");
  });

  test("path-based rules still win over the hint", () => {
    expect(inferRole(node("src/services/FooClient.kt"))).toBe("service");
  });

  test("type graph now covers Kotlin and Java exports", () => {
    const kt = parseKotlin("A.kt", "package p\nclass A\nfun f() {}\n");
    const java = parseJava("B.java", "package p;\npublic interface B {}\n");
    const graph = new Graph(
      new Map([
        ["A.kt", node("A.kt", { exports: kt.exports })],
        ["B.java", node("B.java", { type: "java", exports: java.exports })],
      ]),
    );
    const kinds = [...buildTypeGraph(graph).types.values()].map((t) => `${t.name}:${t.kind}`);
    expect(kinds.sort()).toEqual(["A:class", "B:interface"]);
  });

  test("leading KDoc/Javadoc becomes the description; license headers are ignored", () => {
    const src = `/* Copyright 2024 */
package p

/**
 * Parses URLs. See {@link Foo}.
 *
 * @param x ignored
 */
class HttpUrl`;
    expect(extractLeadingDoc(src)).toBe("Parses URLs. See Foo.");
    expect(parseKotlin("H.kt", src).description).toBe("Parses URLs. See Foo.");
    expect(extractLeadingDoc("package p\nclass A")).toBeUndefined();
    expect(parseJava("H.java", "/** Hi there. */\npublic class H {}").description).toBe(
      "Hi there.",
    );
  });
});
