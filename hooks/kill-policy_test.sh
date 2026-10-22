#!/usr/bin/env bash
#
# Table test for kill-policy.sh. Every case feeds a PreToolUse payload to the
# hook on stdin and checks only the decision it prints. No command in the
# table is ever executed: they include the ones that kill unrelated processes.
#
# Run: bash kill-policy_test.sh

set -uo pipefail

hook="$(cd "$(dirname "$0")" && pwd)/kill-policy.sh"
pass=0
fail=0

# Prints "deny" or "allow" for a raw payload.
decide() {
  local out
  out=$(printf '%s' "$1" | "$hook")
  if [ "$(jq -r '.hookSpecificOutput.permissionDecision // empty' <<<"$out" 2>/dev/null)" = "deny" ]; then
    echo deny
  else
    echo allow
  fi
}

check_payload() {
  local expected=$1 label=$2 payload=$3 actual
  actual=$(decide "$payload")
  if [ "$actual" = "$expected" ]; then
    pass=$((pass + 1))
    printf 'ok    %-5s %s\n' "$expected" "$label"
  else
    fail=$((fail + 1))
    printf 'FAIL  expected %s, got %s: %s\n' "$expected" "$actual" "$label"
  fi
}

# The label is the command itself, newlines shown as \n.
check() {
  local expected=$1 command=$2
  check_payload "$expected" "${command//$'\n'/\\n}" \
    "$(jq -nc --arg c "$command" '{tool_name: "Bash", tool_input: {command: $c}}')"
}

echo "# the incident"
check deny 'pkill -f "cat" -U $(id -u) -x'

echo "# killall, any form"
check deny 'killall Finder'
check deny 'killall -9 node'
check deny '/usr/bin/killall -u toni cat'

echo "# pkill: -f, missing -x, options after the pattern, several patterns"
check deny 'pkill -f node'
check deny 'pkill -fx node'
check deny 'pkill -x -f node'
check deny 'pkill --full node'
check deny 'pkill cat'
check deny 'pkill -9 node'
check deny 'pkill -x Balarm -9'
check deny 'pkill -x Balarm -U 501'
check deny 'pkill -x Balarm Other'
check deny 'pkill -x'
check deny 'pkill -x "node.*"'
check deny '/usr/bin/pkill -f cat'

echo "# kill with PIDs from a process search"
check deny 'kill $(pgrep node)'
check deny 'kill -9 $(pgrep -f "vite dev")'
check deny 'kill "$(pgrep -x Balarm)"'
check deny 'kill `pgrep node`'
check deny 'kill -9 $(lsof -t -i :3000)'
check deny 'pgrep node | xargs kill'
check deny 'pgrep -f node | xargs -n1 kill -9'
check deny 'ps aux | grep node | awk '"'"'{print $2}'"'"' | xargs kill'
check deny 'lsof -t -i :3000 | xargs kill -9'
check deny 'ps -ef | grep vite | xargs pkill -x'

echo "# kill with negative, zero or no targets"
check deny 'kill -1'
check deny 'kill -9 -1'
check deny 'kill -- -1'
check deny 'kill -TERM -- -$pgid'
check deny 'kill -9 -12345'
check deny 'kill 0'
check deny 'kill -s KILL -1'

echo "# wrappers"
check deny 'sudo pkill -f node'
check deny 'sudo -u root killall Dock'
check deny 'env FOO=1 pkill node'
check deny 'command pkill -f node'
check deny 'nohup pkill -f node'
check deny 'timeout 5 pkill -f node'
check deny 'timeout -s KILL 5 killall node'
check deny 'nice -n 10 pkill -f node'
check deny 'FOO=bar pkill -f node'
check deny '\pkill -f node'
check deny 'exec killall node'
check deny 'xargs killall < names.txt'

echo "# nested command strings"
check deny "sh -c 'pkill -f node'"
check deny 'bash -c "kill \$(pgrep node)"'
check deny "zsh -lc 'killall node'"
check deny "eval 'pkill -f node'"
check deny 'echo $(pkill -f node)'
check deny 'bash <<< "pkill -f node"'
check deny "sudo sh -c 'cd /tmp && killall node'"

echo "# compound commands"
check deny 'cd /tmp && pkill -f node'
check deny 'make build; killall Balarm; open Balarm.app'
check deny 'false || pkill node'
check deny 'sleep 1 & pkill -f node'
check deny $'echo start\npkill -f node'
check deny '(cd app && killall node)'
check deny 'if pgrep -x node; then pkill -f node; fi'

echo "# heredocs: data unless fed to a shell"
check allow $'cat > notes.md <<EOF\nnever run pkill -f cat\nkillall Finder\nEOF'
check allow $'git commit -m "$(cat <<\'EOF\'\nfix: stop using pkill -f (it\'s too broad)\nEOF\n)"'
check deny $'git commit -m "$(cat <<\'EOF\'\nmsg\nEOF\n)" && pkill -f node'
check deny $'bash <<EOF\npkill -f node\nEOF'
check deny $'sh <<-\'EOF\'\n\tkillall node\n\tEOF'

echo "# allowed kill and pkill"
check allow 'pkill -x Balarm'
check allow 'pkill -x Balarm; open -a Balarm'
check allow 'pkill -9 -x Balarm'
check allow 'pkill -x -U 501 Balarm'
check allow 'pkill -x -- Balarm'
check allow 'pkill -x "$APP_NAME"'
check allow 'pkill -x com.example.Helper'
check allow 'kill 12345'
check allow 'kill -TERM 12345'
check allow 'kill -9 12345 12346'
check allow 'kill -0 12345'
check allow 'kill -s TERM 12345'
check allow 'kill "$pid"'
check allow 'kill ${server_pid}'
check allow 'kill $!'
check allow 'kill %1'
check allow 'kill -l'
check allow 'kill $(cat /tmp/server.pid)'
check allow 'kill "$(cat app.pid)" 2>/dev/null || true'
check allow 'npm run dev & pid=$!; sleep 5; kill $pid'
check allow 'sudo kill 12345'

echo "# read-only and unrelated"
check allow 'pgrep -fl node'
check allow 'pgrep -x Balarm'
check allow 'grep pkill file'
check allow 'grep -rn "pkill -f" .'
check allow 'echo "killall"'
check allow 'echo "stop; pkill -f node"'
check allow "echo 'kill \$(pgrep node)'"
check allow 'git log --grep kill'
check allow 'man pkill'
check allow 'command -v pkill'
check allow 'which killall'
check allow 'cat file.txt | grep cat'
check allow 'ls ~/Library/Caches/com.apple.locationd'
check allow 'echo done # pkill -f node'
check allow 'skill-runner --kill-timeout 5'
check allow 'git commit -m "docs: explain why pkill -f is denied"'

echo "# payloads"
check_payload allow 'non-Bash tool' '{"tool_name":"Read","tool_input":{"file_path":"/tmp/pkill"}}'
check_payload allow 'malformed JSON (fail open)' '{"tool_name": "Bash", "tool_input": {'
check_payload allow 'empty payload (fail open)' ''
check_payload allow 'missing command' '{"tool_name":"Bash","tool_input":{}}'

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
