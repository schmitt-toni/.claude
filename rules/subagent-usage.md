# Subagents, models, etc.

## Choosing the agent

**Prefer a `model-*` agent.** They pin an exact model version and add nothing else, so the tier is
explicit and reproducible. Reach for a built-in agent only when you actually want its prompt or its
tool restrictions — `Explore` for read-only fan-out searches, `Plan` for implementation planning,
`claude-code-guide` for Claude Code / SDK / API questions.

**Prefer multiple dedicated tasks**, rather than raising a tier.

**Never fork without asking.** Do not fork the current session without asking the user for
permission first.

## Passing `model`

The `Agent` tool's `model` parameter takes precedence over an agent definition's frontmatter, and
it accepts only family aliases that resolve to the newest release. The two ways of choosing a model
are therefore mutually exclusive:

- **`model-*` agent → never pass `model`.** The pin is the tier. Passing `model` overrides the
  frontmatter, so the call runs the family's latest model while still reading as pinned.
- **Any other agent → always pass `model`.** These carry no model of their own; omitting it falls
  through to the default subagent model instead of a chosen tier.
- **`fork` → exempt.** It always runs on the parent conversation's model and ignores `model`.

`hooks/agent-model-policy.sh` denies calls that break this.

## Available agents

| Agent | Model ID | Context / output | Notes |
| --- | --- | --- | --- |
| `model-fable-5-1` | `claude-fable-5-1` | 1M / 128k | Current Fable |
| `model-fable-5` | `claude-fable-5` | 1M / 128k | |
| `model-opus-5` | `claude-opus-5` | 1M / 128k | Current Opus; fast mode |
| `model-opus-4-8` | `claude-opus-4-8` | 1M / 128k | Fast mode |
| `model-opus-4-7` | `claude-opus-4-7` | 1M / 128k | Defaults to `xhigh` effort |
| `model-opus-4-6` | `claude-opus-4-6` | 1M / 128k | No `xhigh` effort; fast mode |
| `model-sonnet-5` | `claude-sonnet-5` | 1M / 128k | Current Sonnet |
| `model-sonnet-4-6` | `claude-sonnet-4-6` | 1M / 128k | No `xhigh` effort |
| `model-haiku-4-5` | `claude-haiku-4-5-20251001` | 200k / 64k | No effort levels |

Opus 4.1 (`claude-opus-4-1-20250805`) is offered on Bedrock and Vertex only, not on a first-party
Anthropic subscription, so it has no agent here.

## Picking the tier

Pick the tier from what the task produces, not from how important the surrounding goal is:

- **haiku** — finding things and reporting them: grep, file listing, reading files, enumerating
  conventions, mechanical summaries.
- **sonnet** — work needing judgment: synthesizing constraints out of docs/ADRs, writing
  non-trivial code, reviewing a diff.
- **opus** — architecture decisions, subtle debugging, anything where a wrong answer is expensive
  to notice.
- **fable** — the problems opus does not crack: deep reasoning where getting it right matters more
  than how long it takes. Expensive, so reserve it rather than reaching for it first.

**Consider older models too.** A superseded model of the right tier usually beats the newest model
of a lower one, and the whole point of the pinned agents is that you can choose deliberately.
