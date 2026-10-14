#!/bin/sh
# Auto-prepends `nvm use` for Bash commands run against a project pinning a
# Node version (.nvmrc or package.json engines.node). Exists because Bash
# tool calls don't share shell state with each other, so `nvm use` run in
# one call has no effect on the next one.
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
dir=$(printf '%s' "$input" | jq -r '.cwd // empty')
[ -z "$dir" ] && dir="$PWD"

case "$cmd" in
  *nvm\ use*|*nvm.sh*) printf '{}'; exit 0 ;;
esac

# A command often leads with its own `cd <path> &&`, which runs before this
# hook's `cwd` field would reflect it. Pull that path out for detection, and
# keep the raw (unquoted-here) remainder split for reconstruction below.
lead_sep=""
lead_before=""
lead_after=""
case "$cmd" in
  "cd "*)
    rest="${cmd#cd }"
    case "$rest" in
      *"&&"*)
        lead_sep="&&"
        lead_before="${rest%%&&*}"
        lead_after="${rest#*&&}"
        ;;
      *";"*)
        lead_sep=";"
        lead_before="${rest%%;*}"
        lead_after="${rest#*;}"
        ;;
      *)
        lead_sep="only"
        lead_before="$rest"
        ;;
    esac
    path_part=$(printf '%s' "$lead_before" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')
    path_part="${path_part%\"}"; path_part="${path_part#\"}"
    path_part="${path_part%\'}"; path_part="${path_part#\'}"
    if [ -n "$path_part" ]; then
      case "$path_part" in
        /*) dir="$path_part" ;;
        *) dir="$dir/$path_part" ;;
      esac
    fi
    ;;
esac

# Only rewrite commands that actually invoke a node-managed tool. Anything
# else (ls, cat, git, grep, ...) must reach the permission/approval check
# unmodified, or it stops matching existing allow rules.
effective_cmd="$cmd"
[ -n "$lead_sep" ] && effective_cmd="$lead_after"
effective_cmd=$(printf '%s' "$effective_cmd" | sed -E 's/^[[:space:]]+//')
case "$effective_cmd" in
  node\ *|node|npm\ *|npm|npx\ *|npx|yarn\ *|yarn|pnpm\ *|pnpm|corepack\ *|corepack) ;;
  *) printf '{}'; exit 0 ;;
esac

d="$dir"
found=""
while [ -n "$d" ] && [ "$d" != "/" ] && [ "$d" != "." ]; do
  if [ -f "$d/.nvmrc" ]; then
    found="$d"; break
  fi
  if [ -f "$d/package.json" ] && jq -e 'has("engines") and (.engines|has("node"))' "$d/package.json" >/dev/null 2>&1; then
    found="$d"; break
  fi
  [ -d "$d/.git" ] && break
  d=$(dirname "$d")
done

if [ -z "$found" ]; then
  printf '{}'
  exit 0
fi

nvm_init='export NVM_DIR="$HOME/.config/nvm"; [ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && \. "/opt/homebrew/opt/nvm/nvm.sh" >/dev/null 2>&1; '

if [ -n "$lead_sep" ]; then
  # `nvm use` must run AFTER the leading `cd`, not before it, since it reads
  # .nvmrc from the current directory.
  case "$lead_sep" in
    "&&") body="cd ${lead_before}&& nvm use >/dev/null 2>&1 &&${lead_after}" ;;
    ";") body="cd ${lead_before}; nvm use >/dev/null 2>&1;${lead_after}" ;;
    "only") body="cd ${lead_before}&& nvm use >/dev/null 2>&1" ;;
  esac
  newcmd="${nvm_init}${body}"
else
  newcmd="${nvm_init}nvm use >/dev/null 2>&1; ${cmd}"
fi

jq -n --arg cmd "$newcmd" '{"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":{"command":$cmd}}}'
