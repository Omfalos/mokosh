# Lock File Analysis 📦

Mokosh automatically detects and parses lock files in your project root to enrich the dependency graph with version information and library tags.

## Supported Lock Files

Mokosh currently supports the following lock files:

- **`package-lock.json`**: Supports v1, v2, and v3 formats used by `npm`.
- **`yarn.lock`**: Supports both Yarn v1 (classic) and Yarn v2/v3+ (Berry) formats.
- **`pnpm-lock.yaml`**: Supports pnpm-specific lock file structure.

## How It Works

1.  **Detection**: When initializing the `GraphBuilder`, Mokosh looks for a lock file in the specified root directory in the following order: `package-lock.json`, `yarn.lock`, and `pnpm-lock.yaml`.
2.  **Parsing**: The detected lock file is parsed into a flat map of dependencies and their corresponding versions.
3.  **Enrichment**:
    -   **Versions**: When an external dependency (from `node_modules`) is encountered during graph construction, Mokosh attempts to match the library name against the parsed lock file data. If a match is found, the exact version is added to the `ImportEdge`.
    -   **Library Tags**: The library name is automatically added as a tag to the `FileNode` that imports it. This allows for easier filtering of nodes that depend on specific libraries (e.g., using `--query "tag:react"`).

## Usage Example

When you run Mokosh, you can see the version information in the JSON output or use it for filtering:

```bash
# Filter all files that import a specific version of a library (via tags)
npx mokosh --query "tag:lodash" src/index.ts
```

In the JSON output, you'll find the version in the `imports` array:

```json
{
  "path": "src/index.ts",
  "imports": [
    {
      "rawSpecifier": "lodash",
      "toPath": "node_modules/lodash/index.js",
      "isExternal": true,
      "version": "4.17.21"
    }
  ],
  "tags": ["lodash"]
}
```

## Benefits for AI and RAG

-   **Context Awareness**: AI models can understand which specific versions of libraries are being used, which is crucial for identifying compatible APIs or known vulnerabilities.
-   **Easier Navigation**: Automatically tagging files with the libraries they use simplifies the process of finding relevant code segments based on their external dependencies.
