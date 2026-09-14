---
paths:
  - "**/*.{Tests,Test,IntegrationTests,UnitTests}/**/*.cs"
  - "**/*{Tests,Test}.cs"
  - "**/tests/**/*.cs"
---

# Testing Rules and Guidelines for C#

## Unit Tests

- Structure every test as Arrange, Act, Assert, int that order, seperated by blank lines. One act per test.
- Supply `NullLogger<T>.Instance` whenever an `ILogger<T>` is needed. Never mock a logger just to satisfy a constructor.
- Do not pass a `CancellationToken` unless the test is specifically about cancellation. Rely on the default paramter value. This overrides the async rule for test code.
