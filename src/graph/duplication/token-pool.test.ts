import { describe, expect, test } from "vitest";
import { createTokenizingPool } from "./token-pool";

describe("createTokenizingPool", () => {
  test("false always tokenizes in-process", () => {
    expect(createTokenizingPool(false, 10_000)).toBeNull();
  });

  test("stays in-process below the file-count threshold (default 20)", () => {
    expect(createTokenizingPool(true, 19)).toBeNull();
  });

  test("honours a custom minFiles", () => {
    expect(createTokenizingPool({ minFiles: 500 }, 499)).toBeNull();
  });
});
