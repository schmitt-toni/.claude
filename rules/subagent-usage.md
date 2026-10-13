# Subagents, models, etc.

## Choosing the agent

**Prefer a `model-*` agent.** They pin an exact model version and add nothing else, so the tier is
explicit and reproducible. Reach for a built-in agent only when you actually want its prompt or its
tool restrictions — `Explore` for read-only fan-out searches, `Plan` for implementation planning,
`claude-code-guide` for Claude Code / SDK / API questions.

**Prefer multiple dedicated tasks**, rather than raising a tier.

## Available agents

Every model has a base agent, `model-<model>`, which runs at the session's effort, and one agent
per effort level it supports, `model-<model>-<effort>`, which pins the effort too — for example
`model-opus-5-5-high`. The `Agent` tool has no effort parameter, so an effort-pinned agent is the
only way to choose a subagent's effort. `CLAUDE_CODE_EFFORT_LEVEL`, when set, overrides the pin.

The levels are `low`, `medium`, `high`, `xhigh` and `max`. A model only gets agents for the levels
it supports, because an unsupported level is not rejected: it is silently lowered (`xhigh` becomes
`high`) or dropped, and the agent would run at an effort other than its name says.

| Agent | Model ID | Context / output | Effort versions | Notes |
| --- | --- | --- | --- | --- |
| `model-fable-5-1` | `claude-fable-5-1` | 1M / 128k | all | Current Fable |
| `model-fable-5` | `claude-fable-5` | 1M / 128k | all | |
| `model-opus-5-5` | `claude-opus-5-5` | 1M / 128k | all | Current Opus; defaults to `medium` effort |
| `model-opus-5` | `claude-opus-5` | 1M / 128k | all | Fast mode |
| `model-opus-4-8` | `claude-opus-4-8` | 1M / 128k | all | Fast mode |
| `model-opus-4-7` | `claude-opus-4-7` | 1M / 128k | all | Defaults to `xhigh` effort |
| `model-opus-4-6` | `claude-opus-4-6` | 1M / 128k | all but `xhigh` | No `xhigh` effort; fast mode |
| `model-sonnet-5-5` | `claude-sonnet-5-5` | 1M / 128k | all | Current Sonnet; defaults to `medium` effort |
| `model-sonnet-5` | `claude-sonnet-5` | 1M / 128k | all | |
| `model-sonnet-4-6` | `claude-sonnet-4-6` | 1M / 128k | all but `xhigh` | No `xhigh` effort |
| `model-haiku-5-5` | `claude-haiku-5-5` | 1M / 128k | all | Current Haiku; defaults to `medium` effort |
| `model-haiku-4-5` | `claude-haiku-4-5-20251001` | 200k / 64k | none | No effort levels |

## Picking a model

Prefer the newer models (Opus 5.5, Sonnet 5.5, Haiku 5.5) always.

For a few specific tasks older models are better:
- Pushing back: Prefer Opus 4.8 or Sonnet 4.6
- Low hallucination rate: Prefer Opus 4.8. It answers "I don't know" more often, but knows less than Opus 5.5 (accuracy 49% vs 66% on AA-Omniscience).

| Task | Model | Effort |
| --- |
| Multi-step implementation | Opus 5.5 | medium |
| Long unattended runs | Opus 5.5 | xhigh |
| Quick interactive edits | Sonnet 5.5 | low / medium |
| Mechanical changes | Sonnet 5.5 | low / medium |
| Exploration | Haiku 5.5 | low / medium |
| Summarization | Haiku 5.5 | low / medium |
| Extraction | Haiku 5.5 | medium |
| Classification | Haiku 5.5 | medium |
| Reasoning | Opus 5.5 | xhigh |
| Math | Opus 5.5 | xhigh |
| Factual recall | Opus 5.5 | high |
| Architecture | Opus 5.5 | xhigh |

Avoid `max` effort and Fable.

### Code Reviews

Prefer spawning multiple reviewers that review the same scope at the same time.
A good pair is Opus 5.5 xhigh and Sonnet 5.5 high.

### Credibility and detecting false claims

No models is specialized for verification. Prefer writing a prompt that explicitly asks the model to challenge premises.