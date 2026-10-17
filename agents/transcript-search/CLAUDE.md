# Task agents

A task agent exists for one kind of work and carries its own prompt and tool restrictions, unlike
the model-pinned agents in `agents/models/`. It pins `model:` and `effort:` in its frontmatter like
they do, and `hooks/agent-model-policy.sh` reads that frontmatter, so it is called without a
`model` parameter. The hook finds the file by name at any depth under `agents/`, so name it after
the agent's `name:`. Each task agent has a folder of the same name that holds its file and the
scripts it runs.

- `transcript-search` — the only agent allowed to search session transcripts and the prompt
  history. It writes excerpts with `render-excerpt.sh` in this folder and never judges them;
  `hooks/transcript-search-contract.sh` makes every call name an output directory for them. Its
  name is repeated in both hooks, `hooks/transcript-access-policy.sh` and
  `hooks/transcript-search-contract.sh`, and in its folder name; rename them together.
