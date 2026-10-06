---
name: review-high-level
description: Functional, high-level review of an implementation against its ticket, decisions and architecture
---

Run a functional/high-level review of what the user supplied (PR, tickets or addressed PR comments). Per default review the current worktree and find the ticket it implements, if none can be found stop and ask the user.

Do not review the code quality. Read the source, the tickets, other PRs, the project board and the plan, then answer:

- Does it implement what the ticket wants - nothing more, nothing less, exactly this?
- What decisions were made, are they sound, do they hold up and are they correctly documented? Are there undocumented decisions that deviate from the ticket?
- Does it fit the architecture and the existing solution?
- Does it still align with the other closed/in-progress/open tickets, PRs and the plan, or does it contradict anything?
- If PR comments were addressed: was everything actually and correctly implemented as stated?

Use specialized, dedicated, scoped subagents if needed.

Do not edit anything, do not use user-defined skills. Only present the report once the review is complete.
