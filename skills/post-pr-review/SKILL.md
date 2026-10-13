---
name: post-pr-review
description: Publish the review on the Pull Request
---

Publish the review on the Pull Request. You **must** have at least one finding to publish a review. If there are no findings, stop and ask the user.

Every finding on a line of the PR diff becomes a separate inline comment on that file and line. If a finding spans several lines, anchor it to the range. A finding that cannot be anchored to the diff, because it is about the PR as a whole or about code the PR does not change, sets `inline` to `false` and is posted under General findings in the review summary.

You decide severity, blocking and category, and write the title, explanation and fix. The bundled script renders the comments and the review summary, validates every inline anchor against the PR diff, picks the review state and posts the review. Never write comment bodies or call the GitHub review API yourself.

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

Write the findings as JSON to a file in the scratchpad. The file must match the JSON Schema in `${CLAUDE_SKILL_DIR}/findings.schema.json`

## Publishing

1. Validate and preview:

   ```bash
   /Users/toni/.claude/skills/post-pr-review/scripts/post-review.ts --pr <number> [--repo <owner/name>] --dry-run <findings.json>
   ```

   Pass `--repo` unless the current directory is a clone of the PR's repository.
   - If it lists errors, fix the findings file and run it again.
   - If an inline anchor is not in the diff, check the line number first. Set `inline` to `false` only when the finding really is about code outside the diff.
   - If it reports that the PR was opened by the posting account and the review has blocking findings, stop and ask the user how to proceed.
2. Show the user the complete preview, including every warning, and ask for approval to post it.
3. After approval, run the same command without `--dry-run` and report the review URL it prints.

The script submits the review as **Request changes** when at least one finding is ⛔ Blocking and as **Comment** otherwise. It orders the comments by severity (🔴 → 💬), then by file path and line. General findings appear in the review summary in the same order, with a link to the file at the PR's head commit when they name a path.

Only use `#N` to reference a GitHub Issue or PR. The script warns about every `#N` in a finding's text; remove it unless it references a GitHub Issue or PR.
