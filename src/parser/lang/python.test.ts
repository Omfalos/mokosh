import { describe, expect, test } from "vitest";
import { parsePython } from "./python";

// ─── import statements ────────────────────────────────────────────────────────

describe("import statement", () => {
  test("bare import → static edge with symbol *", () => {
    const { imports } = parsePython("a.py", "import os");
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({ rawSpecifier: "os", type: "static", symbols: ["*"] });
  });

  test("aliased import → specifier is original module name", () => {
    const { imports } = parsePython("a.py", "import numpy as np");
    expect(imports[0]).toMatchObject({ rawSpecifier: "numpy", type: "static", symbols: ["*"] });
  });

  test("comma-separated imports → one edge per module", () => {
    const { imports } = parsePython("a.py", "import os, sys, json");
    expect(imports).toHaveLength(3);
    expect(imports.map((i) => i.rawSpecifier)).toEqual(["os", "sys", "json"]);
  });

  test("dotted module path kept intact", () => {
    const { imports } = parsePython("a.py", "import os.path");
    expect(imports[0]).toMatchObject({ rawSpecifier: "os.path" });
  });
});

// ─── from … import statements ─────────────────────────────────────────────────

describe("from … import", () => {
  test("single symbol", () => {
    const { imports } = parsePython("a.py", "from pathlib import Path");
    expect(imports[0]).toMatchObject({ rawSpecifier: "pathlib", symbols: ["Path"] });
  });

  test("multiple symbols", () => {
    const { imports } = parsePython("a.py", "from os.path import join, exists, dirname");
    expect(imports[0]).toMatchObject({
      rawSpecifier: "os.path",
      symbols: ["join", "exists", "dirname"],
    });
  });

  test("aliased symbol → original name recorded", () => {
    const { imports } = parsePython("a.py", "from typing import Optional as Opt");
    expect(imports[0]).toMatchObject({ rawSpecifier: "typing", symbols: ["Optional"] });
  });

  test("star import → symbol *", () => {
    const { imports } = parsePython("a.py", "from typing import *");
    expect(imports[0]).toMatchObject({ rawSpecifier: "typing", symbols: ["*"] });
  });

  test("parenthesised multi-symbol import", () => {
    const src = "from collections import (\n  OrderedDict,\n  defaultdict,\n  namedtuple,\n)";
    const { imports } = parsePython("a.py", src);
    expect(imports[0]).toMatchObject({
      rawSpecifier: "collections",
      symbols: expect.arrayContaining(["OrderedDict", "defaultdict", "namedtuple"]),
    });
    expect(imports[0]?.symbols).toHaveLength(3);
  });

  test("line continuation (backslash) form", () => {
    const src = "from os.path import \\\n  join, \\\n  exists";
    const { imports } = parsePython("a.py", src);
    expect(imports[0]).toMatchObject({ rawSpecifier: "os.path" });
    expect(imports[0]?.symbols).toEqual(expect.arrayContaining(["join", "exists"]));
  });
});

// ─── relative imports ─────────────────────────────────────────────────────────

describe("relative imports", () => {
  test("from . import name → one edge per name, specifier is ./name", () => {
    const { imports } = parsePython("a.py", "from . import utils");
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({ rawSpecifier: "./utils", symbols: ["utils"] });
  });

  test("from . import multiple names → one edge per module", () => {
    const { imports } = parsePython("a.py", "from . import utils, models");
    expect(imports).toHaveLength(2);
    expect(imports[0]).toMatchObject({ rawSpecifier: "./utils" });
    expect(imports[1]).toMatchObject({ rawSpecifier: "./models" });
  });

  test("from .sibling import name → specifier is ./sibling", () => {
    const { imports } = parsePython("a.py", "from .models import User");
    expect(imports[0]).toMatchObject({ rawSpecifier: "./models", symbols: ["User"] });
  });

  test("from ..parent import name → specifier is ../name", () => {
    const { imports } = parsePython("a.py", "from ..utils import helper");
    expect(imports[0]).toMatchObject({ rawSpecifier: "../utils", symbols: ["helper"] });
  });
});

// ─── comment handling ─────────────────────────────────────────────────────────

