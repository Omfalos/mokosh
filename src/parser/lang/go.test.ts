import { describe, expect, test } from "vitest";
import { parseGo } from "./go";

// ─── grouped import blocks ────────────────────────────────────────────────────

describe("grouped import block", { tags: ["go", "parseGo"] }, () => {
  test("single package in group", () => {
    const { imports } = parseGo("main.go", `import (\n  "fmt"\n)`);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({ rawSpecifier: "fmt", isExternal: true, type: "static" });
  });

  test("multiple packages in group", () => {
    const { imports } = parseGo("main.go", `import (\n  "fmt"\n  "os"\n  "net/http"\n)`);
    expect(imports).toHaveLength(3);
    expect(imports.map((i) => i.rawSpecifier)).toEqual(["fmt", "os", "net/http"]);
  });

  test("aliased package in group", () => {
    const { imports } = parseGo("main.go", `import (\n  log "github.com/sirupsen/logrus"\n)`);
    expect(imports[0]).toMatchObject({ rawSpecifier: "github.com/sirupsen/logrus" });
  });

  test("blank identifier (side-effect) import in group", () => {
    const { imports } = parseGo("main.go", `import (\n  _ "net/http/pprof"\n)`);
    expect(imports[0]).toMatchObject({ rawSpecifier: "net/http/pprof" });
  });

  test("mixed group: stdlib, aliased, and side-effect", () => {
    const src = `import (\n  "fmt"\n  log "github.com/sirupsen/logrus"\n  _ "net/http/pprof"\n)`;
    const { imports } = parseGo("main.go", src);
    expect(imports).toHaveLength(3);
    expect(imports.map((i) => i.rawSpecifier)).toEqual([
      "fmt",
      "github.com/sirupsen/logrus",
      "net/http/pprof",
    ]);
  });
});

// ─── single-line imports ──────────────────────────────────────────────────────

describe("single-line import", { tags: ["go", "parseGo"] }, () => {
  test("bare import", () => {
    const { imports } = parseGo("main.go", `import "fmt"`);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({ rawSpecifier: "fmt", isExternal: true, type: "static" });
  });

  test("aliased single import", () => {
    const { imports } = parseGo("main.go", `import log "github.com/sirupsen/logrus"`);
    expect(imports[0]).toMatchObject({ rawSpecifier: "github.com/sirupsen/logrus" });
  });

  test("side-effect single import", () => {
    const { imports } = parseGo("main.go", `import _ "embed"`);
    expect(imports[0]).toMatchObject({ rawSpecifier: "embed" });
  });

  test("multiple single-line imports", () => {
    const src = `import "fmt"\nimport "os"`;
    const { imports } = parseGo("main.go", src);
    expect(imports).toHaveLength(2);
    expect(imports.map((i) => i.rawSpecifier)).toEqual(["fmt", "os"]);
  });
});

// ─── mixed single + grouped ───────────────────────────────────────────────────

describe("mixed single and grouped imports", { tags: ["go", "parseGo"] }, () => {
  test("single-line and group together are not double-counted", () => {
    const src = `import "path/filepath"\n\nimport (\n  "fmt"\n  "os"\n)`;
    const { imports } = parseGo("main.go", src);
    expect(imports).toHaveLength(3);
    expect(imports.map((i) => i.rawSpecifier)).toEqual(["path/filepath", "fmt", "os"]);
  });
});

// ─── edge metadata ────────────────────────────────────────────────────────────

describe("edge metadata", { tags: ["go", "parseGo"] }, () => {
  test("fromPath matches provided filePath", () => {
    const { imports } = parseGo("/app/main.go", `import "fmt"`);
    expect(imports[0]?.fromPath).toBe("/app/main.go");
  });

  test("toPath is always empty string (resolved later by graph builder)", () => {
    const { imports } = parseGo("main.go", `import "fmt"`);
    expect(imports[0]?.toPath).toBe("");
  });

  test("isStyle is always false for Go imports", () => {
    const src = `import (\n  "fmt"\n  "net/http"\n)`;
    const { imports } = parseGo("main.go", src);
    expect(imports.every((i) => i.isStyle === false)).toBe(true);
  });

  test("all imports are marked external", () => {
    const src = `import (\n  "fmt"\n  "github.com/myorg/myrepo/internal/utils"\n)`;
    const { imports } = parseGo("main.go", src);
    expect(imports.every((i) => i.isExternal === true)).toBe(true);
  });
});

// ─── exported symbols ─────────────────────────────────────────────────────────

describe("exported symbols", { tags: ["go", "parseGo"] }, () => {
  test("exported func → exported symbol", () => {
    const { exports } = parseGo("main.go", `func HandleRequest() {}`);
    expect(exports).toContainEqual({ name: "HandleRequest" });
  });

  test("unexported func → not exported", () => {
    const { exports } = parseGo("main.go", `func handleRequest() {}`);
    expect(exports.map((e) => e.name)).not.toContain("handleRequest");
  });

  test("exported type → exported symbol", () => {
    const { exports } = parseGo("main.go", `type Config struct{}`);
    expect(exports).toContainEqual({ name: "Config" });
  });

  test("exported var → exported symbol", () => {
    const { exports } = parseGo("main.go", `var Version = "1.0"`);
    expect(exports).toContainEqual({ name: "Version" });
  });

  test("exported const → exported symbol", () => {
    const { exports } = parseGo("main.go", `const Debug = false`);
    expect(exports).toContainEqual({ name: "Debug" });
  });

  test("multiple exported declarations", () => {
    const src = `func Foo() {}\ntype Bar struct{}\nvar Baz = 1\nconst Qux = "x"`;
    const { exports } = parseGo("main.go", src);
    expect(exports.map((e) => e.name)).toEqual(["Foo", "Bar", "Baz", "Qux"]);
  });

  test("no duplicate exports for same name", () => {
    const src = `func Handler() {}\nfunc Handler() {}`;
    const { exports } = parseGo("main.go", src);
    expect(exports.filter((e) => e.name === "Handler")).toHaveLength(1);
  });
});

