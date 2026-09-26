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
    // Deliberately invalid syntax (never becomes valid, unlike a not-yet-supported construct) that
    // mis-parses badly enough to trip the shared error-ratio gate — see
    // src/parser/lang/kotlin/PROGRESS.md.
    const { complexity, cognitiveComplexity, functions } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `fun run() { val = = = = = }`,
    );
    expect(complexity).toBeUndefined();
    expect(cognitiveComplexity).toBeUndefined();
    expect(functions).toBeUndefined();
  });

  // These four cases previously tripped the error-ratio gate above — not because a single
  // annotation's own span was large, but because a parenthesized argument list or an unrecognized
  // use-site target (anything but `file:`) sent @lezer's error recovery cascading through
  // everything after it until the next resync point, corrupting far more of the file than the
  // annotation itself. Dogfooding against a local square/okhttp checkout found this hit 25/339
  // real files (7.4%) — see src/parser/lang/kotlin/PROGRESS.md's "Annotation-argument and
  // use-site-target support" section.
  test("file-level annotation with arguments no longer trips the error-ratio gate", () => {
    const { complexity } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `@file:OptIn(ExperimentalApi::class)

package p

class Client {
  fun run(): Int { return 1 }
}`,
    );
    expect(complexity).toBeDefined();
  });

  test("declaration annotation with arguments no longer trips the error-ratio gate", () => {
    const { complexity } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
class Client {
  @Deprecated("use run2", ReplaceWith("run2()"))
  fun run(): Int { return 1 }
}`,
    );
    expect(complexity).toBeDefined();
  });

  test("non-file use-site target with arguments (@get:) no longer trips the error-ratio gate", () => {
    const { complexity } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
class Client(
  @get:JvmName("isReady") val ready: Boolean,
) {
  fun run(): Int { return 1 }
}`,
    );
    expect(complexity).toBeDefined();
  });

  test("bare no-argument annotation still parses (regression check)", () => {
    const { complexity } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
class Client {
  @JvmStatic
  fun run(): Int { return 1 }
}`,
    );
    expect(complexity).toBeDefined();
  });

  // `class Foo private constructor(...)` previously collapsed the entire rest of the class body
  // into a single bogus top-level `FunctionDeclaration` named "constructor" (its `Block` swallowing
  // every subsequent member as unreachable `LocalFunctionDeclaration` statement nodes) — silent,
  // not gated by ERROR_RATIO_THRESHOLD, since no error nodes were produced. File-level complexity
  // stayed correct (it walks every node type-agnostically) while the per-function breakdown lost
  // every member after the constructor. Fixed by giving `PrimaryConstructor` its own leading
  // `modifier*` (kotlin.grammar) — see src/parser/lang/kotlin/PROGRESS.md's "private constructor(...)"
  // section. Dogfooding against square/okhttp found 39 real files use this exact pattern.
  test("modifier before `constructor` doesn't swallow the rest of the class (private constructor)", () => {
    const { functions } = parseKotlin(
      "src/main/kotlin/p/Cookie.kt",
      `package p
class Cookie private constructor(
  val name: String,
) {
  fun matches(): Boolean {
    return true
  }

  override fun equals(other: Any?): Boolean = other is Cookie
}`,
    );
    expect(functions).toEqual([
      { name: "Cookie.matches", line: 5, complexity: 1, cognitiveComplexity: 0 },
      { name: "Cookie.equals", line: 9, complexity: 1, cognitiveComplexity: 0 },
    ]);
  });

  test("modifier before `constructor` doesn't swallow the rest of the class (internal constructor)", () => {
    const { functions } = parseKotlin(
      "src/main/kotlin/p/Widget.kt",
      `package p
class Widget internal constructor(
  val id: String,
) {
  fun run(): Int { return 1 }
}`,
    );
    expect(functions).toEqual([
      { name: "Widget.run", line: 5, complexity: 1, cognitiveComplexity: 0 },
    ]);
  });

  // This grammar has no ASI (no newline-sensitivity) — a bare-call statement immediately followed
  // by another statement starting with a plain identifier (very common: `foo.bar()` then
  // `someVar = ...`) gets misparsed as one InfixExpression, `someVar` swallowed as the bare
  // infix-function-call operator. Confirmed structurally unfixable at the grammar level (three
  // attempts, see PROGRESS.md's "Attempt 3" — the ambiguity is upstream of anything a `!greedy`
  // precedence marker can reach, traced into @lezer/lr's own defaultReduce optimization). Dogfooding
  // against square/okhttp's Hpack.kt (HTTP/2 header compression, dense with sequential
  // assignment/call statements) found this zeroed out 7/9 functions via collectFunctionComplexity's
  // zero-tolerance error gate, even though the file-level aggregate (type-agnostic, unaffected by
  // the malformed shape) correctly showed it as the module's most complex file. Fixed by narrowing
  // the gate to only skip when the error-containing body *also* has a decision point somewhere in
  // it (hasComplexityRelevantConstruct) — a plain assignment/call chain has none, so the malformed
  // tree shape can't have hidden or duplicated a decision point either, unlike the original
  // DiskLruCache.close case this gate exists for (still correctly gated below).
  test("plain statement-boundary misparse (no control flow) no longer zeroes out the function", () => {
    const { functions } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
class Client {
  fun clearTable() {
    dynamicTable.fill(null)
    nextHeaderIndex = dynamicTable.size - 1
  }
}`,
    );
    expect(functions).toEqual([
      { name: "Client.clearTable", line: 3, complexity: 1, cognitiveComplexity: 0 },
    ]);
  });

  test("consecutive statements next to a real decision point are no longer misparsed, so the function surfaces", () => {
    // Newline-separated statements used to collapse into one InfixExpression chain and gate this
    // function out; `Nl` statement separators (tokens.js `nlTokens`) fixed that at the grammar.
    const { functions, complexity } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
class Client {
  fun evict() {
    dynamicTable.fill(null)
    nextHeaderIndex = dynamicTable.size - 1
    if (nextHeaderIndex > 0) {
      return
    }
  }
}`,
    );
    expect(complexity).toBe(2);
    expect(functions).toEqual([
      { name: "Client.evict", line: 3, complexity: 2, cognitiveComplexity: 1 },
    ]);
  });

  test("a body with a genuine error node next to a real decision point stays gated (DiskLruCache.close protection retained)", () => {
    // Deliberately invalid syntax yields a real error node inside the body regardless of statement
    // separation, and stays invalid however much of Kotlin the grammar learns. The clean filler methods keep
    // the file-wide error ratio under the whole-file gate so only the per-function gate is tested.
    const { functions, complexity } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
class Client {
  fun clean0(x: Int): Int {
    val y = x + 0
    return y * 2
  }
  fun clean1(x: Int): Int {
    val y = x + 1
    return y * 2
  }
  fun clean2(x: Int): Int {
    val y = x + 2
    return y * 2
  }
  fun clean3(x: Int): Int {
    val y = x + 3
    return y * 2
  }
  fun clean4(x: Int): Int {
    val y = x + 4
    return y * 2
  }
  fun clean5(x: Int): Int {
    val y = x + 5
    return y * 2
  }
  fun clean6(x: Int): Int {
    val y = x + 6
    return y * 2
  }
  fun clean7(x: Int): Int {
    val y = x + 7
    return y * 2
  }
  fun clean8(x: Int): Int {
    val y = x + 8
    return y * 2
  }
  fun clean9(x: Int): Int {
    val y = x + 9
    return y * 2
  }
  fun clean10(x: Int): Int {
    val y = x + 10
    return y * 2
  }
  fun clean11(x: Int): Int {
    val y = x + 11
    return y * 2
  }
  fun evict() {
    val = 1
    if (nextHeaderIndex > 0) {
      return
    }
  }
}`,
    );
    // File-level aggregate stays correct (type-agnostic walk, unaffected by the malformed shape)...
    expect(complexity).toBe(2);
    // ...but the per-function entry must NOT be trusted, since the malformed region could in
    // principle have hidden or duplicated a decision point the way DiskLruCache.close's did. The
    // clean sibling methods are unaffected.
    expect(functions?.some((f) => f.name === "Client.evict")).toBe(false);
    expect(functions).toHaveLength(12);
  });

  test("a trailing comma in a call's argument list parses without an error node", () => {
    const { functions } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
class Client {
  fun run(a: Int, b: Int,) {
    foo(
      a,
      b,
    )
    if (a > b) {
      return
    }
  }
}`,
    );
    expect(functions).toEqual([
      { name: "Client.run", line: 3, complexity: 2, cognitiveComplexity: 1 },
    ]);
  });

  test("`?: return` / `?: throw` / `?: continue` as an elvis operand parse without an error node", () => {
    const { functions } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
class Client {
  fun run(items: List<String?>): Int? {
    val first = items.firstOrNull() ?: return null

    for (item in items) {
      val v = item ?: continue
      val w = lookup(v) ?: throw IllegalStateException("x")
    }
    return first.length
  }
}`,
    );
    expect(functions?.map((f) => f.name)).toEqual(["Client.run"]);
  });

  test("brace-less `when` branches on consecutive lines are each counted as a decision point", () => {
    const { complexity, functions } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
class Client {
  fun read(type: Int) {
    when (type) {
      1 -> readA(1)
      2 -> readB(2)
      3 -> readC(3)
      else -> other()
    }
  }
}`,
    );
    // base 1 + three non-else entries = 4 (previously the entries collapsed into one)
    expect(complexity).toBe(4);
    expect(functions).toEqual([
      { name: "Client.read", line: 3, complexity: 4, cognitiveComplexity: 1 },
    ]);
  });

  test("a comment between `when` branches does not swallow the `else ->` branch", () => {
    const { functions } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
class Client {
  fun read(type: Int) {
    when (type) {
      1 -> {
        readA(1)
      }

      // not a known type
      else -> {
        other()
      }
    }
  }
}`,
    );
    expect(functions?.map((f) => f.name)).toEqual(["Client.read"]);
  });
  test("extension functions and properties parse and are named by their own identifier", () => {
    const { functions, complexity } = parseKotlin(
      "src/main/kotlin/p/Ext.kt",
      `package p
internal fun Headers.commonName(index: Int): String {
  if (index < 0) return ""
  return names[index]
}

fun <T> List<T>.second(): T? = if (size > 1) get(1) else null

fun a.b.Foo?.describe() = "x"

val String.shout: String
  get() = uppercase()

val <T> List<T>.penultimate: T? get() = if (size > 1) get(size - 2) else null

fun plain() {}`,
    );
    expect(functions?.map((f) => f.name)).toEqual(["commonName", "second", "describe", "plain"]);
    expect(complexity).toBeDefined();
  });

  test("an extension function inside a class keeps its owner prefix", () => {
    const { functions } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
class Client {
  fun Int.plusTwo() = this + 2
  fun run(x: Int) {
    if (x > 0) {
      x.plusTwo()
    }
  }
}`,
    );
    expect(functions?.map((f) => f.name)).toEqual(["Client.plusTwo", "Client.run"]);
  });
  test("suspend, receiver, named-parameter and nullable function types all parse; every function still surfaces", () => {
    const { functions } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
class Client {
  fun a(block: suspend () -> Unit) {
    if (ready) {
      block()
    }
  }
  fun b(cb: Socket.(timeout: Int) -> Unit) {}
  fun c(cb: (() -> Unit)? = null) {}
  fun d(f: suspend FlowCollector<R>.(Array<T>) -> Unit): Int { return 1 }
  fun e(g: () -> Unit?) {}
  fun f(h: (a: Int, b: String) -> Unit, i: ((A) -> B)?) {}
}`,
    );
    expect(functions?.map((f) => f.name)).toEqual([
      "Client.a",
      "Client.b",
      "Client.c",
      "Client.d",
      "Client.e",
      "Client.f",
    ]);
    expect(functions?.find((f) => f.name === "Client.a")?.complexity).toBe(2);
  });

  test("an extension on a function type (`fun (suspend () -> T).run()`) parses and is named by its own identifier", () => {
    const { functions } = parseKotlin(
      "src/main/kotlin/p/Ext.kt",
      `package p
fun (suspend () -> Int).runIt() {}

fun <T> (suspend () -> T).other(): Int = 1

val (() -> Unit).size get() = 1

fun String.plain() {}`,
    );
    expect(functions?.map((f) => f.name)).toEqual(["runIt", "other", "plain"]);
  });

  test("a lambda parameter typed as a function type keeps the lambda's own arrow", () => {
    const { functions, complexity } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
class Client {
  fun run() {
    val f = { g: (Int) -> Int -> g(1) }
    if (ready) {
      f { it }
    }
  }
}`,
    );
    expect(complexity).toBe(2);
    // if: 1+0=1; the `f { it }` trailing lambda nested inside it: 1+1=2 => 3
    expect(functions).toEqual([
      { name: "Client.run", line: 3, complexity: 2, cognitiveComplexity: 3 },
    ]);
  });

  test("`() -> Unit?` is a function returning a nullable, and a plain scoped type is untouched", () => {
    const { functions } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
class Client {
  fun a(x: Foo.Bar, y: Map<String, List<Int>>, z: () -> Unit?) {
    if (x is Foo.Bar) {
      y.size
    }
  }
}`,
    );
    expect(functions).toEqual([
      { name: "Client.a", line: 3, complexity: 2, cognitiveComplexity: 1 },
    ]);
  });
});
