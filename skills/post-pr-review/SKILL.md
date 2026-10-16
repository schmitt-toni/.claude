---
name: post-pr-review
description: Publish the review on the Pull Request
---

Publish the review on the Pull Request.

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

Details worth mentioning that are not a finding, such as a needed rebase, go in the optional top-level `note`. It is shown in the review summary below the verdict.

## Approving

Approve the PR only when the user or the instructions you are following ask you to. Pass `--approve`: the script then submits one **Approve** review that carries the remaining findings as inline comments and General findings. An approval may have no findings, and it cannot have a blocking one. Never post the approval as a separate review, for example with `gh pr review --approve`.

## Publishing

1. Validate and preview:

   ```bash
   /Users/toni/.claude/skills/post-pr-review/scripts/post-review.ts --pr <number> [--repo <owner/name>] [--approve] --dry-run <findings.json>
   ```

   Pass `--repo` unless the current directory is a clone of the PR's repository.
   - If it lists errors, fix the findings file and run it again.
   - If an inline anchor is not in the diff, check the line number first. Set `inline` to `false` only when the finding really is about code outside the diff.
   - If it reports that the PR was opened by the posting account, stop and ask the user how to proceed.
2. Show the user the complete preview, including every warning, and ask for permission to post it. Do not ask when the instructions you are following say to post without asking.
3. Then run the same command without `--dry-run` and report the review URL it prints.
   Tell the user that the PR is now watched for up to 24 hours while this session stays open, and that `/re-review` starts once the author re-requests the review. Do not start a watch yourself: a hook (`~/.claude/hooks/re-review-watch.ts`) does it after the review is posted. It stops on its own when the PR is closed, merged or converted to draft.

The script submits the review as **Approve** when it runs with `--approve`. Otherwise it submits **Request changes** when at least one finding is ⛔ Blocking and **Comment** when none is. It orders the comments by severity (🔴 → 💬), then by file path and line. General findings appear in the review summary in the same order, with a link to the file at the PR's head commit when they name a path.

Only use `#N` to reference a GitHub Issue or PR. The script warns about every `#N` in a finding's text; remove it unless it references a GitHub Issue or PR.
