---
name: delegate-next-tickets
description: Propose how a small team should split the next few open GitHub issues for parallel work with minimal merge conflicts, based on dependencies, module ownership, and who is currently busy. Use when the user asks who should take the next tickets/issues, how to divide upcoming work in a team, or wants a short-term parallel work-split plan. Not for planning an entire backlog or milestone at once.
allowed-tools: Bash(git remote *), Bash(git rev-parse *), Bash(gh issue list *), Bash(gh issue view *), Bash(gh pr list *), Agent, AskUserQuestion
---

You are executing this skill as a fast, cheap model. Do NOT attempt the dependency/module
reasoning yourself. Your job is mechanical: gather data with exact commands, hand the reasoning
off to a `model-sonnet-4-6` subagent via the `Agent` tool, relay any questions it raises back to
the user, and present its final answer. Follow the steps below in order, exactly. Do not skip
steps, do not reorder them, do not improvise extra research.

This skill only ever produces a plan to present to the user. It never modifies anything in
GitHub (no assignees, no labels, no comments) and never runs `git commit`, `git push`, or any
`gh issue edit` / `gh pr` write command.

## Scope guardrail

This skill plans **only the next 2-5 unblocked/soon-to-be-unblocked tickets per person** — never
the whole backlog or a whole milestone. If the reasoning subagent's output tries to plan further
ahead than that, that is a bug in your prompt to it, not something to fix by editing its output
yourself — just note it when you relay the plan.

## Step 1 — Identify the repo

Run:
```
git rev-parse --is-inside-work-tree
git remote -v
```
Parse the `origin` URL into `owner/repo` (handles both `git@github.com:owner/repo.git` and
`https://github.com/owner/repo.git` forms). If there is no git repo or no `origin` remote pointing
at GitHub, stop and ask the user for `owner/repo` with `AskUserQuestion` (free-text via "Other").

## Step 2 — Pull the raw data (no interpretation, just fetch)

Run each of these against the repo from Step 1, replacing `<owner/repo>`:

```
gh issue list --repo <owner/repo> --state open --limit 200 \
  --json number,title,labels,assignees,milestone,body
```

```
gh pr list --repo <owner/repo> --state open --limit 100 \
  --json number,title,headRefName,author,body,url
```

Save both outputs to files in the scratchpad directory (e.g. `issues.json`, `prs.json`) — do not
try to hold or summarize them in your own reasoning, you're just staging them for the subagent.

## Step 3 — Fill gaps you cannot derive from data

From `issues.json` you can see, per open issue: title, labels, milestone, current assignee(s),
and the raw body text (which in this project's issues typically contains `Depends on:` and
`Touches:` lines — but do not assume every repo formats issues this way).

You cannot derive from the data: which teammates exist and their current real-world status
(e.g. "almost done", "blocked", "on vacation"), or whether a teammate's skillset is limited to one
area (frontend-only, backend-only) or full-stack. If the user's request already stated this
explicitly, use what they said and do not re-ask. Otherwise ask via a single `AskUserQuestion` call
covering only what's actually missing, for example:
- who the team members are (if more than one assignee login appears in the data and it's unclear
  which ones are active teammates vs. e.g. a bot)
- which currently-assigned issues are actually "in progress" right now vs. just backlog-assigned
- each teammate's skill scope (full-stack vs. specialized), if it affects who could pick up a
  cross-area ticket

Do not ask about anything you can already see in the fetched data.

## Step 4 — Delegate the reasoning

Spawn one subagent with the `Agent` tool, `subagent_type: "model-sonnet-4-6"`. Give it, verbatim,
in the prompt (it starts with zero context, so include everything, not references to "the data
above"):

- The full contents of `issues.json` and `prs.json` (or paste the relevant fields inline).
- Who is on the team and what each person is currently working on (from Step 3 / the user's
  original request).
- Each teammate's skill scope, if known.
- This exact instruction block:

```
You are a subagent spawned by the `delegate-new-tickets` skill. Do not use this skill,
nor spawn further subagents.

Propose how this two-or-more-person team should split the NEXT 2-5 open, unblocked or
soon-to-be-unblocked tickets so they can work in parallel with minimal merge conflicts. Rules:

1. Do not plan the whole backlog — only the next few tickets each person would pick up after
   what they're currently doing.
2. Parse each issue body for dependency and ownership hints (e.g. "Depends on:", "Touches:", or
   equivalent free text) to build a dependency chain among near-term issues. An issue blocked by
   an issue not yet done is not "next" — skip it for now.
3. Prefer keeping one person on the same module/directory across consecutive tickets (context
   continuity, avoids one person picking up mid-refactor code someone else just touched).
4. Maximize genuine parallelism: only split two tickets across two people if their touched
   files/directories don't overlap and neither blocks the other.
5. If a real decision depends on information you don't have (a teammate's availability, whether a
   ticket should go to a specific person for skill-building reasons, whether to split a ticket
   that could go either way), do NOT guess — list it as an explicit open question instead of
   picking an answer.
6. Output: a short rationale, a concrete assignment plan (who takes what, in what order, and why
   dependencies/parallelism justify it), and a separate list of open questions (if any) for the
   user to answer, phrased as concrete multiple-choice-style options where possible.
```

## Step 5 — Relay open questions, if any

If the subagent's output includes open questions, ask them to the user in a single
`AskUserQuestion` call (batch all of them; use `multiSelect` where more than one answer could
apply). Then send the user's answers back to the SAME subagent via `SendMessage` (addressed to the
subagent you spawned in Step 4) to get a final, resolved plan. Do not try to resolve the questions
yourself.

## Step 6 — Present the result

Relay the subagent's final plan to the user as plain chat text: a short rationale plus a compact
table or list of who takes which ticket next and in what order. Do not write it to a file unless
the user asks for a durable document, and do not act on the plan (no assigning, no editing issues)
unless the user separately and explicitly asks you to.
