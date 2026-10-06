---
name: ultra-pr-review
description: Executes `/code-reivew high`, `/review-changes` and `/review-high-level` on a Pull Request.
---

The user **must** supply a Pull Request, if the user did not supply one stop and ask the user.

For the Pull Request:

- Spawn one Opus 5.5 subaent that executes the `/review-changes` skill
- Spawn one Opus 5.5 subagent that executes the `/review-high-level` skill
- Execute the `/code-review high` skill in this chat

Do not give the subagents any context. The prompt should only include the skill.
If there is anything of note that the subagent needs for reviewing ask the user first if it is okay to include.

Once all subagents/skills ran present all findings together.
Ask the user if they want you to publish them with the `/post-pr-review` skill

In the end present all findings and ask to publish them with the /post-pr-review skill
