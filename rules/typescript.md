---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.mts"
  - "**/*.cts"
  - "**/*.js"
  - "**/*.jsx"
  - "**/*.mjs"
  - "**/*.cjs"
---

# TypeScript / JavaScript Rules and Guidelines

## Naming

- Name a validating helper for the condition that makes it **throw**, not for the state it leaves
  behind: `throwIfDifferentCurrency`, `throwIfEmpty`, `throwIfExpired` — not `assertSameCurrency`,
  `assertNotEmpty`, `ensureValid`. The caller then reads the failure case at the call site.
- Reserve `assert*` for functions declared with a TypeScript assertion signature
  (`function assertIsUser(x: unknown): asserts x is User`), where the name matches the language
  feature and the narrowing is the point.
- A non-exported top-level function is already private to its module; `private` is not valid on it.
  Choose between a module-level function and a `private` method on the merits — a pure mapper that
  never touches `this` is fine as either — and then match whichever the surrounding code uses.
