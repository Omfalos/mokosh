// External tokenizer for Kotlin string templates (`"..."` / `"""..."""` with `$name` and
// `${expr}` interpolation). Mirrors @lezer/python's FormatString approach: the tokenizer only
// emits the literal-text spans (stringContent/Escape) and the interpolation delimiters; the
// interpolated expression itself is parsed by the *real* grammar (the `Interpolation` rule in
// kotlin.grammar), not scanned by hand — that's what lets `"${x.let { it + 1 }}"` (a lambda,
// with its own braces, inside an interpolation) parse correctly without manual brace-counting.
//
// A `ContextTracker` stack tracks whether we're currently scanning string content (and whether
// the enclosing string is `"..."` or `"""..."""`) or back in ordinary code inside a `${ }`. The
// stack is pushed on `stringStart`/`stringStartTriple`/`interpolationStart` and popped when the
// corresponding grammar rule (`StringTemplate`/`Interpolation`) reduces, so nesting (a string
// inside an interpolation inside a string) falls out for free.
//
// This file is never required in place — build-kotlin-grammar.mjs copies it into generated/
// alongside parser.js/parser.terms.js (kotlin.grammar's `@external tokens .../ @context` paths
// resolve relative to the grammar file at build time, but the generated import ends up needing
// to resolve relative to generated/ at runtime — see that script's comment). The `require("./
// parser.terms.js")` below is only ever correct from generated/'s copy, not from here.

const { ContextTracker, ExternalTokenizer } = require("@lezer/lr");
const {
  Escape,
  Interpolation,
  SimpleInterpolation,
  StringTemplate,
  StringStart,
  StringStartTriple,
  Nl,
  BlockComment,
  AccessorNl,
  LabelAt,
  LabelDef,
  DestructureOpen,
  TypeArgsOpen,
  AnnotationTypeArgsOpen,
  EntryAt,
  ParamAt,
  interpolationStart,
  stringContent,
  stringEnd,
  stringEndTriple,
} = require("./parser.terms.js");

const DOLLAR = 36;
const QUOTE = 34;
const NEWLINE = 10;
const BACKSLASH = 92;
const BRACE_OPEN = 123;

function isIdentStart(ch) {
  return ch === 95 || (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122);
}

function isIdentPart(ch) {
  return isIdentStart(ch) || (ch >= 48 && ch <= 57);
}

class StringCtx {
  constructor(parent, inString, triple) {
    this.parent = parent;
    this.inString = inString;
    this.triple = triple;
  }
}

/** Tracks whether the tokenizer is currently inside string-literal text or back in ordinary
 *  code (inside a `${ }` interpolation), and — when inside a string — whether it's the
 *  single-quoted or triple-quoted flavor. */
const trackStrings = new ContextTracker({
  start: null,
  shift(context, term) {
    if (term === StringStart) return new StringCtx(context, true, false);
    if (term === StringStartTriple) return new StringCtx(context, true, true);
    if (term === interpolationStart) return new StringCtx(context, false, false);
    return context;
  },
  reduce(context, term) {
    if (term === StringTemplate || term === Interpolation) {
      return context ? context.parent : context;
    }
    return context;
  },
});

const stringTokens = new ExternalTokenizer(
  (input, stack) => {
    const ctx = stack.context;
    if (!ctx || !ctx.inString) return;
    const triple = ctx.triple;
    const start = input.pos;

    for (;;) {
      const next = input.next;
      if (next < 0) break;

      if (next === QUOTE) {
        if (triple) {
          if (input.peek(1) === QUOTE && input.peek(2) === QUOTE) {
            if (input.pos === start) {
              input.acceptToken(stringEndTriple, 3);
              return;
            }
            break;
          }
          input.advance();
          continue;
        }
        if (input.pos === start) {
          input.acceptToken(stringEnd, 1);
          return;
        }
        break;
      }

      if (!triple && next === NEWLINE) {
        // An unterminated single-line string: close it here so a missing closing quote
        // doesn't swallow the rest of the file into one giant error span.
        if (input.pos === start) {
          input.acceptToken(stringEnd, 0);
          return;
        }
        break;
      }

      if (next === DOLLAR) {
        if (input.peek(1) === BRACE_OPEN) {
          if (input.pos === start) {
            input.acceptToken(interpolationStart, 2);
            return;
          }
          break;
        }
        if (isIdentStart(input.peek(1))) {
          if (input.pos === start) {
            input.advance(); // "$"
            input.advance(); // first identifier char
            while (isIdentPart(input.next)) input.advance();
            input.acceptToken(SimpleInterpolation);
            return;
          }
          break;
        }
        input.advance();
        continue;
      }

      if (!triple && next === BACKSLASH) {
        if (input.pos === start) {
          input.advance();
          if (input.next >= 0) input.advance();
          input.acceptToken(Escape);
          return;
        }
        break;
      }

      input.advance();
    }

    if (input.pos > start) input.acceptToken(stringContent);
  },
  { contextual: true },
);

