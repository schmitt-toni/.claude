#!/usr/bin/env bash
#
# PreToolUse hook for Read, Grep, Glob and Bash: session transcripts and the
# prompt history are searched only by the transcript-search subagent. They run
# to megabytes of JSON; read in the main conversation they flood its context,
# while the subagent hands back only the conclusion.
#
# Guarded: ~/.claude/projects/** (session and subagent transcripts) and
# ~/.claude/history.jsonl (prompt history). Every caller other than
# transcript-search is denied — the main conversation and any other subagent
# alike — and the deny reason, which Claude sees, tells it to delegate.
#
# Settings deny rules cannot express this: they apply to the whole session, so
# they would block transcript-search as well. A hook can tell the caller apart
# through the `agent_type` input field.
#
# Matching is on path text, so it is best-effort for Bash: a command that
# reaches the files without naming them (a variable, a script) passes, and a
# command that merely mentions a guarded path, such as a commit message, is
# denied.
#
# Fails open. A malformed payload or a missing jq must never wedge a session.

set -uo pipefail

payload=$(cat)

command -v jq >/dev/null 2>&1 || exit 0

agent_type=$(jq -r '.agent_type // ""' <<<"$payload" 2>/dev/null) || exit 0
[ "$agent_type" = "transcript-search" ] && exit 0

tool=$(jq -r '.tool_name // ""' <<<"$payload" 2>/dev/null) || exit 0
cwd=$(jq -r '.cwd // ""' <<<"$payload" 2>/dev/null) || exit 0

case "$tool" in
  Read) filter='.tool_input.file_path' ;;
  Grep|Glob) filter='[.tool_input.path, .tool_input.pattern, .tool_input.glob] | map(select(. != null)) | join(" ")' ;;
  Bash) filter='.tool_input.command' ;;
  *) exit 0 ;;
esac
target=$(jq -r "($filter) // \"\"" <<<"$payload" 2>/dev/null) || exit 0

# Absolute, `~/` and `$HOME/` spellings all contain `.claude/<guarded>`.
guarded='\.claude/(projects([/"'"'"'[:space:]]|$)|history\.jsonl)'
# Inside ~/.claude itself the guarded paths are also reachable relatively.
if [ "$cwd" = "$HOME/.claude" ]; then
  guarded="$guarded"'|(^|[[:space:]"'"'"'=])(\./)?(projects([/"'"'"'[:space:]]|$)|history\.jsonl)'
fi

grep -Eq "$guarded" <<<"$target" || exit 0

jq -nc --arg reason "Blocked by transcript-access-policy: session transcripts (~/.claude/projects/**) and the prompt history (~/.claude/history.jsonl) are searched only by the transcript-search subagent, so this $tool call did not run. Delegate the search with the Agent tool: subagent_type \"transcript-search\", no \`model\` parameter (the agent pins its own), and a prompt stating what to find plus any session ID, project or time range you know. A subagent that cannot spawn agents reports this back to its caller instead." '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }
}'
exit 0
