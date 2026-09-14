---
name: resolve-conflicts
description: Resolve merge conflicts of a PR.
allowed-tools: Bash(git status *) Bash(git diff *) Bash(git log *) Bash(gh pr view *) Bash(gh pr diff *)
---

Resolve merge conflicts of a Pull Request. The user must supply which Pull Request the conflicts are on. If the user did not supply anything, stop and ask. Do not assume.

1. Check out the PR and merge/rebase its base branch into it. If `git status` shows no unmerged paths, report back to the user and stop.
2. Pre-check every conflict in a scratchpad. For any conflict that needs a decision rather than an unambiguous resolution, ask the user with the `AskUserQuestion` tool before proceeding.
3. Resolve all conflicts and remove every conflict marker.
4. If the project has a detectable build or test command, run it best-effort and report any failures before staging. Skip silently if none is found.
5. Stage the resolved files with `git add`. Do not commit — present the `git commit` command for the user to run themselves.
