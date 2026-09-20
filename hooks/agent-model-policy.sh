#!/usr/bin/env bash
#
# PreToolUse hook for the Agent tool: keeps the two ways of choosing a subagent's
# model from being mixed, because mixing them fails silently rather than loudly.
#
# A `model-*` agent carries an exact model ID in its frontmatter. The Agent tool's
# `model` parameter takes precedence over that frontmatter, and it only accepts
# family aliases that resolve to the newest release — so passing `model` alongside
# a pinned agent runs the family's latest model while the call still reads as
# pinned. Every other agent type carries no model at all, so omitting `model`
# there falls through to the default subagent model instead of a chosen tier.
#
# `fork` is exempt: it always runs on the parent conversation's model and ignores
# the `model` parameter entirely.
#
# Fails open. A malformed payload or a missing jq must never wedge a session over
# a style rule.

set -uo pipefail

payload=$(cat)

command -v jq >/dev/null 2>&1 || exit 0

tool=$(jq -r '.tool_name // ""' <<<"$payload" 2>/dev/null) || exit 0
[ "$tool" = "Agent" ] || exit 0

agent=$(jq -r '.tool_input.subagent_type // ""' <<<"$payload" 2>/dev/null)
model=$(jq -r '.tool_input.model // ""' <<<"$payload" 2>/dev/null)

[ "$agent" = "fork" ] && exit 0

deny() {
  jq -nc --arg reason "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

case "$agent" in
  model-*)
    if [ -n "$model" ]; then
      deny "Blocked by agent-model-policy: subagent_type \"$agent\" already pins its model in frontmatter, but \`model: $model\` was passed too. The \`model\` parameter overrides the pin, so this would run the newest model of that family instead of the pinned version. Drop \`model\` — for a model-* agent the agent type is the tier."
    fi
    ;;
  "")
    deny "Blocked by agent-model-policy: no subagent_type was given, so this call would run as general-purpose on the default subagent model. Pick a model-* agent to pin the tier, or name a built-in agent and pass \`model\` explicitly."
    ;;
  *)
    if [ -z "$model" ]; then
      deny "Blocked by agent-model-policy: subagent_type \"$agent\" is not model-pinned and no \`model\` was passed, so it would run on the default subagent model. Pass \`model\` explicitly, or use a model-* agent instead if you do not need this agent's prompt or tool restrictions."
    fi
    ;;
esac

exit 0
