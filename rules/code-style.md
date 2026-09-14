# Code Style Rules and Guidelines

## Follow what is already there

- Before introducing a naming pattern, a helper shape or a file layout, search the codebase for an
  existing one. If a convention exists, follow it — even when a different one would be your default.
- If nothing exists yet, you are setting the convention. Choose deliberately, and apply it
  consistently across the entire change rather than only where you happened to be typing.
- When a written rule and the actual codebase disagree, say so and ask. Do not silently pick one.

## Naming

- Name an injected dependency after what it **is**, not after the data it happens to serve:
  `pricingService`, `variantPriceRepository`, `orderRepository` — not `pricing`, `prices`, `orders`.
- Keep naming unified. When you rename one member of a set, rename its siblings in the same change.

## Control flow

- Fail fast. Handle the missing, invalid or exceptional case with a guard clause that returns or
  throws, then continue on the happy path at the top level of the function.
- Do not nest the happy path inside an `if`. Do not fold two independent failure checks into one
  branch to save a line — each failure gets its own guard, in the order it becomes knowable.
