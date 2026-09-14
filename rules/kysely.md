---
paths:
  - "**/infrastructure/db/**/*.ts"
  - "**/migrations/**/*.ts"
  - "**/db/types.ts"
---

# Kysely Rules and Guidelines

## Database interface column types

- A column the database fills in and the application must never set is
  `ColumnType<T, never, never>` — selectable, not insertable, not updatable. `created_at` with a
  `DEFAULT now()` is the standard case: the type, not a convention, is what stops app code writing it.
- A column the database seeds but the application may later change is `ColumnType<T, never, U>`.
  `updated_at` is the usual example: never supplied on insert, set explicitly on update.
- Use `Generated<T>` only when the caller is genuinely allowed to override the database's value —
  a primary key with a default, or a defaulted flag the caller may set at insert time.
- Keep the `Database` interface in lockstep with the migration that creates the table, and record
  which module owns each table.

## Schema

- Money is an integer in the currency's minor unit plus an ISO-4217 code. Never a float, never a
  bare amount whose currency has to be inferred.
- Mirror a domain invariant as a check constraint where it is expressible, so a row that bypasses
  the application layer still cannot be invalid.
