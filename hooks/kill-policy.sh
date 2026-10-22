#!/usr/bin/env bash
#
# PreToolUse hook for Bash: denies the shapes of process-killing commands that
# reach processes other than the ones Claude started.
#
# On macOS, BSD `pkill` stops parsing options at the first pattern. An agent
# trying to stop its own hung command ran `pkill -f "cat" -U $(id -u) -x`: the
# `-U`, the uid and the `-x` became three more patterns, and `-f cat` matched
# every command line containing "cat" (every /Applications path, and every
# other Claude Code session through "claude-501" in its temp paths), killing
# 43 of the user's processes. The hung command was a background task that the
# TaskStop tool could have stopped by its ID.
#
# Denied:
# - `killall`, in any form.
# - `pkill` with -f, without -x, with more or fewer than one pattern, with an
#   option after the pattern, or with a pattern containing regex wildcards.
#   Without -x a pattern is an unanchored regex over process names, so "cat"
#   also matches "locationd".
# - `kill` whose PIDs come from a process search: `kill $(pgrep ...)`,
#   backticks, or `... | xargs kill`. Any `xargs kill` is denied, whatever
#   feeds it, because stdin cannot be inspected.
# - `kill` with a negative or zero target (`kill -9 -1`, `kill -- -$pgid`,
#   `kill 0`), which signals a whole process group or every process the user
#   owns, and `kill` with no target at all (`kill -1`).
# Allowed: `pkill -x Name` with every option before the single name, `kill`
# with literal PIDs, variables or job specs, and `pgrep` on its own.
#
# The same rules apply behind sudo, doas, env, command, exec, nohup, nice,
# time, timeout and xargs, inside `$(...)`, backticks and process
# substitution, inside `sh -c`, `bash -c`, `zsh -c` and `eval` strings, and
# inside heredocs and here-strings fed to a shell. Any other heredoc body is
# data and is not checked, so writing a script or commit message that
# mentions pkill passes.
#
# This is not a security boundary. Command text is parsed best-effort, and a
# kill run from a script on disk, an interpreter (python's os.kill, node's
# process.kill) or osascript passes. The hook exists to catch the shapes
# agents actually type and to point them at the right tool.
#
# Fails open. A malformed payload or a missing jq must never wedge a session.

set -uo pipefail

payload=$(cat)

command -v jq >/dev/null 2>&1 || exit 0

tool=$(jq -r '.tool_name // ""' <<<"$payload" 2>/dev/null) || exit 0
[ "$tool" = "Bash" ] || exit 0

command=$(jq -r '.tool_input.command // ""' <<<"$payload" 2>/dev/null) || exit 0

# Splits shell text into simple commands, one per output line, words joined
# by \037 with quotes removed. Newlines inside a word become \036. The body of
# every `$(...)`, backtick and `<(...)` is emitted as commands of its own, and
# the word that contained it keeps the raw text so a kill target can still be
# recognised as a substitution. Redirections and their targets are dropped.
# A heredoc body is emitted as commands only when the command it feeds names
# a shell; otherwise it is skipped.
read -r -d '' tokenizer <<'AWK'
BEGIN { SEP = "\037"; NL = "\036" }
{ src = (NR > 1) ? src "\n" $0 : $0 }
END { parse(src) }

