import { describe, expect, test } from "vitest";
import { parser } from "./kotlin/index";

function parse(source: string) {
  const tree = parser.parse(source);
  const errors: string[] = [];
  const names = new Set<string>();
  tree.iterate({
    enter(node) {
      names.add(node.name);
      if (node.type.isError) errors.push(source.slice(node.from, node.to) || "<zero-width>");
    },
  });
  return { errors, names };
}

function expectClean(source: string): void {
  expect(parse(source).errors).toEqual([]);
}

// `supported` cases are valid Kotlin per the language spec (audit: src/parser/lang/kotlin/PROGRESS.md
// "Spec coverage audit") that the grammar now parses. `remaining` cases are known gaps and fail
// until the grammar is extended; the suite stays red on purpose for those.
const supported: Array<[string, string]> = [
  ["value class", "@JvmInline value class V(val x: Int)"],
  ["data object", "data object O"],
  ["vararg with spread", "fun f(vararg a: Int) = g(*a)"],
  ["receiver lambda type", "val f: String.(Int) -> Unit = { }"],
  ["declaration-site `in` variance", "interface Sink<in T> { fun put(t: T) }"],
  ["annotation on a local", 'fun f() { @Suppress("X") val y = 1 }'],
  ["getter with parentheses", "class A { val x get() = 1 }"],
  ["`contract` as an ordinary call", "fun f() { contract { returns() } }"],
  ["declaration-site `out` variance", "class Box<out T>(val v: T)"],
  ["variance in type argument", "val x: Comparable<in Int>? = null"],
  ["star projection", "val x: List<*> = emptyList()"],
  ["fun interface", "fun interface Cb { fun run() }"],
  ["type arguments on constructor call", "val m = HashMap<String, Int>()"],
  ["labeled return", "fun f() { listOf(1).forEach { if (it > 0) return@forEach } }"],
  ["labeled loop and break", "fun f() { outer@ for (i in 1..3) { break@outer } }"],
  ["this@label", "class A { inner class B { fun f() = this@A } }"],
  ["typed super call", "class A : I { override fun f() { super<I>.f() } }"],
  ["destructuring declaration and for", "fun f() { val (a, b) = p\n for ((k, v) in m) {} }"],
  ["destructuring lambda parameter", "val f = { (a, b): Pair<Int, Int> -> a }"],
  ["anonymous function", "val f = fun(x: Int): Int { return x }"],
  ["local class", "fun f() { class L { } }"],
  ["when subject binding", "fun f() { when (val x = g()) { 1 -> {} else -> {} } }"],
  [
    "when guard condition",
    "fun f(x: Any) { when (x) { is String if x.isEmpty() -> {} else -> {} } }",
  ],
  ["annotation on enum entry", 'enum class E { @Deprecated("x") A, B }'],
  ["collection literal in annotation", "@Foo(values = [1, 2]) class A"],
  ["annotation on a type", "fun f(x: @Foo String) {}"],
  ["annotation on a supertype", "class A : @Foo I"],
  ["definitely non-null type", "fun <T> f(x: T & Any) {}"],
  ["unicode escape in char literal", "val c = '\\u0041'"],
  ["nested block comments", "/* a /* b */ c */ val x = 1"],
  ["shebang line", "#!/usr/bin/env kotlin\nval x = 1"],
  ["qualified callable reference", "val r = a.b::c"],
  ["expression receiver callable reference", 'val p = "s"::length'],
  ["annotation with type arguments", "@Foo<Bar> class A"],
  ["annotation on lambda parameter", "val f = { @Foo x: Int -> x }"],
  ["context receivers", "context(Foo) fun f() {}"],
  [
    "annotation type arguments before a primary constructor",
    "class A @Foo<B>(1) constructor(x: Int)",
  ],
  ["annotated parameters among several", "val f = { @A a: Int, @B(1) b: Int -> a }"],
  ["annotated declaration at the start of a lambda body", 'val f = { @Suppress("X") val y = 1 }'],
  ["`context` as an ordinary call", "fun f() { context(1) }"],
];

const remaining: Array<[string, string]> = [["script top-level statement", 'println("hi")']];

