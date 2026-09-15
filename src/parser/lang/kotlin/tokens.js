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

module.exports = { trackStrings, stringTokens };
