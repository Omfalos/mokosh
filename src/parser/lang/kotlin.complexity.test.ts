import { describe, expect, test } from "vitest";
import { parseKotlin } from "./kotlin";

describe("kotlin complexity", { tags: ["kotlin", "parseKotlin", "complexity"] }, () => {
  test("straight-line function → complexity 1", () => {
    const { complexity, cognitiveComplexity } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
class Client {
  fun run(): Int { return 1 }
}`,
    );
    expect(complexity).toBe(1);
    expect(cognitiveComplexity).toBe(0);
  });

  test("if/else-if/else chain — cyclomatic counts each branch, cognitive stays flat for else-if", () => {
    const { complexity, cognitiveComplexity } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
class Client {
  fun grade(x: Int): String {
    if (x > 90) {
      return "A"
    } else if (x > 80) {
      return "B"
    } else {
      return "C"
    }
  }
}`,
    );
    // base 1 + if + else-if = 3
    expect(complexity).toBe(3);
    // if: 1+0=1; else-if (flat, same depth): +1; else (flat): +1 => 3
    expect(cognitiveComplexity).toBe(3);
  });

  test("nested if inside a loop — cognitive complexity compounds nesting", () => {
    const { complexity, cognitiveComplexity } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
class Client {
  fun run(items: List<Int>) {
    for (x in items) {
      if (x > 0) {
        println(x)
      }
    }
  }
}`,
    );
    // base 1 + for + if = 3
    expect(complexity).toBe(3);
    // for: 1+0=1; if inside (depth 1): 1+1=2 => 3
    expect(cognitiveComplexity).toBe(3);
  });

  test("while and do-while loops each count as a decision point", () => {
    const { complexity } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
class Client {
  fun run() {
    var i = 0
    while (i < 10) {
      i = i + 1
    }
    do {
      i = i - 1
    } while (i > 0)
  }
}`,
    );
    expect(complexity).toBe(3);
  });

  test("when expression — each non-else entry is a decision point", () => {
    const { complexity } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
class Client {
  fun label(x: Int): String {
    return when (x) {
      1 -> "one"
      2 -> "two"
      else -> "many"
    }
  }
}`,
    );
    // base 1 + two non-else entries = 3
    expect(complexity).toBe(3);
  });

  test("try/catch/finally — each catch clause is a decision point", () => {
    const { complexity } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
class Client {
  fun run() {
    try {
      risky()
    } catch (e: Exception) {
      handle(e)
    } finally {
      cleanup()
    }
  }
  fun risky() {}
  fun handle(e: Exception) {}
  fun cleanup() {}
}`,
    );
    expect(complexity).toBe(2);
  });

  test("&& / || / ?: each add a decision point", () => {
    const { complexity } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
class Client {
  fun run(a: Boolean, b: Boolean, c: Int?): Int {
    val ok = a && b || a
    return c ?: 0
  }
}`,
    );
    // base 1 + && + || + ?: = 4
    expect(complexity).toBe(4);
  });

  test("a top-level trailing-lambda call adds no extra nesting (mirrors java.ts: only a lambda already nested inside something else counts)", () => {
    const { cognitiveComplexity } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
class Client {
  fun run(items: List<Int>) {
    items.forEach {
      println(it)
    }
  }
}`,
    );
    expect(cognitiveComplexity).toBe(0);
  });

  test("a trailing-lambda call nested inside an if adds cognitive nesting", () => {
    const { cognitiveComplexity } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
class Client {
  fun run(x: Boolean, items: List<Int>) {
    if (x) {
      items.forEach {
        println(it)
      }
    }
  }
}`,
    );
    // if: 1+0=1; forEach's lambda, now nested at depth 1: 1+1=2 => 3
    expect(cognitiveComplexity).toBe(3);
  });

  test("an if-body brace is not miscounted as a nested-lambda closure", () => {
    const { cognitiveComplexity } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
class Client {
  fun run(x: Boolean) {
    if (x) {
      println("yes")
    }
  }
}`,
    );
    // Only the if itself should add cognitive weight (1+0=1); the brace body must not also be
    // scored as a nested lambda (which would double-count it).
    expect(cognitiveComplexity).toBe(1);
  });

  test("per-function complexity is qualified as Type.method", () => {
    const { functions } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
class Client {
  fun run(x: Int): String {
    if (x > 0) return "pos"
    return "neg"
  }
}`,
    );
    expect(functions).toEqual([
      { name: "Client.run", line: 3, complexity: 2, cognitiveComplexity: 1 },
    ]);
  });

  test("high error-density file skips complexity entirely (no wrong number)", () => {
    // An unsupported construct (extension function) that mis-parses badly enough to trip the
    // shared error-ratio gate — see src/parser/lang/kotlin/PROGRESS.md.
    const { complexity, cognitiveComplexity, functions } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `fun String.shout() = this.uppercase()`,
    );
    expect(complexity).toBeUndefined();
    expect(cognitiveComplexity).toBeUndefined();
    expect(functions).toBeUndefined();
  });
});