function is_shell(w,    b) {
  b = w; sub(/.*\//, "", b); sub(/^\\/, "", b)
  return b ~ /^(sh|bash|zsh|dash|ksh)$/
}

function cmd_has_shell(    parts, k, m) {
  m = split(C, parts, SEP)
  for (k = 1; k <= m; k++) if (is_shell(parts[k])) return 1
  return IW && is_shell(W)
}

function flush() {
  if (IW) {
    if (R) R = 0
    else { gsub(/\n/, NL, W); C = NW ? C SEP W : W; NW++ }
  }
  W = ""; IW = 0
}

function endcmd() {
  flush()
  if (NW) print C
  C = ""; NW = 0; R = 0
}

# Sets DELIM, DSTRIP (the `<<-` form) and DEND, the first index after the
# delimiter word that starts at p.
function read_delim(s, p,    n, c) {
  n = length(s); DSTRIP = 0; DELIM = ""
  if (substr(s, p, 1) == "-") { DSTRIP = 1; p++ }
  while (p <= n && substr(s, p, 1) ~ /[ \t]/) p++
  while (p <= n) {
    c = substr(s, p, 1)
    if (c ~ /[ \t\n;&|<>()]/) break
    if (c != "'" && c != "\"" && c != "\\") DELIM = DELIM c
    p++
  }
  DEND = p
}

# p is the newline that ends the line holding `<<`. Returns the body and sets
# HEND to the newline that ends the delimiter line.
function heredoc_body(s, p, delim, strip,    n, body, e, line, chk) {
  n = length(s); body = ""; p++
  while (p <= n) {
    e = index(substr(s, p), "\n")
    if (e) { line = substr(s, p, e - 1); e = p + e - 1 } else { line = substr(s, p); e = n + 1 }
    chk = line
    if (strip) sub(/^\t+/, "", chk)
    if (chk == delim) { HEND = e; return body }
    body = body line "\n"; p = e + 1
  }
  HEND = n + 1
  return body
}

function close_bq(s, p,    n, c) {
  n = length(s)
  for (; p <= n; p++) {
    c = substr(s, p, 1)
    if (c == "\\") { p++; continue }
    if (c == "`") return p
  }
  return n + 1
}

function close_dquote(s, p,    n, c) {
  n = length(s)
  for (; p <= n; p++) {
    c = substr(s, p, 1)
    if (c == "\\") { p++; continue }
    if (c == "\"") return p
    if (c == "$" && substr(s, p + 1, 1) == "(") { p = close_paren(s, p + 2); continue }
    if (c == "`") { p = close_bq(s, p + 1); continue }
  }
  return n + 1
}

# Index of the `)` matching a `(` that ends just before p, or length + 1. A
# heredoc inside is skipped whole, so an apostrophe or a `)` in a commit
# message written through `$(cat <<'EOF' ... EOF)` does not end the scan.
function close_paren(s, p,    n, depth, c, d, e) {
  n = length(s); depth = 1
  for (; p <= n; p++) {
    c = substr(s, p, 1)
    if (c == "\\") { p++; continue }
    if (c == "'") { d = index(substr(s, p + 1), "'"); if (!d) return n + 1; p += d; continue }
    if (c == "\"") { p = close_dquote(s, p + 1); continue }
    if (substr(s, p, 3) == "<<<") { p += 2; continue }
    if (substr(s, p, 2) == "<<") {
      read_delim(s, p + 2)
      e = index(substr(s, DEND), "\n")
      if (!e) return n + 1
      heredoc_body(s, DEND + e - 1, DELIM, DSTRIP)
      p = HEND
      continue
    }
    if (c == "(") depth++
    else if (c == ")") { depth--; if (depth == 0) return p }
  }
  return n + 1
}

# Parses a nested body with fresh word state, then restores the caller's.
function sub_parse(body,    w, iw, c, nw, r) {
  w = W; iw = IW; c = C; nw = NW; r = R
  W = ""; IW = 0; C = ""; NW = 0; R = 0
  parse(body)
  W = w; IW = iw; C = c; NW = nw; R = r
}

function parse(s,    n, i, j, k, c, nx, body, nh, hdelim, hstrip, hshell, hend) {
  n = length(s); nh = 0
  for (i = 1; i <= n; i++) {
    c = substr(s, i, 1); nx = substr(s, i + 1, 1)

    if (c == "\\") {
      if (nx != "\n") { W = W nx; IW = 1 }
      i++; continue
    }
    if (c == "'") {
      j = index(substr(s, i + 1), "'")
      if (!j) j = n - i + 1
      W = W substr(s, i + 1, j - 1); IW = 1; i += j; continue
    }
    if (c == "$" && nx == "'") {
      for (j = i + 2; j <= n; j++) {
        if (substr(s, j, 1) == "\\") { j++; continue }
        if (substr(s, j, 1) == "'") break
      }
      W = W substr(s, i + 2, j - i - 2); IW = 1; i = j; continue
    }
    if (c == "\"") {
      for (j = i + 1; j <= n; j++) {
        c = substr(s, j, 1); nx = substr(s, j + 1, 1)
        if (c == "\"") break
        if (c == "\\") {
          if (nx ~ /["\\$`\n]/) { if (nx != "\n") W = W nx; j++; continue }
          W = W c; continue
        }
        if (c == "$" && nx == "(") {
          k = close_paren(s, j + 2); body = substr(s, j + 2, k - j - 2)
          sub_parse(body); W = W "$(" body ")"; j = k; continue
        }
        if (c == "`") {
          k = close_bq(s, j + 1); body = substr(s, j + 1, k - j - 1)
          sub_parse(body); W = W "`" body "`"; j = k; continue
        }
        W = W c
      }
      IW = 1; i = j; continue
    }
    if (c == "`") {
      k = close_bq(s, i + 1); body = substr(s, i + 1, k - i - 1)
      sub_parse(body); W = W "`" body "`"; IW = 1; i = k; continue
    }
    if (c == "$" && nx == "(") {
      k = close_paren(s, i + 2); body = substr(s, i + 2, k - i - 2)
      sub_parse(body); W = W "$(" body ")"; IW = 1; i = k; continue
    }
    if (c == "$" && nx == "{") {
      j = index(substr(s, i + 2), "}")
      if (!j) j = n - i - 1
      W = W substr(s, i, j + 2); IW = 1; i += j + 1; continue
    }
    if (c == "#" && !IW) {
      j = index(substr(s, i), "\n")
      if (!j) break
      i += j - 2; continue
    }
    if (c == " " || c == "\t") { flush(); continue }
    if (c == "\n") {
      endcmd()
      for (k = 1; k <= nh; k++) {
        body = heredoc_body(s, i, hdelim[k], hstrip[k]); hend = HEND
        if (hshell[k]) sub_parse(body)
        i = hend
      }
      nh = 0; continue
    }
    if ((c == "<" || c == ">") && nx == "(") {
      k = close_paren(s, i + 2); body = substr(s, i + 2, k - i - 2)
      sub_parse(body); W = W c "(" body ")"; IW = 1; i = k; continue
    }
    if (c == "<" || c == ">" || (c == "&" && nx == ">")) {
      if (IW && W ~ /^[0-9]+$/) { W = ""; IW = 0 } else flush()
      if (substr(s, i, 3) == "<<<") { W = "<<<"; IW = 1; flush(); i += 2; continue }
      if (c == "<" && nx == "<") {
        read_delim(s, i + 2)
        nh++; hdelim[nh] = DELIM; hstrip[nh] = DSTRIP; hshell[nh] = cmd_has_shell()
        i = DEND - 1; continue
      }
      while (substr(s, i + 1, 1) ~ /[<>&|]/) i++
      R = 1; continue
    }
    if (c == ";" || c == "|" || c == "&" || c == "(" || c == ")") { endcmd(); continue }

    W = W c; IW = 1
  }
  endcmd()
}
AWK

advice='On macOS, BSD pkill stops reading options at the first pattern, so options written after it become extra patterns, and -f matches every command line that contains the text. To stop a background task you started, use the TaskStop tool with its task ID. To stop a process you started in Bash, capture its PID with $! and run `kill <PID>`. To relaunch an app, run `pkill -x <ExactName>` with all options before the name.'

deny() {
  jq -nc --arg reason "Blocked by kill-policy: $1. $advice" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

# Shifting past an option's argument must not fail at the end of the word
# list: `shift 2` with one word left shifts nothing and the loop never ends.
# Callers use `shift; [ $# -eq 0 ] || shift` for that reason.

# A command substitution that runs one of these produces PIDs chosen by
# matching names or command lines rather than PIDs Claude recorded.
lookup_re='(^|[[:space:]|;(`/])(pgrep|pidof|ps|lsof|grep|egrep|fgrep|rg|awk|fuser|pkill|killall)([[:space:]|;)`]|$)'

# A pattern must be a literal name or a single variable. `.` is allowed
# because app names contain dots and -x anchors it to a single character.
regex_meta='[][*+?|(){}\\^$]'
variable_re='^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$'

check_kill() {
  local via_xargs=$1 target
  shift

  [ "$via_xargs" = 0 ] || deny "\`xargs kill\` signals PIDs read from stdin, which come from a process listing or search"

  if [ $# -gt 0 ]; then
    case "$1" in
      -l|-L) return 0 ;;
      -s|-n) shift; [ $# -eq 0 ] || shift ;;
      --) ;;
      -*) shift ;;
    esac
  fi
  [ $# -gt 0 ] && [ "$1" = "--" ] && shift

  [ $# -gt 0 ] || deny "this kill names no PID after its signal; \`kill -1\` is one argument away from \`kill -9 -1\`, which signals every process you own"

  for target in "$@"; do
    case "$target" in
      -*) deny "kill target \`$target\` is negative, which signals a whole process group, and -1 signals every process you own" ;;
      0) deny "\`kill 0\` signals the whole process group, Claude Code included" ;;
    esac
    case "$target" in
      *'$('*|*'`'*) ;;
      *) continue ;;
    esac
    grep -Eq "$lookup_re" <<<"$target" || continue
    deny "kill takes its PIDs from a process search (\`$target\`), which matches processes by name or command line"
  done
}

