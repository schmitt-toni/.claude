---
name: post-pr-review
description: Publish the review on the Pull Request
---

Publish the review on the Pull Request. You **must** have at least one finding to publish a review. If there are no findings, stop and ask the user.

Every finding becomes a separate inline comment on the file and line where it occurred. If a finding spans several lines, anchor it to the range.

You decide severity, blocking and category, and write the title, explanation and fix. The bundled script renders the comments and the review summary, validates every anchor against the PR diff, picks the review state and posts the review. Never write comment bodies or call the GitHub review API yourself.

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
- 🟠 Major is ⛔ Blocking by default. It is non-blocking only if the impact is limited; in that case, set `blocking` to `false` and start the explanation with "Non-blocking because …"
- 🟡 Minor, 🔵 Nitpick and 💬 Question are always non-blocking

## Category

Tag each finding with exactly one category:
`Security`, `Bug`, `Performance`, `Error Handling`, `Maintainability`, `Tests`, `Docs`, `Style`

## Findings file

Write the findings as JSON to a file in the scratchpad:

```json
{
  "findings": [
    {
      "severity": "major",
      "blocking": false,
      "category": "Error Handling",
      "path": "src/orders/service.ts",
      "startLine": 40,
      "line": 42,
      "title": "Retry loop swallows the final error",
      "explanation": "Non-blocking because the caller logs the failed order. The last error of the retry loop is dropped, so the log never says why it failed.",
      "suggestion": "throw lastError;"
    }
  ]
}
```

| Field         | Required                   | Content                                                                                                                                                                                                |
| ------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `severity`    | yes                        | `critical`, `major`, `minor`, `nitpick` or `question`                                                                                                                                                  |
| `category`    | yes                        | One of the categories above, spelled exactly as listed                                                                                                                                                 |
| `blocking`    | only for a non-blocking 🟠 | `false` for a non-blocking Major. Leave it out otherwise, the rules above decide                                                                                                                       |
| `path`        | yes                        | File path relative to the repository root, as it appears in the PR diff                                                                                                                                |
| `line`        | yes                        | The line the comment applies to; for a range, its last line                                                                                                                                            |
| `startLine`   | no                         | The first line of a range. Start and end must lie in the same diff hunk                                                                                                                                |
| `side`        | no                         | `RIGHT` (default): line numbers of the PR's version of the file, for added and unchanged lines. `LEFT`: line numbers of the base version, for deleted lines                                            |
| `title`       | yes                        | Short title, max. 10 words                                                                                                                                                                             |
| `explanation` | yes                        | What is wrong and why it matters, 1–4 sentences                                                                                                                                                        |
| `suggestion`  | no                         | Code that replaces the anchored lines, when the fix is local to them. Rendered as a GitHub suggestion block, so it must keep the file's indentation. `""` suggests deleting the lines. Only on `RIGHT` |
| `fix`         | no                         | The fix in prose, when it is not local to the anchored lines. Never together with `suggestion`                                                                                                         |

## Publishing

1. Validate and preview:

   ```bash
   /Users/toni/.claude/skills/post-pr-review/scripts/post-review.ts --pr <number> [--repo <owner/name>] --dry-run <findings.json>
   ```

   Pass `--repo` unless the current directory is a clone of the PR's repository.
   - If it lists errors, fix the findings file and run it again.
   - If it reports that the PR was opened by the posting account and the review has blocking findings, stop and ask the user how to proceed.
2. Show the user the complete preview, including every warning, and ask for approval to post it.
3. After approval, run the same command without `--dry-run` and report the review URL it prints.

The script submits the review as **Request changes** when at least one finding is ⛔ Blocking and as **Comment** otherwise. It orders the comments by severity (🔴 → 💬), then by file path and line.

## Working on GitHub

Never use `#N` to reference a previous issue or number an issue, this will link with a GitHub Issue or PR.
Only use `#N` to reference a GitHub Issue or PR. The script warns about every `#N` in a finding's text; remove it unless it references a GitHub Issue or PR.