const TAB = 9;
const SPACE = 32;
const FORM_FEED = 12;
const CARRIAGE_RETURN = 13;
const SEMICOLON = 59;
const SLASH = 47;
const STAR = 42;
const DOT = 46;
const QUESTION = 63;
const COLON = 58;
const AMPERSAND = 38;
const PIPE = 124;
const DASH = 45;
const GREATER = 62;

function isWhitespace(ch) {
  return ch === SPACE || ch === TAB || ch === CARRIAGE_RETURN || ch === NEWLINE || ch === FORM_FEED;
}

/** True when `word` sits at `input.peek(offset)` and isn't just the prefix of a longer identifier. */
function wordAt(input, offset, word) {
  for (let i = 0; i < word.length; i++) {
    if (input.peek(offset + i) !== word.charCodeAt(i)) return false;
  }
  return !isIdentPart(input.peek(offset + word.length));
}

/** Skips whitespace and comments starting at `offset`; returns the offset of the next real token. */
function skipTrivia(input, offset) {
  let p = offset;
  for (;;) {
    const ch = input.peek(p);
    if (isWhitespace(ch)) {
      p++;
    } else if (ch === SLASH && input.peek(p + 1) === SLASH) {
      while (input.peek(p) >= 0 && input.peek(p) !== NEWLINE) p++;
    } else if (ch === SLASH && input.peek(p + 1) === STAR) {
      p += 2;
      while (input.peek(p) >= 0 && !(input.peek(p) === STAR && input.peek(p + 1) === SLASH)) p++;
      p += 2;
    } else {
      return p;
    }
  }
}

/** Length of the whitespace run at the token position if it contains a line break or `;`, else 0. */
function whitespaceEnd(input) {
  let end = 0;
  let separates = false;
  for (;;) {
    const ch = input.peek(end);
    if (ch === NEWLINE || ch === SEMICOLON) separates = true;
    else if (!isWhitespace(ch)) break;
    end++;
  }
  return separates ? end : 0;
}

/** True when a property accessor starts at `offset`: `get(` / `set(`, or `get`/`set` after visibility
 *  modifiers (`private set`). Narrow on purpose: a newline is only a separator here, where an
 *  untyped `set(value)` would otherwise be read as an infix call on the preceding initializer. */
function startsAccessor(input, offset) {
  let p = offset;
  let modified = false;
  for (let more = true; more; ) {
    more = false;
    for (const modifier of ["public", "private", "protected", "internal"]) {
      if (wordAt(input, p, modifier)) {
        p = skipTrivia(input, p + modifier.length);
        modified = true;
        more = true;
        break;
      }
    }
  }
  if (!wordAt(input, p, "get") && !wordAt(input, p, "set")) return false;
  return modified || input.peek(skipTrivia(input, p + "get".length)) === 40; // "("
}

/** True for a `when` branch's `else ->`, which starts a new entry rather than continuing an `if`. */
function startsWhenElseBranch(input, offset) {
  const p = skipTrivia(input, offset + "else".length);
  return input.peek(p) === DASH && input.peek(p + 1) === GREATER;
}

/** True when the token at `offset` continues the previous expression across a line break
 *  (Kotlin allows a newline before these, so it must not end the statement). */
function continuesExpression(input, offset) {
  const ch = input.peek(offset);
  const next = input.peek(offset + 1);
  if (ch === DOT && next !== DOT) return true; // `.` but not the range operator `..`
  if (ch === QUESTION && (next === DOT || next === COLON)) return true; // `?.` `?:`
  if ((ch === AMPERSAND && next === AMPERSAND) || (ch === PIPE && next === PIPE)) return true;
  return (
    wordAt(input, offset, "as") ||
    (wordAt(input, offset, "else") && !startsWhenElseBranch(input, offset)) ||
    wordAt(input, offset, "catch") ||
    wordAt(input, offset, "finally")
  );
}

/** Emits `Nl` for a run of whitespace containing a line break or `;`, when a statement separator
 *  is grammatically valid here and the next token doesn't continue the current expression. A
 *  `;` always separates; a bare line break only does if it isn't followed by a continuation. */
