---
paths:
  - "**/*.cs"
---

# C# Specific Rules and Guidelines

## Pattern matching

- Never write `is { }` or `is not { }`. Use `is null` and `is not null`. Property patterns that actually match something, such as `is { Count: > 0 }`, are fine.
- Never write `is { } x` to capture a non-null value. Use `is Type x` when the type is narrowed; otherwise check `is not null` and keep using the existing variable.
- Use `is` and `is not` whenever the right-hand side is a constant, `null`, a type, or a pattern: `count is 0`, `value is null`, `name is not "admin"`, `obj is Customer customer`. Use `==` or `!=` only to compare two runtime values, which `is` cannot express.
- Never negate a bool with `!`. Write `flag is false`, `string.IsNullOrWhitespace(name) is false`, `items.Contains(x) is false`. FOr a negated compound expression, invert the condition itself rather than wrapping it in `!`.

## Nullability and required members

- For `Nullable<T>` (`int?`, `DateTime?`, `Guid?`, ...), test with `.HasValue` and read with `.Value`. Do not null-check a value type with `is null`, `is not null`, or `!= null`. Reference types continue to use `is null` / `is not null`.
- `required` and nullable are independent axes. Nullable says a value may be absent; `required` forces the caller to make a decision about it. `public required string? MiddleName { get; init; }` is correct and intentional.
- Before finishing a type, ask what it needs to fully function, and mark every one of those members `required` so nothing can be forgotten at a construction site.

## Naming

- Do not default to the `Service` suffix. Name a type after the responsibility it actually has: `LockGuard`, `Synchronizer`, `Manager`, `Orderer`, `Coordinator`, `Dispatcher`, `Validator`, `Factory`, `Cache`, and so on.
- If no precise name fits, treat that as a signal the type has more than one responsibility.

## Async and cancellation

- Every `Task`- or `ValueTask`-returning method takes `CancellationToken cancellationToken = default` as its last paramter.
- Forward that token to every call that accepts one. Never substitute `CancellationToken.None` and never drop the token.
- Test code, and interface implementation that you do not own is exempt

## Documentation and comments

- Every declaration gets XML documentation, private and internal included: types, members, paramters, type paramters, return value, and thworn exceptions.
- Documentation states the contract and the reasoning behind it. Do not restate the identifier - `/// <summary>Gets the user id.</summary>` on `UserId` adds nothing. Dcoument what the value refers to, when it is set, and what caller may rely on.
- Comments describe the current state only, and explain WHY the code is the way it is. Never reference history: no "previously", "changed from", "used to", "we no longer". Anything worth saying about a past state belongs in the commit message or technical debpts documentation.

## Options and dependency injection

- Configuration is consumed trough `IOptions<T>`, `IOptionsSnapshot<T>`, or `IOptionsMonitor<T>`. Never register or inject a bare settings POCO.
  - `IOptions<T>`: resolved once, no reload. Most of the time the correct choice. Safe in singletons.
  - `IOptionsSnapshot<T>`: recomputed per scope. Use in types that must see reloaded config.
  - `IOptionsMonitor<T>`: current value plus change notification. Used in types that must react to reloads.
- Bind and validate every options type at startup: `services.AddOptions<T>().Bind(...).ValidateDataAnnotations().Validate(...).ValidateOnStart()`. A misconfigured app fails at startup, never on the first request.
- Validate the container at startup as well, `ValidateOnBuild` and `ValidateScopes`, so missing or misscoped registrations surface at start rather than at runtime.

## Logging

- Log messages are fragements, not sentences, and never end with a `.`.
- `"Order dispatch failed"` - not `"The order dispatch has failed."`