describe("comment handling", () => {
  test("import on a # comment line → ignored", () => {
    const { imports } = parsePython("a.py", "# import os");
    expect(imports).toHaveLength(0);
  });

  test("import after inline comment marker → not confused", () => {
    const src = "import os  # import sys — this should not add a second edge";
    const { imports } = parsePython("a.py", src);
    expect(imports).toHaveLength(1);
    expect(imports[0]?.rawSpecifier).toBe("os");
  });
});

// ─── @tag markers ─────────────────────────────────────────────────────────────

describe("@tag markers", () => {
  test("# @tag name → collected as comment-marker", () => {
    const { tags } = parsePython("a.py", "# @tag auth");
    expect(tags).toContainEqual({ name: "auth", kind: "comment-marker" });
  });

  test("multiple tags collected", () => {
    const src = "# @tag auth\n# @tag core\nimport os";
    const { tags } = parsePython("a.py", src);
    const names = tags.map((t) => t.name);
    expect(names).toContain("auth");
    expect(names).toContain("core");
  });

  test("# @tag test → forces test category", () => {
    const { category } = parsePython("helpers.py", "# @tag test\ndef helper(): pass");
    expect(category).toBe("test");
  });
});

// ─── exports (top-level defs) ─────────────────────────────────────────────────

describe("exports", () => {
  test("top-level def → exported symbol", () => {
    const { exports } = parsePython("a.py", "def calculate(x, y):\n    return x + y");
    expect(exports).toContainEqual({ name: "calculate" });
  });

  test("top-level class → exported symbol", () => {
    const { exports } = parsePython("a.py", "class AuthService:\n    pass");
    expect(exports).toContainEqual({ name: "AuthService" });
  });

  test("indented def (method) → not exported", () => {
    const src = "class Foo:\n    def bar(self):\n        pass";
    const { exports } = parsePython("a.py", src);
    expect(exports.map((e) => e.name)).not.toContain("bar");
  });

  test("multiple top-level defs and classes all exported", () => {
    const src = "def foo(): pass\ndef bar(): pass\nclass Baz: pass";
    const { exports } = parsePython("a.py", src);
    expect(exports.map((e) => e.name)).toEqual(["foo", "bar", "Baz"]);
  });
});

// ─── category detection ───────────────────────────────────────────────────────

describe("category: test", () => {
  test("test_ prefix → test", () => {
    const { category } = parsePython("test_auth.py", "import os");
    expect(category).toBe("test");
  });

  test("_test.py suffix → test", () => {
    const { category } = parsePython("auth_test.py", "import os");
    expect(category).toBe("test");
  });

  test("imports pytest → test", () => {
    const { category } = parsePython("helpers.py", "import pytest\ndef fixture(): pass");
    expect(category).toBe("test");
  });

  test("from pytest import … → test", () => {
    const { category } = parsePython("helpers.py", "from pytest import fixture");
    expect(category).toBe("test");
  });

  test("imports unittest → test", () => {
    const { category } = parsePython("suite.py", "import unittest");
    expect(category).toBe("test");
  });

  test("test category adds 'test' tag automatically", () => {
    const { tags } = parsePython("test_foo.py", "import os");
    expect(tags.map((t) => t.name)).toContain("test");
  });
});

describe("category: config", () => {
  test("conftest.py → config", () => {
    const { category } = parsePython("conftest.py", "import pytest");
    expect(category).toBe("config");
  });

  test("setup.py → config", () => {
    const { category } = parsePython("setup.py", "from setuptools import setup");
    expect(category).toBe("config");
  });
});

describe("category: logic", () => {
  test("regular module → logic", () => {
    const { category } = parsePython("auth.py", "import os\ndef authenticate(): pass");
    expect(category).toBe("logic");
  });

  test("empty file → logic", () => {
    const { category } = parsePython("a.py", "");
    expect(category).toBe("logic");
  });
});

// ─── edge metadata ────────────────────────────────────────────────────────────

describe("edge metadata", () => {
  test("isStyle is always false for Python imports", () => {
    const { imports } = parsePython("a.py", "import os\nfrom pathlib import Path");
    expect(imports.every((i) => i.isStyle === false)).toBe(true);
  });

  test("toPath is always empty string (resolved later by graph builder)", () => {
    const { imports } = parsePython("a.py", "import os");
    expect(imports[0]?.toPath).toBe("");
  });

  test("fromPath matches the provided filePath", () => {
    const { imports } = parsePython("/app/src/auth.py", "import os");
    expect(imports[0]?.fromPath).toBe("/app/src/auth.py");
  });
});
