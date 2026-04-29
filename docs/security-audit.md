# Security Audit — mokosh

**Date**: 2026-04-25
**Scope**: 19 logic files + CLI/MCP entry points, discovered via mokosh dependency graph

---

## Summary

| # | Severity | File | Finding |
|---|----------|------|---------|
| 1 | Critical | `src/config.ts:61` | Arbitrary code execution via `require()` on user-controlled path |
| 2 | High | `src/graph/resolver.ts:48` | Path traversal — string prefix check allows escape from `rootDir` |
| 3 | High | `src/mcp.ts:167–170` | MCP `root` parameter unrestricted — full filesystem crawl/read |
| 4 | High | `src/mcp.ts:170,238,262` | Absolute `entryPoints` bypass `root` containment entirely |
| 5 | Medium | `src/cli.ts:65,131` | Cache file written to arbitrary path via `--cache` flag |
| 6 | Medium | `src/cli.ts:116` | Cache deserialized without schema validation |
| 7 | Low | `src/graph/exporter.ts:9` | Mermaid output — file paths embedded without escaping |
| 8 | Low | `src/parser/lockfile.ts:82,177` | YAML loaded without schema constraint |
| 9 | Low | `src/tags.ts → src/index.ts` | Circular dependency detected by mokosh |

---

## Findings

### 1. Critical — Arbitrary Code Execution via `require()` (`src/config.ts:61`)

**Vulnerable code:**
```ts
function readJsConfig(filePath: string): MokoshConfig {
  let exported = require(filePath) as MokoshConfig | ...;
  ...
}
// filePath = path.resolve(rootDir, "mokosh.config.js")
// rootDir comes from --root CLI arg or MCP "root" param — fully user-controlled
```

When used as an MCP server, any LLM agent or MCP client can call `analyze` with `root: "/any/dir"`. If `/any/dir/mokosh.config.js` exists with side-effects (or is symlinked), it executes under the mokosh process. The CLI `--root /malicious/dir` has the same effect.

**Remediation:** For MCP use, restrict which directories are allowed as `root` (allowlist or require a workspace config). Consider disabling JS config execution in MCP context, accepting only JSON configs, or sandboxing the `require()` call to reject factory functions and side-effecting modules.

---

### 2. High — Path Traversal via String Prefix Check (`src/graph/resolver.ts:48`)

**Vulnerable code:**
```ts
const fullPath = specifier.startsWith("/") ? specifier : path.resolve(dir, specifier);
const isExternal = !fullPath.startsWith(this.rootDir);
```

`String.startsWith` is a lexicographic prefix check, not a path containment check. If `rootDir = "/tmp/project"`, a file resolving to `/tmp/project2/evil.ts` passes the check (`"/tmp/project2/...".startsWith("/tmp/project")` → `true`) and is classified as internal, causing mokosh to read and traverse files outside the project root.

**Remediation:**
```ts
const rel = path.relative(this.rootDir, fullPath);
const isExternal = rel.startsWith("..") || path.isAbsolute(rel);
```

---

### 3. High — MCP `root` Parameter Unrestricted (`src/mcp.ts:167–171`)

**Vulnerable code:**
```ts
const { root, entryPoints } = args as { root: string; entryPoints: string[] };
const config = loadMokoshConfig(root);     // executes require() in root dir
applyConfig(config);
const resolvedEntries = entryPoints.map((ep) => path.resolve(root, ep));
const graph = await getOrBuildGraph(root, resolvedEntries);
```

No validation that `root` is a legitimate project directory. An MCP client can pass `root: "/"` and trigger a full filesystem traversal, reading every supported source file on the machine. Combined with the `find_unused` tool, an attacker also gets a complete file listing.

**Remediation:** Accept an explicit `allowedRoots` list at server startup. Validate that `root` resolves to an allowed prefix before processing any tool call.

---

### 4. High — Absolute `entryPoints` Bypass Root Containment (`src/mcp.ts:170`)

**Vulnerable code:**
```ts
entryPoints.map((ep) => path.resolve(root, ep))
// path.resolve("/safe/root", "/etc/passwd") === "/etc/passwd"
```

`path.resolve` ignores the base when the second argument is an absolute path. An MCP client passes `entryPoints: ["/etc/shadow"]` and mokosh reads it as a source file via `fs.readFileSync` in `builder.ts:74`.

**Remediation:** After resolving, assert each entry is within `root`:
```ts
const resolved = path.resolve(root, ep);
const rel = path.relative(root, resolved);
if (rel.startsWith("..") || path.isAbsolute(rel)) {
  throw new Error("Entry point escapes root");
}
```

---

### 5. Medium — Cache Written to Arbitrary Path (`src/cli.ts:65,131`)

**Vulnerable code:**
```ts
cachePath = path.resolve(rootDir, nextArg);  // nextArg is raw CLI input
fs.writeFileSync(resolvedCachePath, JSON.stringify(graph.serialize(), null, 2));
```

`--cache ../../sensitive/location/graph.json` writes a JSON file to any path the process has write access to. The content is controlled (serialized graph), so direct code injection is limited, but it can silently overwrite existing files.

**Remediation:** Validate that `cachePath` remains within `rootDir` using the same containment check as finding #2.

---

### 6. Medium — Untrusted Cache Deserialized Without Schema Validation (`src/cli.ts:116`)

**Vulnerable code:**
```ts
const raw = fs.readFileSync(resolvedCachePath, "utf-8");
graph = Graph.deserialize(JSON.parse(raw));
```

If the cache file is writable by another process or user, a crafted cache can populate the graph with arbitrary node paths and import edges. Downstream consumers (cycle detection, tag proposal, Mermaid output) process this data without further validation.

**Remediation:** Validate the deserialized structure against a schema (e.g., `zod`) before use, or store a checksum/HMAC alongside the cache file.

---

### 7. Low — Mermaid Output Injection (`src/graph/exporter.ts:9`)

**Vulnerable code:**
```ts
const nodeLabel = `"${node.path}"`;  // node.path unescaped
lines.push(`  ${nodeLabel} ${edgeStyle} ${targetLabel}`);
```

A file path containing `"` or Mermaid syntax characters (`-->`, `[`, `]`) breaks diagram structure. If the Mermaid output is rendered in a browser, specially crafted paths could inject HTML.

**Remediation:**
```ts
const safeLabel = node.path.replace(/"/g, '\\"').replace(/[[\]<>]/g, "");
```

---

### 8. Low — YAML Loaded Without Schema Constraint (`src/parser/lockfile.ts:82,177`)

**Vulnerable code:**
```ts
const lock = yaml.load(content) as Record<string, PkgData>;
```

`js-yaml` v4 disables unsafe tags by default, but explicitly constraining the schema is more defensive for lockfile parsing. The cast to `Record<string, PkgData>` provides no runtime shape validation.

**Remediation:**
```ts
yaml.load(content, { schema: yaml.JSON_SCHEMA })
```

---

### 9. Low — Circular Dependency (`src/tags.ts → src/index.ts → src/tags.ts`)

Detected by mokosh during this audit. Not a direct security issue, but circular imports can cause initialization-order bugs and complicate static analysis.

**Remediation:** Extract the shared `ImportEdge` type used by `src/tags.ts` into `src/types.ts` to break the cycle.

---

## Security Confidence Score: 7 / 10

High coverage of all logic-category files via mokosh graph traversal. The most impactful findings (1–4) are exploitable in realistic MCP deployments where an LLM agent controls tool arguments. No HTTP surface was present; the MCP stdio transport limits network-level attack vectors.