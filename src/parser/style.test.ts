import { describe, expect, test } from "vitest";
import { parseStyleFile } from "./style/index";

// ─── CSS ─────────────────────────────────────────────────────────────────────

describe("CSS", { tags: ["parseStyleFile"] }, () => {
  test("@import → static", () => {
    const { imports } = parseStyleFile("a.css", `@import "./base.css";`);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({ rawSpecifier: "./base.css", type: "static", isStyle: true });
  });

  test("only @import lines → barrel", () => {
    const content = `@import './reset.css';\n@import './theme.css';`;
    const { category } = parseStyleFile("index.css", content);
    expect(category).toBe("barrel");
  });

  test("@import + rule block → ui", () => {
    const content = `@import './reset.css';\n.btn { color: red; }`;
    const { category } = parseStyleFile("styles.css", content);
    expect(category).toBe("ui");
  });

  test("no imports → ui", () => {
    const { category } = parseStyleFile("a.css", `.foo { margin: 0; }`);
    expect(category).toBe("ui");
  });

  test("@import inside block comment → ignored", () => {
    const { imports } = parseStyleFile("a.css", `/* @import "./ignored.css"; */`);
    expect(imports).toHaveLength(0);
  });

  test("@media block → ui (brace present)", () => {
    const content = `@import './base.css';\n@media (max-width: 768px) { .btn { display: none; } }`;
    const { category } = parseStyleFile("a.css", content);
    expect(category).toBe("ui");
  });
});

// ─── SCSS / Sass ──────────────────────────────────────────────────────────────

describe("SCSS @import", { tags: ["parseStyleFile"] }, () => {
  test("@import → static (regression)", () => {
    const { imports } = parseStyleFile("a.scss", `@import "variables";`);
    expect(imports[0]).toMatchObject({ rawSpecifier: "variables", type: "static" });
  });
});

describe("SCSS @use", { tags: ["parseStyleFile"] }, () => {
  test("basic @use → static, no symbols", () => {
    const { imports } = parseStyleFile("a.scss", `@use 'sass:math';`);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({ rawSpecifier: "sass:math", type: "static" });
    expect(imports[0]?.symbols).toBeUndefined();
  });

  test("@use with alias → static, symbols has alias", () => {
    const { imports } = parseStyleFile("a.scss", `@use 'sass:math' as m;`);
    expect(imports[0]).toMatchObject({ rawSpecifier: "sass:math", type: "static", symbols: ["m"] });
  });

  test("@use as * → static, symbols ['*']", () => {
    const { imports } = parseStyleFile("a.scss", `@use 'sass:math' as *;`);
    expect(imports[0]).toMatchObject({ rawSpecifier: "sass:math", type: "static", symbols: ["*"] });
  });

  test("@use with 'with' clause", () => {
    const { imports } = parseStyleFile("a.scss", `@use 'config' with ($primary: #f00);`);
    expect(imports[0]).toMatchObject({ rawSpecifier: "config", type: "static" });
  });

  test("@use inside block comment → ignored", () => {
    const { imports } = parseStyleFile("a.scss", `/* @use 'hidden'; */`);
    expect(imports).toHaveLength(0);
  });

  test("@use after // comment → ignored", () => {
    const { imports } = parseStyleFile("a.scss", `// @use 'hidden';`);
    expect(imports).toHaveLength(0);
  });
});

describe("SCSS @forward", { tags: ["parseStyleFile"] }, () => {
  test("basic @forward → re-export", () => {
    const { imports } = parseStyleFile("a.scss", `@forward './buttons';`);
    expect(imports[0]).toMatchObject({ rawSpecifier: "./buttons", type: "re-export" });
    expect(imports[0]?.symbols).toBeUndefined();
  });

  test("@forward with prefix → re-export with symbols", () => {
    const { imports } = parseStyleFile("a.scss", `@forward './buttons' as btn-*;`);
    expect(imports[0]).toMatchObject({
      rawSpecifier: "./buttons",
      type: "re-export",
      symbols: ["btn-*"],
    });
  });
});

describe("SCSS mixed @import + @use", { tags: ["parseStyleFile"] }, () => {
  test("both @import and @use edges are collected", () => {
    const content = `@import "variables";\n@use 'sass:math';`;
    const { imports } = parseStyleFile("a.scss", content);
    expect(imports).toHaveLength(2);
    expect(imports.some((i) => i.rawSpecifier === "variables" && i.type === "static")).toBe(true);
    expect(imports.some((i) => i.rawSpecifier === "sass:math" && i.type === "static")).toBe(true);
  });
});

describe("SCSS barrel detection", { tags: ["parseStyleFile"] }, () => {
  test("only @forward lines → barrel", () => {
    const content = `@forward './variables';\n@forward './mixins';`;
    const { category } = parseStyleFile("_index.scss", content);
    expect(category).toBe("barrel");
  });

  test("only @use and @forward → barrel", () => {
    const content = `@use 'sass:math';\n@forward './tokens';`;
    const { category } = parseStyleFile("_index.scss", content);
    expect(category).toBe("barrel");
  });

  test("@forward + rule block → ui", () => {
    const content = `@forward './mixins';\n.btn { padding: 0; }`;
    const { category } = parseStyleFile("a.scss", content);
    expect(category).toBe("ui");
  });

  test("empty file → ui", () => {
    const { category } = parseStyleFile("a.scss", "");
    expect(category).toBe("ui");
  });
});

// ─── Less ─────────────────────────────────────────────────────────────────────

