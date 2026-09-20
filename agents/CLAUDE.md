# Model-pinned agents

One file per model. They are identical apart from the pin, and that is the point: they add no
prompt and no tool restrictions, so selecting one selects a model version and nothing else.

`model:` takes the exact catalog model ID rather than a family alias (`opus`, `sonnet`, …).
An alias resolves to whatever is newest at call time, which would make the pin drift on its own.

## Adding, removing or renaming a file here

Nothing resolves these agent names at runtime — they are repeated as plain text elsewhere, so a
rename that stops at this folder leaves dangling references behind. Update all of these in the
same change:

- `rules/subagent-usage.md` — the available-agents table and the tier guidance
- `hooks/agent-model-policy.sh` — enforces the `model-*` prefix as the marker of a pinned agent
- `skills/review-changes/SKILL.md` — names specific agents to prefer
- `skills/review-agent-setup/SKILL.md` — names specific agents to prefer
- `skills/delegate-next-tickets/SKILL.md` — spawns a named agent

## Which models exist

The authoritative list is the signed catalog the CLI itself fetches at startup:

    curl -s https://downloads.claude.ai/model-catalog/v1/catalog.json \
      | jq -r '.surfaces.cc.model_selector_config[].models[]
               | [.id, .name, (.offered_on | join(","))] | @tsv'

A model whose `offered_on` omits `first_party` is unreachable on an Anthropic subscription and
should not get an agent — that is why Opus 4.1 has none, being Bedrock- and Vertex-only.
