# solid — SOLID Principle Analysis

Analyze a TypeScript/JavaScript file for SOLID principle violations and propose concrete refactoring.

## Invocation modes

**Auto (hook after Edit/Write):** Analyze the file just edited. Stay completely silent if no violations are found — do not output anything.

**Manual (`/solid [file]`):** Analyze the given file, or ask the user which file to check.

## Analysis checklist

### S — Single Responsibility
One class/module = one reason to change.

Red flags:
- Class mixes I/O, data transformation, and business logic in the same methods
- Method name uses "and" or does 2+ unrelated things
- File exceeds ~200 lines with multiple distinct public concerns

### O — Open/Closed
Extend behavior without modifying existing code.

Red flags:
- `if`/`switch` on a type discriminant that must grow whenever a new case is added
- `instanceof` chains used to dispatch behavior
- Hardcoded values or behavior that should be an injectable parameter

### L — Liskov Substitution
Subtypes must be drop-in replacements for their base type without breaking callers.

Red flags:
- Override throws `"not implemented"` or `"not supported"`
- Override narrows accepted inputs or widens possible outputs vs. the base signature
- Subclass no-ops or ignores an inherited method

### I — Interface Segregation
Don't force clients to depend on methods they don't use.

Red flags:
- Interface with 5+ methods where most implementors stub or throw on several
- Function parameter typed as a wide object but only 1–2 fields are actually used
- Passing a full class instance where a narrow callback or `Pick<T, K>` would do

### D — Dependency Inversion
Depend on abstractions, not concretions.

Red flags:
- `new ConcreteService()` constructed inside another class (hard coupling)
- Directly importing and calling a module that has side effects, with no injection seam
- No way to swap the implementation without editing the calling source

## Output format — violations found

```
[S] UserService handles both persistence and email sending
  Line 42–80: `sendWelcomeEmail(user)` inside `UserService`
  Fix: extract EmailService, inject via constructor

[D] Logger instantiated directly inside PaymentProcessor
  Line 12: `const log = new FileLogger()`
  Fix: accept a `Logger` interface via constructor injection
```

End with:
> Apply any of these refactors? (yes / specify which / skip)

## Output format — no violations

Say nothing. Do not output "SOLID: clean" or any confirmation. Total silence.