// ─── @tag markers ─────────────────────────────────────────────────────────────

describe("@tag markers", { tags: ["go", "parseGo"] }, () => {
  test("// @tag name → collected as comment-marker", () => {
    const { tags } = parseGo("main.go", `// @tag auth`);
    expect(tags).toContainEqual({ name: "auth", kind: "comment-marker" });
  });

  test("multiple @tag markers collected", () => {
    const src = `// @tag auth\n// @tag core\nimport "fmt"`;
    const { tags } = parseGo("main.go", src);
    const names = tags.map((t) => t.name);
    expect(names).toContain("auth");
    expect(names).toContain("core");
  });

  test("// @tag test → forces test category", () => {
    const { category } = parseGo("handler.go", `// @tag test\nfunc Foo() {}`);
    expect(category).toBe("test");
  });
});

// ─── category detection ───────────────────────────────────────────────────────

describe("category", { tags: ["go", "parseGo"] }, () => {
  test("_test.go suffix → test", () => {
    const { category } = parseGo("auth_test.go", `import "testing"`);
    expect(category).toBe("test");
  });

  test('import "testing" on regular file → test', () => {
    const { category } = parseGo("testmain.go", `import "testing"`);
    expect(category).toBe("test");
  });

  test('import "testing" in group → test', () => {
    const src = `import (\n  "fmt"\n  "testing"\n)`;
    const { category } = parseGo("helpers.go", src);
    expect(category).toBe("test");
  });

  test("regular .go file with no testing import → logic", () => {
    const { category } = parseGo("auth.go", `import "fmt"`);
    expect(category).toBe("logic");
  });

  test("empty file → logic", () => {
    const { category } = parseGo("main.go", "");
    expect(category).toBe("logic");
  });
});

// ─── build tags ───────────────────────────────────────────────────────────────

describe("build tags (//go:build)", { tags: ["go", "parseGo"] }, () => {
  test("single tag extracted", () => {
    const { tags } = parseGo("main.go", `//go:build integration`);
    expect(tags).toContainEqual({ name: "integration", kind: "comment-marker" });
  });

  test("AND expression → both tags extracted", () => {
    const { tags } = parseGo("main.go", `//go:build linux && amd64`);
    const names = tags.map((t) => t.name);
    expect(names).toContain("linux");
    expect(names).toContain("amd64");
  });

  test("negated tag → name without ! extracted", () => {
    const { tags } = parseGo("main.go", `//go:build !windows`);
    expect(tags).toContainEqual({ name: "windows", kind: "comment-marker" });
  });

  test("OR expression → both tags extracted", () => {
    const { tags } = parseGo("main.go", `//go:build linux || darwin`);
    const names = tags.map((t) => t.name);
    expect(names).toContain("linux");
    expect(names).toContain("darwin");
  });

  test("complex expression", () => {
    const { tags } = parseGo("main.go", `//go:build (linux || darwin) && !cgo`);
    const names = tags.map((t) => t.name);
    expect(names).toContain("linux");
    expect(names).toContain("darwin");
    expect(names).toContain("cgo");
  });

  test("ignore pseudo-tag is discarded", () => {
    const { tags } = parseGo("main.go", `//go:build ignore`);
    expect(tags.map((t) => t.name)).not.toContain("ignore");
  });

  test("build tag coexists with @tag marker", () => {
    const src = `// @tag auth\n//go:build integration`;
    const { tags } = parseGo("main.go", src);
    const names = tags.map((t) => t.name);
    expect(names).toContain("auth");
    expect(names).toContain("integration");
  });
});

describe("build tags (// +build legacy)", { tags: ["go", "parseGo"] }, () => {
  test("single legacy tag extracted", () => {
    const { tags } = parseGo("main.go", `// +build integration`);
    expect(tags).toContainEqual({ name: "integration", kind: "comment-marker" });
  });

  test("space-separated tags on one line → both extracted", () => {
    const { tags } = parseGo("main.go", `// +build linux amd64`);
    const names = tags.map((t) => t.name);
    expect(names).toContain("linux");
    expect(names).toContain("amd64");
  });

  test("comma-separated (AND) tags → both extracted", () => {
    const { tags } = parseGo("main.go", `// +build linux,amd64`);
    const names = tags.map((t) => t.name);
    expect(names).toContain("linux");
    expect(names).toContain("amd64");
  });

  test("negated legacy tag → name without ! extracted", () => {
    const { tags } = parseGo("main.go", `// +build !windows`);
    expect(tags).toContainEqual({ name: "windows", kind: "comment-marker" });
  });

  test("ignore pseudo-tag is discarded", () => {
    const { tags } = parseGo("main.go", `// +build ignore`);
    expect(tags.map((t) => t.name)).not.toContain("ignore");
  });
});