describe("Less", { tags: ["parseStyleFile"] }, () => {
  test("standard @import → static", () => {
    const { imports } = parseStyleFile("a.less", `@import "variables.less";`);
    expect(imports[0]).toMatchObject({ rawSpecifier: "variables.less", type: "static" });
  });

  test("@import (reference) → side-effect", () => {
    const { imports } = parseStyleFile("a.less", `@import (reference) "mixins.less";`);
    expect(imports[0]).toMatchObject({ rawSpecifier: "mixins.less", type: "side-effect" });
  });

  test("@import (inline) → side-effect", () => {
    const { imports } = parseStyleFile("a.less", `@import (inline) "vendor.css";`);
    expect(imports[0]).toMatchObject({ rawSpecifier: "vendor.css", type: "side-effect" });
  });

  test("@import (less) → static", () => {
    const { imports } = parseStyleFile("a.less", `@import (less) "other.less";`);
    expect(imports[0]).toMatchObject({ rawSpecifier: "other.less", type: "static" });
  });

  test("@import (once) → static", () => {
    const { imports } = parseStyleFile("a.less", `@import (once) "base.less";`);
    expect(imports[0]).toMatchObject({ rawSpecifier: "base.less", type: "static" });
  });

  test("only @import → barrel", () => {
    const content = `@import "reset.less";\n@import "theme.less";`;
    const { category } = parseStyleFile("index.less", content);
    expect(category).toBe("barrel");
  });

  test("@import inside // comment → ignored", () => {
    const { imports } = parseStyleFile("a.less", `// @import "hidden.less";`);
    expect(imports).toHaveLength(0);
  });
});

// ─── Stylus ───────────────────────────────────────────────────────────────────

describe("Stylus", { tags: ["parseStyleFile"] }, () => {
  test("import 'file' → static", () => {
    const { imports } = parseStyleFile("a.styl", `import 'variables'`);
    expect(imports[0]).toMatchObject({ rawSpecifier: "variables", type: "static" });
  });

  test("require('file') → static", () => {
    const { imports } = parseStyleFile("a.styl", `require('mixins')`);
    expect(imports[0]).toMatchObject({ rawSpecifier: "mixins", type: "static" });
  });

  test("@require 'file' → require", () => {
    const { imports } = parseStyleFile("a.styl", `@require 'variables'`);
    expect(imports[0]).toMatchObject({ rawSpecifier: "variables", type: "require" });
  });

  test("@require with double quotes → require", () => {
    const { imports } = parseStyleFile("a.styl", `@require "base"`);
    expect(imports[0]).toMatchObject({ rawSpecifier: "base", type: "require" });
  });

  test("only import lines → barrel", () => {
    const content = `import 'reset'\nimport 'theme'`;
    const { category } = parseStyleFile("index.styl", content);
    expect(category).toBe("barrel");
  });

  test("import + rule block → ui (fixed: improved detection distinguishes rules from imports)", () => {
    const content = `import 'reset'\n.btn\n  color red`;
    const { category } = parseStyleFile("a.styl", content);
    expect(category).toBe("ui");
  });
});

// ─── isExternal classification ────────────────────────────────────────────────

describe("isExternal classification", { tags: ["parseStyleFile"] }, () => {
  test("CSS @import ~ prefix → isExternal", () => {
    const { imports } = parseStyleFile("a.css", `@import "~bootstrap/css/bootstrap.css";`);
    expect(imports[0]).toMatchObject({
      rawSpecifier: "~bootstrap/css/bootstrap.css",
      isExternal: true,
    });
  });

  test("CSS @import relative → not external", () => {
    const { imports } = parseStyleFile("a.css", `@import "./base.css";`);
    expect(imports[0]?.isExternal).toBeUndefined();
  });

  test("SCSS @use sass: namespace → isExternal", () => {
    const { imports } = parseStyleFile("a.scss", `@use "sass:math";`);
    expect(imports[0]).toMatchObject({ rawSpecifier: "sass:math", isExternal: true });
  });

  test("SCSS @use ~ prefix → isExternal", () => {
    const { imports } = parseStyleFile("a.scss", `@use "~normalize.css/normalize";`);
    expect(imports[0]).toMatchObject({ isExternal: true });
  });

  test("SCSS @use relative → not external", () => {
    const { imports } = parseStyleFile("a.scss", `@use "./variables";`);
    expect(imports[0]?.isExternal).toBeUndefined();
  });

  test("SCSS @use bare package name → isExternal", () => {
    const { imports } = parseStyleFile("a.scss", `@use "bootstrap";`);
    expect(imports[0]).toMatchObject({ isExternal: true });
  });
});

// ─── url() asset references ───────────────────────────────────────────────────

describe("url() asset references", { tags: ["parseStyleFile"] }, () => {
  test("CSS background url() → extracted as static edge", () => {
    const { imports } = parseStyleFile("a.css", `.icon { background: url('./icon.svg'); }`);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({ rawSpecifier: "./icon.svg", type: "static", isStyle: true });
  });

  test("CSS @import url() → extracted as static edge", () => {
    const { imports } = parseStyleFile("a.css", `@import url('./theme.css');`);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({ rawSpecifier: "./theme.css", type: "static" });
  });

  test("CSS external url() → not extracted", () => {
    const { imports } = parseStyleFile(
      "a.css",
      `.bg { background: url('https://cdn.example.com/img.png'); }`,
    );
    expect(imports).toHaveLength(0);
  });

  test("CSS data URI url() → not extracted", () => {
    const { imports } = parseStyleFile(
      "a.css",
      `.icon { background: url('data:image/svg+xml,...'); }`,
    );
    expect(imports).toHaveLength(0);
  });
});
