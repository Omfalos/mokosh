import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { parsePackageLock, parsePnpmLock, parseYarnLock } from "./lockfile";

describe("LockFileParser", () => {
  const tmpDir = path.resolve("./tmp-lock-test");

  beforeAll(() => {
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
  });

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("should parse package-lock.json v3", () => {
    const lockPath = path.join(tmpDir, "package-lock.json");
    const lockContent = {
      name: "test",
      version: "1.0.0",
      lockfileVersion: 3,
      packages: {
        "": { name: "test", version: "1.0.0" },
        "node_modules/lodash": { version: "4.17.21" },
        "node_modules/@types/node": { version: "18.0.0" },
      },
    };
    fs.writeFileSync(lockPath, JSON.stringify(lockContent));

    const result = parsePackageLock(lockPath);
    expect(result.dependencies.lodash).toBeDefined();
    expect(result.dependencies.lodash!.version).toBe("4.17.21");
    expect(result.dependencies["@types/node"]).toBeDefined();
    expect(result.dependencies["@types/node"]!.version).toBe("18.0.0");
  });

  test("should parse yarn.lock v1 (classic)", () => {
    const lockPath = path.join(tmpDir, "yarn.lock");
    const lockContent = `
# yarn lockfile v1
lodash@^4.17.21:
  version "4.17.21"
  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz#679591c564c3bbf9ae41c6210b3545232251b229"
  integrity sha512-v2kDEe57olcSlerGi82vM9uVgw6umru5zi66v36EnY7301fpG0h89hf32L6zB+ALA8PuxnmaYwR9TZfLKsaWEA==

"@types/node@^18.0.0":
  version "18.0.0"
`;
    fs.writeFileSync(lockPath, lockContent);

    const result = parseYarnLock(lockPath);
    expect(result.dependencies.lodash).toBeDefined();
    expect(result.dependencies.lodash!.version).toBe("4.17.21");
    expect(result.dependencies["@types/node"]).toBeDefined();
    expect(result.dependencies["@types/node"]!.version).toBe("18.0.0");
  });

  test("should parse yarn.lock v2 (berry)", () => {
    const lockPath = path.join(tmpDir, "yarn-berry.lock");
    const lockContent = `
__metadata:
  version: 6
  cacheKey: 8

"lodash@npm:^4.17.21":
  version: 4.17.21
  resolution: "lodash@npm:4.17.21"

"@types/node@npm:^18.0.0":
  version: 18.0.0
  resolution: "@types/node@npm:18.0.0"
`;
    fs.writeFileSync(lockPath, lockContent);

    const result = parseYarnLock(lockPath);
    expect(result.dependencies.lodash).toBeDefined();
    expect(result.dependencies.lodash!.version).toBe("4.17.21");
    expect(result.dependencies["@types/node"]).toBeDefined();
    expect(result.dependencies["@types/node"]!.version).toBe("18.0.0");
  });

  test("should parse pnpm-lock.yaml", () => {
    const lockPath = path.join(tmpDir, "pnpm-lock.yaml");
    const lockContent = `
lockfileVersion: '6.0'

dependencies:
  lodash:
    specifier: ^4.17.21
    version: 4.17.21

packages:
  /lodash@4.17.21:
    resolution: {integrity: sha512-...}
    engines: {node: '>=4.0.0'}
    dev: false
`;
    fs.writeFileSync(lockPath, lockContent);

    const result = parsePnpmLock(lockPath);
    expect(result.dependencies.lodash).toBeDefined();
    expect(result.dependencies.lodash!.version).toBe("4.17.21");
  });
});