const nlTokens = new ExternalTokenizer(
  (input, stack) => {
    if (stack.canShift(AccessorNl)) {
      const end = whitespaceEnd(input);
      if (end > 0 && startsAccessor(input, skipTrivia(input, end)))
        input.acceptToken(AccessorNl, end);
      return;
    }
    if (!stack.canShift(Nl)) return;
    let end = 0;
    let sawNewline = false;
    let sawSemicolon = false;
    for (;;) {
      const ch = input.peek(end);
      if (ch === NEWLINE) sawNewline = true;
      else if (ch === SEMICOLON) sawSemicolon = true;
      else if (!isWhitespace(ch)) break;
      end++;
    }
    if (!sawNewline && !sawSemicolon) return;
    if (!sawSemicolon && continuesExpression(input, skipTrivia(input, end))) return;
    input.acceptToken(Nl, end);
  },
  { contextual: true },
);

const COMMA = 44;
const commentTokens = new ExternalTokenizer((input) => {
  if (input.next !== SLASH || input.peek(1) !== STAR) return;
  let depth = 1;
  let p = 2;
  while (depth > 0) {
    const ch = input.peek(p);
    if (ch < 0) return;
    if (ch === SLASH && input.peek(p + 1) === STAR) {
      depth++;
      p += 2;
    } else if (ch === STAR && input.peek(p + 1) === SLASH) {
      depth--;
      p += 2;
    } else {
      p++;
    }
  }
  input.acceptToken(BlockComment, p);
});

const AT = 64;
const LEFT_PAREN = 40;
const RIGHT_PAREN = 41;

/** True when the `(` at the current position opens a lambda destructuring: its matching `)` is
 *  followed by `->`, `:` or `,`. A parenthesized expression at the start of a lambda body is not. */
function startsLambdaDestructuring(input) {
  let depth = 0;
  let p = 0;
  for (; p < 400; p++) {
    const ch = input.peek(p);
    if (ch < 0) return false;
    if (ch === LEFT_PAREN) depth++;
    else if (ch === RIGHT_PAREN && --depth === 0) break;
  }
  if (depth !== 0) return false;
  const q = skipTrivia(input, p + 1);
  const ch = input.peek(q);
  const next = input.peek(q + 1);
  return (ch === DASH && next === GREATER) || (ch === COLON && next !== COLON) || ch === COMMA;
}

const DECLARATION_WORDS = [
  "fun",
  "class",
  "interface",
  "object",
  "val",
  "var",
  "typealias",
  "enum",
  "annotation",
  "data",
  "sealed",
  "open",
  "abstract",
  "final",
  "inner",
  "inline",
  "value",
  "operator",
  "infix",
  "tailrec",
  "external",
  "const",
  "lateinit",
  "override",
  "private",
  "public",
  "protected",
  "internal",
  "suspend",
  "expect",
  "actual",
  "companion",
  "init",
  "constructor",
];

/** Offset just past the balanced `(...)` starting at `open`, or -1. */
function skipParens(input, open) {
  let depth = 0;
  for (let p = open; p < open + 400; p++) {
    const ch = input.peek(p);
    if (ch < 0) return -1;
    if (ch === LEFT_PAREN) depth++;
    else if (ch === RIGHT_PAREN && --depth === 0) return p + 1;
  }
  return -1;
}

/** True when the `@` at the current position begins an annotation on an enum entry: after its
 *  annotations comes an identifier that isn't a declaration keyword (an entry name), not a member. */
function startsEnumEntryAnnotation(input) {
  let p = 0;
  while (input.peek(p) === AT) {
    p++;
    while (isIdentPart(input.peek(p)) || input.peek(p) === DOT || input.peek(p) === COLON) p++;
    p = skipTrivia(input, p);
    if (input.peek(p) === LEFT_PAREN) {
      p = skipParens(input, p);
      if (p < 0) return false;
      p = skipTrivia(input, p);
    }
  }
  if (!isIdentStart(input.peek(p))) return false;
  return !DECLARATION_WORDS.some((word) => wordAt(input, p, word));
}

/** True when the `@` at the current position begins an annotation on a lambda parameter
 *  (`{ @Foo x: Int -> ... }`): after its annotations comes a parameter name followed by `:`, `,` or
 *  `->`. A lambda body that merely starts with an annotated declaration (`{ @Foo val x = 1 }`) has a
 *  declaration keyword there instead. */
