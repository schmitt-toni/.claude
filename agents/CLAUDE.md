# Model-pinned agents

Each model has a base file, `model-<model>.md`, plus one file per effort level it supports,
`model-<model>-<effort>.md`. They are identical apart from the pins, and that is the point: they
add no prompt and no tool restrictions, so selecting one selects a model version — and, for an
effort file, an effort level — and nothing else. A base file sets no `effort:`, so it runs at the
session's effort.

`model:` takes the exact catalog model ID rather than a family alias (`opus`, `sonnet`, …).
An alias resolves to whatever is newest at call time, which would make the pin drift on its own.

An effort file exists only for a level listed in the model's `runtime.effort_levels` in the
catalog (see below). Claude Code does not reject an unsupported level: it lowers `xhigh` to `high`
on a model without it and drops effort entirely on a model without effort support, so such a file
would quietly run as a different agent than its name claims. That is why the 4.6 models have no
`xhigh` file and Haiku 4.5 has no effort files at all.

## Adding, removing or renaming a file here

Adding a model means adding its base file and one effort file per level in its
`runtime.effort_levels`; removing or renaming one covers all of them.

Nothing resolves these agent names at runtime — they are repeated as plain text elsewhere, so a
rename that stops at this folder leaves dangling references behind. Update all of these in the
same change:

- `rules/subagent-usage.md` — the available-agents table and the tier guidance
- `hooks/agent-model-policy.sh` — enforces the `model-*` prefix as the marker of a pinned agent
- `skills/review-changes/SKILL.md` — names specific agents to prefer
- `skills/review-agent-setup/SKILL.md` — names specific agents to prefer
- `skills/delegate-next-tickets/SKILL.md` — spawns a named agent

## Which models and effort levels exist

The authoritative list is the signed catalog the CLI itself fetches at startup:

    curl -s https://downloads.claude.ai/model-catalog/v1/catalog.json \
      | jq -r '.surfaces.cc.model_selector_config[].models[]
               | [.id, .name, (.offered_on | join(",")),
                  ((.runtime.effort_levels // []) | join(","))] | @tsv'

A model whose `offered_on` omits `first_party` is unreachable on an Anthropic subscription and
should not get an agent — that is why Opus 4.1 has none, being Bedrock- and Vertex-only.
