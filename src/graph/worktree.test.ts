import { execFileSync } from "node:child_process";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { resolveRef, withWorktree } from "./worktree";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

describe("resolveRef", { tags: ["worktree", "resolveRef"] }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns the trimmed sha from git rev-parse", () => {
    vi.mocked(execFileSync).mockImplementation(
      (() => "abc123\n") as unknown as typeof execFileSync,
    );
    expect(resolveRef("/repo", "main")).toBe("abc123");
    expect(execFileSync).toHaveBeenCalledWith(
      "git",
      ["rev-parse", "--verify", "main^{commit}"],
      expect.objectContaining({ cwd: "/repo" }),
    );
  });

  test("throws a descriptive error when the ref does not resolve", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("fatal: not a valid ref");
    });
    expect(() => resolveRef("/repo", "no-such-ref")).toThrow(
      'Could not resolve git ref "no-such-ref" in /repo',
    );
  });
});

describe("withWorktree", { tags: ["worktree", "withWorktree"] }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("checks out the sha, runs fn with the worktree dir, then removes it", async () => {
    vi.mocked(execFileSync).mockReturnValue(Buffer.from(""));
    const fn = vi.fn(async (dir: string) => `ran:${dir}`);

    const result = await withWorktree("/repo", "deadbeef", fn);

    expect(result).toBe(`ran:${fn.mock.calls[0]?.[0]}`);
    expect(fn).toHaveBeenCalledTimes(1);

    const calls = vi.mocked(execFileSync).mock.calls;
    const addCall = calls.find((call) => call[1]?.[1] === "add");
    const removeCall = calls.find((call) => call[1]?.[1] === "remove");
    expect(addCall).toBeDefined();
    expect(addCall?.[1]).toEqual([
      "worktree",
      "add",
      "--detach",
      fn.mock.calls[0]?.[0],
      "deadbeef",
    ]);
    expect(removeCall).toBeDefined();
    expect(removeCall?.[1]).toEqual(["worktree", "remove", "--force", fn.mock.calls[0]?.[0]]);
  });

  test("still removes the worktree when fn throws", async () => {
    vi.mocked(execFileSync).mockReturnValue(Buffer.from(""));
    const fn = vi.fn(async () => {
      throw new Error("boom");
    });

    await expect(withWorktree("/repo", "deadbeef", fn)).rejects.toThrow("boom");

    const calls = vi.mocked(execFileSync).mock.calls;
    expect(calls.some((call) => call[1]?.[1] === "remove")).toBe(true);
  });
});