function startsLambdaParamAnnotation(input) {
  let p = 0;
  while (input.peek(p) === AT) {
    p++;
    while (isIdentPart(input.peek(p)) || input.peek(p) === DOT || input.peek(p) === COLON) p++;
    p = skipTrivia(input, p);
    if (input.peek(p) === LEFT_PAREN) {
      p = skipParens(input, p);
      if (p < 0) return false;
      p = skipTrivia(input, p);
    }
  }
  if (!isIdentStart(input.peek(p))) return false;
  if (DECLARATION_WORDS.some((word) => wordAt(input, p, word))) return false;
  while (isIdentPart(input.peek(p))) p++;
  p = skipTrivia(input, p);
  const next = input.peek(p);
  return next === COLON || next === COMMA || (next === DASH && input.peek(p + 1) === 62);
}

const LESS = 60;
const GREATER_CH = 62;

/** Characters that can appear inside a call's explicit type arguments. Anything else (`=`, `;`, `{`,
 *  `||`, a stray `)`) means the `<` is a comparison. */
function isTypeArgChar(ch) {
  return (
    isIdentPart(ch) ||
    isWhitespace(ch) ||
    ch === DOT ||
    ch === COMMA ||
    ch === QUESTION ||
    ch === STAR ||
    ch === COLON ||
    ch === AT ||
    ch === 96 || // backtick
    ch === AMPERSAND
  );
}

/** True when the `<` at the current position opens explicit call type arguments: its matching `>`
 *  is followed by `(`, `{` or `::`. Scans only characters valid in a type, so ordinary comparisons
 *  (`a < b && c > (d)`) are rejected. */
function startsTypeArguments(input, anyFollower = false) {
  let angle = 0;
  let paren = 0;
  let p = 0;
  for (; p < 300; p++) {
    const ch = input.peek(p);
    if (ch === LESS) angle++;
    else if (ch === GREATER_CH) {
      if (--angle === 0) break;
    } else if (ch === DASH && input.peek(p + 1) === GREATER_CH) p++;
    else if (ch === LEFT_PAREN) paren++;
    else if (ch === RIGHT_PAREN) {
      if (--paren < 0) return false;
    } else if (ch === AMPERSAND && input.peek(p + 1) === AMPERSAND) return false;
    else if (!isTypeArgChar(ch)) return false;
  }
  if (angle !== 0 || paren !== 0) return false;
  if (anyFollower) return true;
  const q = skipTrivia(input, p + 1);
  const next = input.peek(q);
  return next === LEFT_PAREN || next === 123 || (next === COLON && input.peek(q + 1) === COLON);
}

const NON_LABEL_WORDS = new Set(["return", "break", "continue", "this", "super"]);

/** Emits `LabelAt` for an `@` directly after an identifier character (`return@f`, `this@A`), and
 *  `LabelDef` for a whole `name@` label declaration (`outer@ for`, `forEach loop@{`). A label
 *  declaration is one token so it can't be confused with an infix call on the preceding
 *  expression. */
const labelTokens = new ExternalTokenizer(
  (input, stack) => {
    if (input.next === LEFT_PAREN) {
      if (stack.canShift(DestructureOpen) && startsLambdaDestructuring(input)) {
        input.acceptToken(DestructureOpen, 1);
      }
      return;
    }
    if (input.next === LESS) {
      if (stack.canShift(TypeArgsOpen) && startsTypeArguments(input)) {
        input.acceptToken(TypeArgsOpen, 1);
      } else if (stack.canShift(AnnotationTypeArgsOpen) && startsTypeArguments(input, true)) {
        // Only shiftable directly after `@Name`, where `<` can't be a comparison, so any token may
        // follow the closing `>` (`@Foo<Bar> class A`).
        input.acceptToken(AnnotationTypeArgsOpen, 1);
      }
      return;
    }
    if (input.next === AT) {
      if (isIdentPart(input.peek(-1))) {
        if (stack.canShift(LabelAt)) input.acceptToken(LabelAt, 1);
      } else if (stack.canShift(EntryAt) && startsEnumEntryAnnotation(input)) {
        input.acceptToken(EntryAt, 1);
      } else if (stack.canShift(ParamAt) && startsLambdaParamAnnotation(input)) {
        input.acceptToken(ParamAt, 1);
      }
      return;
    }
    if (!isIdentStart(input.next) || !stack.canShift(LabelDef)) return;
    let end = 1;
    while (isIdentPart(input.peek(end))) end++;
    if (input.peek(end) !== AT) return;
    let word = "";
    for (let i = 0; i < end; i++) word += String.fromCharCode(input.peek(i));
    if (NON_LABEL_WORDS.has(word)) return;
    input.acceptToken(LabelDef, end + 1);
  },
  { contextual: true },
);

module.exports = { trackStrings, stringTokens, nlTokens, labelTokens, commentTokens };
