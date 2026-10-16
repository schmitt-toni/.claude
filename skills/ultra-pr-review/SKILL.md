---
name: ultra-pr-review
description: Executes `/code-reivew high`, `/review-changes` and `/review-high-level` on a Pull Request.
---

The user **must** supply a Pull Request, if the user did not supply one stop and ask the user.

For the Pull Request:

- Spawn one subagent that executes the `/review-changes` skill
- Spawn one subagent that executes the `/review-high-level` skill
- Execute the `/code-review high` skill in this chat

Instruct the subagents to:

- produce findings that match the JSON Schema at `${CLAUDE_SKILL_DIR}/../post-pr-review/findings.schema.json`
   - the findings must be written to a unique file that you created
- review the Pull Request the user supplied

Other than those instructions don't give the subagent any other context. 
If there is anything of note that the subagent needs for reviewing ask the user first if it is okay to include.

Once all subagents/skills ran merge the findings together and run `/post-pr-review`
