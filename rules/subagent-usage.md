# Subagents, models, etc.

**Always pass `model` explicitly.** Pass it on **every** `Agent` call, never omit it or leave it out. `model` is independent of `subagent_type` — when a workflow pins the type, keep that type and set the tier with `model`.

**Prefer efficient `model` usage.** Always take a look at all available agents (look at `~/.claude/agents`, `[repo]/.claude/agents`, etc.) and choose the most efficient and best fitting for the task.

**Pick the tier from what the task produces**, not from how important the surrounding goal is:

- haiku — finding things and reporting them: grep, file listing, reading files, enumerating conventions, mechanical summaries.
- sonnet — work needing judgment: synthesizing constraints out of docs/ADRs, writing non-trivial code, reviewing a diff.
- opus — architecture decisions, subtle debugging, anything where a wrong answer is expensive to notice.

**Prefer multiple dedicated tasks**, rather then raising a tier.

**Consider older models too.** Subagents `model-sonnet-4-6`, `model-haiku-4-5`, `model-opus-4-6`, etc. are available and should be considered.

**Never fork without asking.** Do not fork the current session without asking the user for permission first.
