---
name: review-changes
description: Review changes made in the current branch
---

Review the changes in this repository. Review either what the user supplied in the prompt or per default the latest changes.

Make sure the code is correct, free of bugs, uses best practices, follows the architecture, is unified, doesn't have any "unnecessary" comments, has good, correct and valuable tests.

Use specialized, dedicated, scoped subagents if needed.

Each finding must contain the exact line number where the issue occured.

Do not edit anything.

Present the biggest findings at the end of the review in the chat. If there is a considerable amount of findings create a file in the scratchpad that contains the findings. Only present the findings once the review has been complete, do not present anything mid-run or while subagents are still running.

Do not recommend any fixes in the report. The report **must** only state the problems, not how to solve them.