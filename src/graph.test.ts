import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { createImportMap, MermaidExporter } from "./index";

describe("graph", () => {
  test("Graph building and Mermaid output", async () => {
    const root = path.join(process.cwd(), "test-example");
    if (!fs.existsSync(root)) fs.mkdirSync(root);

    fs.writeFileSync(path.join(root, "main.js"), "import './style.css'; import { a } from './a';");
    fs.writeFileSync(path.join(root, "a.js"), "export const a = 1;");
    fs.writeFileSync(path.join(root, "style.css"), "body { color: red; }");

    try {
      const graph = await createImportMap(root, ["main.js"]);
      const mermaid = MermaidExporter.toMermaid(graph);

      expect(mermaid).toContain("graph TD");
      expect(mermaid).toContain('"main.js" -- styles --> "style.css"');
      expect(mermaid).toContain('"main.js" --> "a.js"');

      const nodes = graph.serialize().nodes;
      expect(nodes.length).toBe(3);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("Graph traversal", async () => {
    const root = path.join(process.cwd(), "test-traverse");
    if (!fs.existsSync(root)) fs.mkdirSync(root);

    fs.writeFileSync(path.join(root, "1.js"), "import './2.js'");
    fs.writeFileSync(path.join(root, "2.js"), "import './3.js'");
    fs.writeFileSync(path.join(root, "3.js"), "");

    try {
      const graph = await createImportMap(root, ["1.js"]);
      const visited: string[] = [];
      graph.traverse("1.js", (node) => {
        visited.push(node.path);
      });

      expect(visited).toEqual(["1.js", "2.js", "3.js"]);

      const visitedLimited: string[] = [];
      graph.traverse(
        "1.js",
        (node) => {
          visitedLimited.push(node.path);
        },
        { maxDepth: 1 },
      );

      expect(visitedLimited).toEqual(["1.js", "2.js"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("Find unused files", async () => {
    const root = path.join(process.cwd(), "test-unused-unit");
    if (!fs.existsSync(root)) fs.mkdirSync(root);

    fs.writeFileSync(path.join(root, "main.js"), "import './used.js';");
    fs.writeFileSync(path.join(root, "used.js"), "export const used = true;");
    fs.writeFileSync(path.join(root, "unused.js"), "export const unused = true;");

    try {
      const graph = await createImportMap(root, ["main.js"]);
      const allFiles = ["main.js", "used.js", "unused.js"];
      const unusedFiles = graph.findUnusedFiles(allFiles);

      expect(unusedFiles.length).toBe(1);
      expect(unusedFiles[0]).toBe("unused.js");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("External dependencies (node_modules and absolute paths)", async () => {
    const root = path.join(process.cwd(), "test-external");
    if (!fs.existsSync(root)) fs.mkdirSync(root);

    fs.writeFileSync(
      path.join(root, "main.js"),
      "import 'lodash'; import '/etc/hosts'; import './local.js';",
    );
    fs.writeFileSync(path.join(root, "local.js"), "export const local = 1;");

    try {
      const graph = await createImportMap(root, ["main.js"]);
      const mainNode = graph.nodes.get("main.js");
      expect(mainNode).toBeDefined();

      const lodashImport = mainNode?.imports.find((imp) => imp.rawSpecifier === "lodash");
      expect(lodashImport).toBeDefined();
      expect(lodashImport?.isExternal).toBe(true);
      expect(lodashImport?.toPath).toBe("lodash");

      const absoluteImport = mainNode?.imports.find((imp) => imp.rawSpecifier === "/etc/hosts");
      expect(absoluteImport).toBeDefined();
      expect(absoluteImport?.isExternal).toBe(true);
      expect(absoluteImport?.toPath).toBe("/etc/hosts");

      const localImport = mainNode?.imports.find((imp) => imp.rawSpecifier === "./local.js");
      expect(localImport).toBeDefined();
      expect(localImport?.isExternal).toBe(false);
      expect(localImport?.toPath).toBe("local.js");

      // Ensure we have a node for local.js but NOT for lodash or /etc/hosts
      expect(graph.nodes.has("local.js")).toBe(true);
      expect(graph.nodes.has("lodash")).toBe(false);
      expect(graph.nodes.has("/etc/hosts")).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("Graph categorization and Cycle detection", async () => {
    const root = path.join(process.cwd(), "test-categorization");
    if (!fs.existsSync(root)) fs.mkdirSync(root);

    fs.writeFileSync(path.join(root, "main.tsx"), "import './ui.tsx'; import './logic.ts';");
    fs.writeFileSync(
      path.join(root, "ui.tsx"),
      "export const UI = () => (<div>Hello</div>); function logic() { return 1; }",
    );
    fs.writeFileSync(
      path.join(root, "logic.ts"),
      "import './main.tsx'; export const logic = () => {};",
    );
    fs.writeFileSync(
      path.join(root, "types.ts"),
      "export type T = string; interface I { x: number; }",
    );

    try {
      const graph = await createImportMap(root, ["main.tsx", "types.ts"]);
      const uiNode = graph.nodes.get("ui.tsx");
      const logicNode = graph.nodes.get("logic.ts");
      const typesNode = graph.nodes.get("types.ts");

      expect(uiNode?.category).toBe("ui");
      expect(logicNode?.category).toBe("logic");
      expect(typesNode?.category).toBe("type-only");

      const cycles = graph.findCycles();
      expect(cycles.length).toBeGreaterThan(0);
      expect(cycles[0]).toContain("main.tsx");
      expect(cycles[0]).toContain("logic.ts");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("Path Aliases (tsconfig.json)", async () => {
    const root = path.join(process.cwd(), "test-aliases");
    if (!fs.existsSync(root)) fs.mkdirSync(root);

    fs.writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          paths: {
            "@/*": ["src/*"],
          },
        },
      }),
    );
    const srcDir = path.join(root, "src");
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, "utils.ts"), "export const a = 1;");
    fs.writeFileSync(path.join(root, "main.ts"), "import { a } from '@/utils';");

    try {
      const graph = await createImportMap(root, ["main.ts"]);
      expect(graph.nodes.has("src/utils.ts")).toBe(true);
      expect(graph.nodes.has("main.ts")).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("Lock files and library tags", async () => {
    const root = path.join(process.cwd(), "test-lockfile-integration");
    if (!fs.existsSync(root)) fs.mkdirSync(root);

    const packageLock = {
      name: "test",
      version: "1.0.0",
      lockfileVersion: 3,
      packages: {
        "": { name: "test", version: "1.0.0" },
        "node_modules/lodash": { version: "4.17.21" },
        "node_modules/react": { version: "18.2.0" },
        "node_modules/@scope/pkg": { version: "2.0.0" },
      },
    };

    fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify(packageLock));
    fs.writeFileSync(
      path.join(root, "main.js"),
      "import 'lodash'; import 'react'; import '@scope/pkg/sub';",
    );

    try {
      const graph = await createImportMap(root, ["main.js"]);
      const mainNode = graph.nodes.get("main.js");
      expect(mainNode).toBeDefined();

      // Check for automatic tags
      expect(mainNode?.tags.map((t) => t.name)).toContain("lodash");
      expect(mainNode?.tags.map((t) => t.name)).toContain("react");
      expect(mainNode?.tags.map((t) => t.name)).toContain("@scope/pkg");

      // Check for versions in imports
      const lodashImport = mainNode?.imports.find((i) => i.rawSpecifier === "lodash");
      expect(lodashImport?.version).toBe("4.17.21");

      const reactImport = mainNode?.imports.find((i) => i.rawSpecifier === "react");
      expect(reactImport?.version).toBe("18.2.0");

      const scopeImport = mainNode?.imports.find((i) => i.rawSpecifier === "@scope/pkg/sub");
      expect(scopeImport?.version).toBe("2.0.0");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
