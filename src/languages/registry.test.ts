import { describe, expect, test } from "vitest";
import { DEFAULT_EXTENSIONS } from "../const";
import { getFileType } from "../parser/file-type";
import { fileTypeForExtension, getAdapter, LANGUAGE_ADAPTERS, typesInFamily } from "./registry";

describe("language registry", { tags: ["languages", "registry"] }, () => {
  test("adapters have unique types and unique extensions", () => {
    const types = LANGUAGE_ADAPTERS.map((adapter) => adapter.type);
    expect(new Set(types).size).toBe(types.length);
    const exts = LANGUAGE_ADAPTERS.flatMap((adapter) => adapter.extensions);
    expect(new Set(exts).size).toBe(exts.length);
  });

  test("every scanned default extension resolves to a known language", () => {
    for (const ext of DEFAULT_EXTENSIONS) {
      expect(fileTypeForExtension(ext), ext).not.toBe("unknown");
    }
  });

  test("getFileType resolves through the registry and is case-insensitive", () => {
    expect(getFileType("a/B.KT")).toBe("kotlin");
    expect(getFileType("build.gradle.kts")).toBe("kotlin");
    expect(getFileType("x.cpp")).toBe("unknown");
  });

  test("jvm family is java, kotlin, scala and groovy", () => {
    expect([...typesInFamily("jvm")].sort()).toEqual(["groovy", "java", "kotlin", "scala"]);
  });

  test("kotlin adapter declares call edges and a type graph", () => {
    const { capabilities } = getAdapter("kotlin");
    expect(capabilities.callEdges).toBe(true);
    expect(capabilities.typeGraph).toBe(true);
  });
});
