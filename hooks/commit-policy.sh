#!/usr/bin/env bash
#
# PreToolUse hook for Bash: in the ~/.claude repository only the user creates
# commits. Claude may edit and stage files there, but a git command that would
# create a commit is denied, and the deny reason tells Claude to hand the
# change over instead.
#
# Denied subcommands: commit, commit-tree, merge, pull, cherry-pick, revert,
# rebase and am. Two forms of them create no commit and pass: `merge` and
# `pull` with --ff-only, which only move the branch, and --abort or --quit,
# which only end an operation already in progress.
#
# A command targets the repository when the working directory belongs to it
# (any of its worktrees included), or when the command names a path under
# ~/.claude, as `git -C ~/.claude commit` or `cd ~/.claude && git commit` do.
# The second test is path text only: it also denies a commit in a repository
# nested under ~/.claude, such as a plugin marketplace clone, when the command
# names its path.
#
# Matching is on command text, so it is best-effort: a commit made through a
# script, an alias or a variable passes, and a command that merely contains
# `git commit`, such as inside a message, is denied.
#
# PreToolUse runs only when Claude calls a tool, so commands the user types
# with `!` are not checked and the user can still commit from the prompt.
#
# Fails open. A malformed payload or a missing jq must never wedge a session.

set -uo pipefail

payload=$(cat)

command -v jq >/dev/null 2>&1 || exit 0

tool=$(jq -r '.tool_name // ""' <<<"$payload" 2>/dev/null) || exit 0
[ "$tool" = "Bash" ] || exit 0

command=$(jq -r '.tool_input.command // ""' <<<"$payload" 2>/dev/null) || exit 0
cwd=$(jq -r '.cwd // ""' <<<"$payload" 2>/dev/null) || exit 0

repo="$HOME/.claude"

# The common dir is the same for the main checkout and every linked worktree.
in_repo() {
  [ -n "$cwd" ] || return 1
  [ "$(git -C "$cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" = "$repo/.git" ]
}

# Absolute, `~/`, `$HOME/` and `${HOME}/` spellings. A bare `.claude/` is not
# enough: other projects keep their own `.claude/` directory.
names_repo() {
  local home_re
  home_re=$(sed 's/[][\.*^$(){}+?|]/\\&/g' <<<"$HOME")
  grep -Eq '(~|\$HOME|\$[{]HOME[}]|'"$home_re"')/\.claude([/[:space:]"'"'"';&|)]|$)' <<<"$command"
}

in_repo || names_repo || exit 0

# Global options such as -C <path>, -c <key=value> or --no-pager may sit
# between `git` and the subcommand.
git_re='(^|[^[:alnum:]_.-])git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+(commit|commit-tree|merge|pull|cherry-pick|revert|rebase|am)([[:space:]]|$)'

# Exemptions apply per simple command, so `git merge --ff-only x && git commit`
# is still denied. Quoting is ignored: a separator inside a string splits too.
while IFS= read -r segment; do
  subcommand=$(grep -Eo "$git_re" <<<"$segment" | head -n 1 | awk '{ print $NF }')
  [ -n "$subcommand" ] || continue

  case "$subcommand" in
    merge|pull)
      grep -Eq -- '(^|[[:space:]])--ff-only([[:space:]=]|$)' <<<"$segment" && continue
      ;;
  esac
  case "$subcommand" in
    merge|rebase|cherry-pick|revert|am)
      grep -Eq -- '(^|[[:space:]])--(abort|quit)([[:space:]]|$)' <<<"$segment" && continue
      ;;
  esac

  jq -nc --arg reason "Blocked by commit-policy: in the ~/.claude repository only the user creates commits, so this \`git $subcommand\` did not run. Leave the changes in the working tree, staged or not, and tell the user they are ready to commit. Do not create the commit another way, such as through a script, plumbing commands or by skipping hooks. Denied: commit, commit-tree, merge, pull, cherry-pick, revert, rebase, am. Allowed: merge and pull with --ff-only, and --abort or --quit." '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
done < <(tr ';|&()`\n' '\n\n\n\n\n\n\n' <<<"$command")

exit 0
