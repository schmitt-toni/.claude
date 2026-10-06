---
name: post-pr-review
description: Publish the review on the Pull Request
---

Publish the review on the Pull Request. You **must** have at least one finding to publish a review. If there are no findings, stop and ask the user.

Open a review on the Pull Request and post every finding as a separate comment on the file and line where it occurred. If a finding spans several lines, anchor it to the range.

## Severity levels

Use exactly one of these per finding. Do not invent new levels or emojis.

| Emoji | Severity | Use when                                                                                                            |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| 🔴    | Critical | Security vulnerability, data loss or corruption, crash, or broken core functionality                                |
| 🟠    | Major    | Incorrect behavior in realistic cases, missing error handling, significant performance problem, breaking API change |
| 🟡    | Minor    | Edge-case bugs, unclear logic, missing tests for changed behavior, maintainability issues                           |
| 🔵    | Nitpick  | Style, naming, formatting, small readability improvements                                                           |
| 💬    | Question | You need clarification from the author before you can judge the code                                                |

## Blocking

Findings can be blocking, they must be fixed before merging.

- ⛔ **Blocking**: must be fixed before merge

Apply these rules:

- 🔴 Critical is always ⛔ Blocking
- 🟠 Major is ⛔ Blocking by default. It is non-blocking only if the impact is limited; in that case, start the explanation with "Non-blocking because …"
- 🟡 Minor, 🔵 Nitpick and 💬 Question are always non-blocking

## Category

Tag each finding with exactly one category:
`Security`, `Bug`, `Performance`, `Error Handling`, `Maintainability`, `Tests`, `Docs`, `Style`

## Comment template

Every inline comment must follow this template exactly:
The first line depends on whether the finding is blocking:

- blockingHeader: `{severity emoji} **{Severity}** · ⛔ **Blocking** · `{Category}``
- nonBlockingHeader: `{severity emoji} **{Severity}** · `{Category}``

```
{blockingHeader | nonBlockingHeader}

**{Short title, max. 10 words}**

{What is wrong and why it matters, 1–4 sentences.}

{Optional: concrete fix, as a GitHub suggestion block when the fix is local to the commented lines}
```

## Review summary

Post the review body with the header `# 🤖 Review` and this structure:

```
# 🤖 Review

{One sentence verdict: e.g. "2 blocking issues must be resolved before merge." or "No blocking issues, a few suggestions below."}

| Severity     | Count |
|--------------|-------|
| 🔴 Critical  | {n} |
| 🟠 Major     | {n} |
| 🟡 Minor     | {n} |
| 🔵 Nitpick   | {n} |
| 💬 Question  | {n} |

## ⛔ Blocking issues
- {severity emoji} {Short title} ({file}:{line})

{Omit the "Blocking issues" section if there are none.}
```

## Review state

- If there is at least one ⛔ Blocking finding, submit the review as **Request changes**
- Otherwise, submit it as **Comment**
- Post inline comments in order of severity (🔴 → 💬), then by file path

## Working on GitHub

Never use `#N` to reference a previous issue or number an issue, this will link with a GitHub Issue or PR.
Only use `#N` to reference a GitHub Issue or PR.
