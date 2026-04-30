// @tag git-provider-test

import { execSync } from "node:child_process";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { DefaultGitProvider, getGitDiffFiles } from "./git";

// Mock the execSync from node:child_process
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

describe("GitProvider", () => {
  const provider = new DefaultGitProvider();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("DefaultGitProvider.getChangedFiles", () => {
    test("should return a deduplicated list of changed files from multiple git commands", () => {
      // Mock different outputs for different git commands
      vi.mocked(execSync).mockImplementation(((command: string) => {
        if (typeof command !== "string") return "";
        if (command.includes("diff --name-only") && !command.includes("--cached")) {
          return "file1.ts\nfile2.ts";
        }
        if (command.includes("diff --cached --name-only")) {
          return "file2.ts\nfile3.ts";
        }
        if (command.includes("ls-files --others")) {
          return "file4.ts";
        }
        return "";
      }) as unknown as typeof execSync);

      const changedFiles = provider.getChangedFiles();

      // Verify all commands were called
      expect(execSync).toHaveBeenCalledTimes(3);
      expect(execSync).toHaveBeenCalledWith("git diff --name-only", expect.any(Object));
      expect(execSync).toHaveBeenCalledWith("git diff --cached --name-only", expect.any(Object));
      expect(execSync).toHaveBeenCalledWith(
        "git ls-files --others --exclude-standard",
        expect.any(Object),
      );

      // Verify deduplication and contents
      // Expected: ["file1.ts", "file2.ts", "file3.ts", "file4.ts"]
      expect(changedFiles).toHaveLength(4);
      expect(changedFiles).toContain("file1.ts");
      expect(changedFiles).toContain("file2.ts");
      expect(changedFiles).toContain("file3.ts");
      expect(changedFiles).toContain("file4.ts");
    });

    test("should handle empty output from git commands", () => {
      vi.mocked(execSync).mockReturnValue("" as unknown as ReturnType<typeof execSync>);

      const changedFiles = provider.getChangedFiles();
      expect(changedFiles).toEqual([]);
    });

    test("should continue if one git command fails", () => {
      vi.mocked(execSync).mockImplementation(((command: string) => {
        if (
          typeof command === "string" &&
          command.includes("diff --name-only") &&
          !command.includes("--cached")
        ) {
          return "file1.ts";
        }
        // Simulate failure for other commands
        throw new Error("Git command failed");
      }) as unknown as typeof execSync);

      const changedFiles = provider.getChangedFiles();

      // Should still return files from the successful command
      expect(changedFiles).toEqual(["file1.ts"]);
    });

    test("should return an empty array if all git commands fail", () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("Git not installed or repository not found");
      });

      const changedFiles = provider.getChangedFiles();
      expect(changedFiles).toEqual([]);
    });

    test("should filter out empty strings and whitespace", () => {
      vi.mocked(execSync).mockReturnValue(
        "\n  \nfile1.ts\n\nfile2.ts  \n" as unknown as ReturnType<typeof execSync>,
      );

      const changedFiles = provider.getChangedFiles();
      expect(changedFiles).toEqual(["file1.ts", "file2.ts"]);
    });

    test("should handle unexpected errors in the outer catch block", () => {
      // Mock console.error to avoid noise in test output
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // We need to trigger an error outside the inner try-catch
      // One way is to mock flatMap on the array prototype or something similar,
      // but that's very intrusive.
      // Another way: triggering an error in Array.from(new Set(allFiles))

      // Let's mock execSync to return something that will make the .map().filter() chain fail
      // but only if it somehow bypasses the inner try-catch.
      // Actually, if we mock execSync to return null, output.split("\n") will throw.
      // That happens inside the inner try-catch, which will return [].

      // To hit the outer catch, we need an error in the logic outside the inner try.
      // Line 32: return Array.from(new Set(allFiles));

      // If we mock Set to throw:
      const originalSet = global.Set;
      (global as unknown as Record<string, unknown>).Set = vi.fn().mockImplementation(() => {
        throw new Error("Unexpected error in outer catch");
      });

      try {
        const changedFiles = provider.getChangedFiles();
        expect(changedFiles).toEqual([]);
        expect(errorSpy).toHaveBeenCalled();
      } finally {
        global.Set = originalSet;
        errorSpy.mockRestore();
      }
    });
  });

  describe("getGitDiffFiles (deprecated utility)", () => {
    test("should delegate to DefaultGitProvider", () => {
      vi.mocked(execSync).mockReturnValue(
        "file_from_util.ts" as unknown as ReturnType<typeof execSync>,
      );

      const files = getGitDiffFiles();
      expect(files).toEqual(["file_from_util.ts"]);
    });
  });
});
