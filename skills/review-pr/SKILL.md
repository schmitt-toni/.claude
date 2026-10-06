---
name: review-pr
description: Review a Pull Request
---

Review a Pull Request. The user **must** supply the PR number to review, if the user has not supplied it stop and ask the user. Never continue without a PR number.

1. Location Check: Are you already in a temporary directory or worktree that contains the source code of the Pull Request?
   - Yes: Continue with Step 2
   - No: State it as such and clone the code in the pull request into a temporary location. 
2. Use the `/review-changes`-Skill to review the Pull Request 