check_pkill() {
  local via_xargs=$1 arg rest letter full=0 exact=0 late=0 options_done=0 operands=0 pattern=""
  shift

  [ "$via_xargs" = 0 ] || deny "\`xargs pkill\` reads patterns from stdin"

  while [ $# -gt 0 ]; do
    arg=$1
    shift

    if [ "$options_done" = 1 ] || [ "$arg" = "-" ] || [[ $arg != -* ]]; then
      operands=$((operands + 1))
      pattern=$arg
      continue
    fi
    if [ "$operands" -gt 0 ]; then
      late=1
      continue
    fi

    case "$arg" in
      --) options_done=1; continue ;;
      --full) full=1; continue ;;
      --exact) exact=1; continue ;;
      --*=*) continue ;;
      --signal|--euid|--uid|--group|--pgroup|--session|--terminal|--parent|--pidfile|--ns|--nslist)
        [ $# -eq 0 ] || shift
        continue ;;
      --*) continue ;;
    esac

    # Signals: -9, -KILL, -SIGTERM. Single capital letters are the -I and -L
    # flags, not signals.
    [[ $arg =~ ^-([0-9]+|[A-Z][A-Z0-9]+)$ ]] && continue

    rest=${arg#-}
    while [ -n "$rest" ]; do
      letter=${rest:0:1}
      rest=${rest:1}
      case "$letter" in
        f) full=1 ;;
        x) exact=1 ;;
        [FGMNPUgtujsc])
          [ -n "$rest" ] || { [ $# -eq 0 ] || shift; }
          break ;;
      esac
    done
  done

  [ "$full" = 0 ] || deny "\`pkill -f\` matches the pattern against every process's full command line, not just the name"
  [ "$late" = 0 ] || deny "this pkill has an option after its pattern, which BSD pkill treats as another pattern"
  [ "$operands" -le 1 ] || deny "this pkill has $operands patterns; each one matches processes on its own"
  [ "$operands" -ge 1 ] || deny "this pkill names no pattern"
  [ "$exact" = 1 ] || deny "pkill without -x matches the pattern as a substring of process names (\"cat\" also matches \"locationd\")"

  [[ $pattern =~ $variable_re ]] && return 0
  if grep -Eq "$regex_meta" <<<"$pattern"; then
    deny "the pkill pattern \`$pattern\` contains regex wildcards; -x only anchors the regex, so it can still match many names"
  fi
}

# `sh -c 'script'` and here-strings fed to a shell carry commands of their own.
check_shell() {
  local depth=$1 arg script_next=0
  shift

  while [ $# -gt 0 ]; do
    arg=$1
    shift
    if [ "$arg" = "<<<" ]; then
      [ $# -gt 0 ] && check_text "$1" $((depth + 1))
      continue
    fi
    if [ "$script_next" = 1 ] && [[ $arg != [-+]* ]]; then
      check_text "$arg" $((depth + 1))
      script_next=2
      continue
    fi
    case "$arg" in
      -o|+o) [ $# -eq 0 ] || shift ;;
      --*) ;;
      -*c*) [ "$script_next" = 0 ] && script_next=1 ;;
    esac
  done
}

check_command() {
  local depth=$1 via_xargs=0 name
  shift

  while [ $# -gt 0 ]; do
    case "$1" in
      [A-Za-z_]*=*) shift; continue ;;
    esac

    name=${1##*/}
    name=${name#\\}

    case "$name" in
      '{'|'}'|'!'|if|then|elif|else|do|while|until|time|nohup|builtin)
        shift ;;
      exec)
        shift
        while [ $# -gt 0 ] && [[ $1 == -* ]]; do
          case "$1" in
            -a) shift; [ $# -eq 0 ] || shift ;;
            *) shift ;;
          esac
        done ;;
      sudo|doas)
        shift
        while [ $# -gt 0 ] && [[ $1 == -* ]]; do
          case "$1" in
            --) shift; break ;;
            -[ugCDhprtTUR]) shift; [ $# -eq 0 ] || shift ;;
            *) shift ;;
          esac
        done ;;
      env)
        shift
        while [ $# -gt 0 ]; do
          case "$1" in
            -S) shift; [ $# -gt 0 ] && check_text "$1" $((depth + 1)); return 0 ;;
            -u|-P) shift; [ $# -eq 0 ] || shift ;;
            -*|[A-Za-z_]*=*) shift ;;
            *) break ;;
          esac
        done ;;
      command)
        shift
        while [ $# -gt 0 ] && [[ $1 == -* ]]; do
          case "$1" in
            -v|-V) return 0 ;;
            *) shift ;;
          esac
        done ;;
      nice)
        shift
        while [ $# -gt 0 ] && [[ $1 == -* ]]; do
          case "$1" in
            -n) shift; [ $# -eq 0 ] || shift ;;
            *) shift ;;
          esac
        done ;;
      timeout|gtimeout)
        shift
        while [ $# -gt 0 ] && [[ $1 == -* ]]; do
          case "$1" in
            -s|-k) shift; [ $# -eq 0 ] || shift ;;
            *) shift ;;
          esac
        done
        [ $# -eq 0 ] || shift ;;
      xargs)
        via_xargs=1
        shift
        while [ $# -gt 0 ] && [[ $1 == -* ]]; do
          case "$1" in
            -[EIJLPRSadns]) shift; [ $# -eq 0 ] || shift ;;
            *) shift ;;
          esac
        done ;;
      sh|bash|zsh|dash|ksh)
        shift
        check_shell "$depth" ${1+"$@"}
        return 0 ;;
      eval)
        shift
        check_text "$*" $((depth + 1))
        return 0 ;;
      kill)
        shift
        check_kill "$via_xargs" ${1+"$@"}
        return 0 ;;
      pkill)
        shift
        check_pkill "$via_xargs" ${1+"$@"}
        return 0 ;;
      killall)
        deny "killall matches processes by name across everything you own" ;;
      *)
        return 0 ;;
    esac
  done
}

# Nested strings (`sh -c` inside `eval` inside `sh -c` ...) are followed a few
# levels deep; anything deeper is left unchecked rather than looping.
check_text() {
  local text=$1 depth=$2 line
  [ "$depth" -le 4 ] || return 0

  while IFS= read -r line; do
    local -a words=()
    line=${line//$'\036'/$'\n'}
    IFS=$'\037' read -r -d '' -a words < <(printf '%s' "$line")
    [ "${#words[@]}" -gt 0 ] || continue
    check_command "$depth" "${words[@]}"
  done < <(awk "$tokenizer" <<<"$text")
}

check_text "$command" 0

exit 0