describe("kotlin grammar — spec coverage", { tags: ["kotlin", "grammar", "spec"] }, () => {
  describe("supported", () => {
    for (const [name, source] of supported) {
      test(name, () => expectClean(source));
    }
  });

  describe("not yet supported", () => {
    for (const [name, source] of remaining) {
      test(name, () => expectClean(source));
    }
  });

  describe("tree shape (no error node, but the wrong tree would be silent)", () => {
    test("explicit call type arguments are a call, not chained comparisons", () => {
      const { names } = parse("val x = listOf<Int>(1)");
      expect(names.has("TypeArguments")).toBe(true);
      expect(names.has("BinaryExpression")).toBe(false);
    });

    test("generic callable reference is a CallableReference, not comparisons", () => {
      const { names, errors } = parse("val q = List<Int>::size");
      expect(errors).toEqual([]);
      expect(names.has("CallableReference")).toBe(true);
      expect(names.has("BinaryExpression")).toBe(false);
    });

    test("real comparisons are not read as type arguments", () => {
      const { names, errors } = parse(
        "fun f() { if (a < b && c > (d)) {}\n if (i < n) foo(a > (b))\n val t = x < y }",
      );
      expect(errors).toEqual([]);
      expect(names.has("TypeArguments")).toBe(false);
      expect(names.has("BinaryExpression")).toBe(true);
    });

    test("untyped setter is a PropertyAccessor, not an infix expression", () => {
      const { names, errors } = parse("class A { var x: Int = 0\n  set(value) { field = value } }");
      expect(errors).toEqual([]);
      expect(names.has("PropertyAccessor")).toBe(true);
      expect(names.has("InfixExpression")).toBe(false);
    });

    test("private set is an accessor with its modifier attached", () => {
      const { names, errors } = parse("class A { var x = 0\n  private set\n  fun f() = 1 }");
      expect(errors).toEqual([]);
      expect(names.has("ModifiedAccessor")).toBe(true);
      expect(names.has("FunctionDeclaration")).toBe(true);
    });

    test("a parenthesized expression at the start of a lambda body is not destructuring", () => {
      const { names, errors } = parse("val j = { (1 + 2).toString() }");
      expect(errors).toEqual([]);
      expect(names.has("ParenthesizedExpression")).toBe(true);
      expect(names.has("DestructuringDeclaration")).toBe(false);
    });

    test("lambda parameter destructuring is a DestructuringDeclaration", () => {
      const { names, errors } = parse("val f = { (a, b) -> a }");
      expect(errors).toEqual([]);
      expect(names.has("DestructuringDeclaration")).toBe(true);
    });

    test("a labeled trailing lambda is a call, not an infix expression", () => {
      const { names, errors } = parse("fun f() { list.forEach loop@{ x -> if (x) return@loop } }");
      expect(errors).toEqual([]);
      expect(names.has("TrailingLambda")).toBe(true);
      expect(names.has("InfixExpression")).toBe(false);
    });

    test("member annotations after enum entries are not enum-entry annotations", () => {
      const { names, errors } = parse("enum class E { A, B;\n @JvmStatic fun f() {}\n }");
      expect(errors).toEqual([]);
      expect(names.has("EnumEntryAnnotation")).toBe(false);
      expect(names.has("FunctionDeclaration")).toBe(true);
    });

    test("annotation type arguments are TypeArguments inside the annotation, not a comparison", () => {
      const { names, errors } = parse("@Foo<Bar> class A");
      expect(errors).toEqual([]);
      expect(names.has("TypeArguments")).toBe(true);
      expect(names.has("ClassDeclaration")).toBe(true);
      expect(names.has("BinaryExpression")).toBe(false);
    });

    test("context receivers are a ContextReceivers modifier, not a call", () => {
      const { names, errors } = parse("context(Foo, Bar) fun f() {}");
      expect(errors).toEqual([]);
      expect(names.has("ContextReceivers")).toBe(true);
      expect(names.has("FunctionDeclaration")).toBe(true);
      expect(names.has("CallExpression")).toBe(false);
    });

    test("an annotated lambda parameter keeps its parameter and body", () => {
      const { names, errors } = parse("val f = { @Foo x: Int -> x }");
      expect(errors).toEqual([]);
      expect(names.has("LambdaLiteral")).toBe(true);
      expect(names.has("Definition")).toBe(true);
    });

    test("a lambda body starting with a label is not a parameter annotation", () => {
      const { errors } = parse("fun f() { run { loop@ for (i in 1..2) { break@loop } } }");
      expect(errors).toEqual([]);
    });

    test("annotated enum entry keeps its annotation", () => {
      const { names, errors } = parse('enum class E { @Deprecated("x") A, B }');
      expect(errors).toEqual([]);
      expect(names.has("EnumEntryAnnotation")).toBe(true);
    });
  });
});
