---
name: review-agent-setup
description: Audit and optimize the agent documentation in this repository.
disable-model-invocation: true
---

This repository contains a lot of documentation. Coding agents work better with lean,
short, focused instructions — especially in always-loaded files like AGENTS.md and
CLAUDE.md. This repo may well be over that budget already.

Analyze the agent-facing documentation and propose optimizations.

## Constraints

- **Do not make any edits.** No file writes, no commits, no branches. Propose only.
- Ground every claim in evidence: cite `path/to/file:line` or a command you ran.
  If you're inferring or guessing, label it as such.
- Do up-to-date internet research on current best practices (Claude Code docs, the
  AGENTS.md convention, published experiments/studies, write-ups from teams running
  agents at scale). Prefer primary/official sources over blog aggregation, prefer
  recent material, and distinguish "measured" from "widely repeated anecdote.".
  Use `model-sonnet-4-6` or `model-opus-4-6` subagents if needed.
- Deliver a formatted report **in chat**. No new files.

## Step 1 — Inventory before judging

Find and list every artifact that ends up in an agent's context or shapes its behavior:

- `AGENTS.md`, `CLAUDE.md` (root and nested), imports/`@`-includes they pull in
- `.claude/` — rules, skills, commands, agents, hooks, `settings.json`, MCP config
- Other vendors' equivalents if present (`.cursor/rules`, `.github/copilot-instructions.md`,
  `.windsurfrules`, etc.) — note drift between them
- `README`/`CONTRIBUTING`/`docs/` sections that duplicate the above

For each: size in lines and approximate tokens, and whether it is **always loaded**,
**conditionally loaded** (path/glob-scoped, nested), or **on demand** (skill, command,
referenced doc). Give a total always-loaded token budget up front — that's the number
the rest of the report is trying to reduce.

## Step 2 — Analysis dimensions

Work through each of these and report findings separately:

1. **Extractable to on-demand loading.** What can move to a nested `CLAUDE.md`,
   a file-scoped rule, a skill, or a plain doc that's referenced rather than inlined?
   For anything you move out: how will the agent *discover* it when relevant? A rule
   that never loads is worse than a verbose one that does — so specify the trigger
   (glob, index entry, description line) alongside each extraction.
2. **Unnecessary instructions.** What does the agent already know or can trivially
   derive — directory layout, available scripts, framework conventions, language
   idioms, `git`/tool usage? Flag restated obvious things and restated tool output.
3. **Stale or superseded.** Cross-check instructions against the actual code: commands
   that no longer exist, renamed paths, dead dependencies, guidance contradicted by
   current config (linter, formatter, tsconfig, CI). Use `git log` on the doc files to
   spot content that hasn't been touched since a major refactor.
4. **Scope-specific content.** Which instructions apply only to one part of the repo
   (frontend/backend, one package, tests, infra)? Those are candidates for nested or
   glob-scoped placement rather than the root file.
5. **Conflicts and precedence.** Contradictions between files, between an instruction
   and the code's actual convention, or between vendor-specific files. Say which one
   currently wins and which one *should*.
6. **Instruction quality, not just quantity.** Vague or unenforceable directives
   ("write clean code", "be careful"), prohibitions with no positive alternative,
   rules with no rationale where the rationale is what makes them followable, walls of
   prose that would work better as a short list or a single example.
7. **Enforce instead of instruct.** Anything that a linter rule, formatter, type check,
   test, pre-commit hook, or CI gate could enforce deterministically shouldn't be
   spending context as prose. Call these out explicitly — they're usually the biggest
   safe win.
8. **What's missing.** Under-documented things agents actually get wrong: non-obvious
   setup steps, the one command that must be run before tests pass, sharp edges,
   "don't touch this generated file". Look for signals — repeated fix-up commits,
   review comments, revert patterns, TODOs.
9. **Don't cannibalize human docs.** Distinguish agent instructions from human
   onboarding/reference docs. Trimming the former shouldn't delete the latter; note
   where content should move rather than go.
10. **Load-bearing verbosity.** Flag anything that looks bloated but is probably there
    for a reason — security, compliance, data handling, production/deploy safety,
    hard-won incident lessons. Recommend keeping these even if long, and say why.

## Step 3 — Report format

- **Summary:** current always-loaded budget, proposed budget, headline findings.
- **Findings table:** finding · location · category (from above) · severity ·
  recommendation · estimated token delta.
- **Proposed structure:** a tree showing where instructions would live after the
  change, with load conditions annotated.
- **Prioritized action list:** ordered by (impact ÷ risk). Separate "obviously safe"
  from "needs a human decision," and for the latter state the tradeoff and what you'd
  need to know to decide.
- **Sketches, not patches:** for the top few changes, show the proposed rewritten text
  inline in the report so it can be judged — but still don't write it to disk.
- **Open questions:** anything you couldn't verify from the repo alone.
- **Research notes:** sources used, with what each actually supports and how strong the
  evidence is.