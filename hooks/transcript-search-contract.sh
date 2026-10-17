#!/usr/bin/env bash
#
# PreToolUse hook for the Agent tool: a transcript-search call must name the
# directory its excerpts go to, on a line `Output directory: <absolute path>`.
#
# transcript-search runs on a small model that extracts reliably but judges
# poorly, and a caller asking it "did X help?" gets that weak judgment back as
# a confident conclusion. Requiring an output directory turns every call into
# the extract step of a pipeline: excerpts land in files, and whether something
# worked is decided by a stronger agent that reads those files. The deny reason
# carries the whole pipeline, so a caller learns it the first time it skips it.
#
# The directory may be anywhere absolute except where the transcripts live:
# excerpts written there would be guarded by transcript-access-policy and
# unreadable to the agent that has to judge them. A path containing `..` is
# refused outright rather than resolved.
#
# The agent name is repeated in agents/transcript-search/transcript-search.md
# and hooks/transcript-access-policy.sh; rename all of them together.
#
# Fails open. A malformed payload or a missing jq must never wedge a session.

set -uo pipefail

payload=$(cat)

command -v jq >/dev/null 2>&1 || exit 0

tool=$(jq -r '.tool_name // ""' <<<"$payload" 2>/dev/null) || exit 0
[ "$tool" = "Agent" ] || exit 0

agent=$(jq -r '.tool_input.subagent_type // ""' <<<"$payload" 2>/dev/null) || exit 0
[ "$agent" = "transcript-search" ] || exit 0

prompt=$(jq -r '.tool_input.prompt // ""' <<<"$payload" 2>/dev/null) || exit 0

pipeline="transcript-search only extracts. It writes verbatim excerpts as files into the directory named on a line \`Output directory: <absolute path>\` in its prompt and returns an index of those files; it does not judge what it finds. The directory must be absolute, must not contain \`..\`, and must lie outside ~/.claude/projects and ~/.claude/history.jsonl.

Questions about past sessions run in up to three steps, each started from the main conversation:
1. Locate: one transcript-search call returns the candidate sessions and line ranges.
2. Extract: one transcript-search call per session or line range, each with its own output directory. Independent calls can run in parallel.
3. Judge: whether something worked, helped, hurt or was correct is decided by a model-opus-5-5-xhigh agent that reads the excerpt files. That agent cannot read transcripts; when it needs more context around an excerpt, the main conversation starts another extract call for that line range.
A lookup question (what was asked, said, decided, run or changed) ends after step 2."

deny() {
  jq -nc --arg reason "Blocked by transcript-search-contract: $1

$pipeline" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

# The first matching line wins. One pair of backticks or quotes around the path
# is accepted, because models tend to format paths as code.
dir=$(sed -nE 's/^[[:space:]]*Output directory:[[:space:]]*(.*[^[:space:]])[[:space:]]*$/\1/p' <<<"$prompt" | head -n 1)
dir=$(sed -E 's/^`(.*)`$/\1/; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/' <<<"$dir")

[ -n "$dir" ] || deny "the prompt has no \`Output directory:\` line."

case "$dir" in
  /*) ;;
  *) deny "the output directory \"$dir\" is not an absolute path." ;;
esac

case "/$dir/" in
  */../*) deny "the output directory \"$dir\" contains \`..\`." ;;
esac

case "$dir/" in
  "$HOME/.claude/projects/"*|"$HOME/.claude/history.jsonl/")
    deny "the output directory \"$dir\" is inside the guarded transcript paths, where only transcript-search could read the excerpts."
    ;;
esac

exit 0
