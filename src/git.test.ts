// @tag git-provider-test

import { execFileSync } from "node:child_process";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { DefaultGitProvider } from "./git";

// Mock the execFileSync from node:child_process
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

describe("GitProvider", { tags: ["DefaultGitProvider", "git"] }, () => {
  const provider = new DefaultGitProvider();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("DefaultGitProvider.getChangedFiles", () => {
    test("should return a deduplicated list of changed files from multiple git commands", () => {
      // Mock different outputs for different git commands
      vi.mocked(execFileSync).mockImplementation(((_file: string, args: string[]) => {
        if (args.includes("diff") && !args.includes("--cached")) {
          return "file1.ts\nfile2.ts";
        }
        if (args.includes("diff") && args.includes("--cached")) {
          return "file2.ts\nfile3.ts";
        }
        if (args.includes("ls-files")) {
          return "file4.ts";
        }
        return "";
      }) as unknown as typeof execFileSync);

      const changedFiles = provider.getChangedFiles();

      // Verify all commands were called
      expect(execFileSync).toHaveBeenCalledTimes(3);
      expect(execFileSync).toHaveBeenCalledWith("git", ["diff", "--name-only"], expect.any(Object));
      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        ["diff", "--cached", "--name-only"],
        expect.any(Object),
      );
      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        ["ls-files", "--others", "--exclude-standard"],
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
      vi.mocked(execFileSync).mockReturnValue("" as unknown as ReturnType<typeof execFileSync>);

      const changedFiles = provider.getChangedFiles();
      expect(changedFiles).toEqual([]);
    });

    test("should continue if one git command fails", () => {
      vi.mocked(execFileSync).mockImplementation(((_file: string, args: string[]) => {
        if (args.includes("diff") && !args.includes("--cached")) {
          return "file1.ts";
        }
        // Simulate failure for other commands
        throw new Error("Git command failed");
      }) as unknown as typeof execFileSync);

      const changedFiles = provider.getChangedFiles();

      // Should still return files from the successful command
      expect(changedFiles).toEqual(["file1.ts"]);
    });

    test("should return an empty array if all git commands fail", () => {
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error("Git not installed or repository not found");
      });

      const changedFiles = provider.getChangedFiles();
      expect(changedFiles).toEqual([]);
    });

    test("should filter out empty strings and whitespace", () => {
      vi.mocked(execFileSync).mockReturnValue(
        "\n  \nfile1.ts\n\nfile2.ts  \n" as unknown as ReturnType<typeof execFileSync>,
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
});
