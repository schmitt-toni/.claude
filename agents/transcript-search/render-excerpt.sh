#!/usr/bin/env bash
#
# Renders a line range of a Claude Code transcript (JSONL, one event per line)
# as readable text and writes it to a new file:
#
#   render-excerpt.sh <transcript.jsonl> <first-line> <last-line> <output-file> [cut]
#
# Line numbers are 1-based and inclusive, as `rg -n` prints them. Every event
# starts with a header naming its source line, so a reader can ask for the
# full event or a wider range later.
#
# Typed prompts, assistant text and thinking are copied whole. Tool results,
# tool-call inputs and system events are cut after `cut` characters (default
# 2000): a single tool result can run to megabytes, and the agent judging the
# excerpt reads the whole file. Attachments and bookkeeping events (mode
# switches, queue operations, file-history snapshots, raw API requests) are cut
# after 300 characters. Attachments are mostly hook_success records, one per
# hook run; cut at 2000 they made up a third of a typical excerpt. Each cut
# names how many characters were dropped and the source line holding them, so
# a cut event can be extracted again in full.
#
# The output file must not exist yet, so a rerun cannot overwrite an excerpt
# someone is already reading. On success the script prints one summary line
# instead of the excerpt, so the caller does not have to read it back.

set -euo pipefail

if [ "$#" -lt 4 ] || [ "$#" -gt 5 ]; then
  echo "usage: render-excerpt.sh <transcript.jsonl> <first-line> <last-line> <output-file> [cut]" >&2
  exit 2
fi

transcript=$1
first=$2
last=$3
output=$4
cut=${5:-2000}

[ -f "$transcript" ] || { echo "render-excerpt: no such transcript: $transcript" >&2; exit 2; }
[[ "$first" =~ ^[1-9][0-9]*$ ]] || { echo "render-excerpt: first line must be a positive integer" >&2; exit 2; }
[[ "$last" =~ ^[1-9][0-9]*$ ]] || { echo "render-excerpt: last line must be a positive integer" >&2; exit 2; }
[ "$first" -le "$last" ] || { echo "render-excerpt: first line is after last line" >&2; exit 2; }
[[ "$cut" =~ ^[1-9][0-9]*$ ]] || { echo "render-excerpt: cut must be a positive integer" >&2; exit 2; }
[ ! -e "$output" ] || { echo "render-excerpt: output already exists: $output" >&2; exit 2; }
[ -d "$(dirname "$output")" ] || { echo "render-excerpt: output directory does not exist: $(dirname "$output")" >&2; exit 2; }

# -R reads each line as a raw string, so a line that is not valid JSON, such as
# the half-written last line of a running session, is shown instead of
# aborting the whole excerpt.
sed -n "${first},${last}p" "$transcript" | jq -R -r --argjson first "$first" --argjson cut "$cut" '
  def clip($line; $limit):
    if length > $limit
    then .[:$limit] + "\n[cut: \(length - $limit) more characters at source line \($line)]"
    else . end;
  def clip($line): clip($line; $cut);
  def flatten:
    if type == "string" then .
    elif type == "array" then map(if type == "object" then (.text // tojson) else tostring end) | join("\n")
    elif . == null then ""
    else tojson end;
  def parts: if type == "string" then [{type: "text", text: .}] else (. // []) end;

  ($first + input_line_number - 1) as $line
  | (fromjson? // {type: "unparseable", raw: .}) as $e
  | "── line \($line) · \($e.timestamp // "-") · \($e.type // "?")"
    + (if $e.subtype then " (\($e.subtype))" else "" end)
    + "\n"
    + (if $e.type == "user" then
         ($e.message.content | parts | map(
           if .type == "text" then "USER: " + .text
           elif .type == "tool_result" then "TOOL RESULT:\n" + ((.content | flatten) | clip($line))
           else "[\(.type)]" end) | join("\n"))
       elif $e.type == "assistant" then
         ($e.message.content | parts | map(
           if .type == "text" then "ASSISTANT: " + .text
           elif .type == "thinking" then "THINKING: " + (.thinking // "")
           elif .type == "tool_use" then "TOOL CALL \(.name): " + ((.input | tojson) | clip($line))
           else "[\(.type)]" end) | join("\n"))
       elif $e.type == "ai-title" then "TITLE: " + ($e.aiTitle // "")
       elif $e.type == "unparseable" then "UNPARSEABLE LINE: " + ($e.raw | clip($line))
       elif $e.type == "system" then ($e | tojson | clip($line))
       else ($e | tojson | clip($line; 300)) end)
    + "\n"
' > "$output"

# Every source line becomes one event, so the count also tells where a range
# that ran past the end of the transcript actually stopped.
events=$(grep -c '^── line ' "$output" || true)
if [ "$events" -eq 0 ]; then
  echo "wrote 0 events to $output: the transcript has fewer than $first lines"
  exit 0
fi

# Earliest and latest rather than first and last: after a compaction the
# transcript replays earlier messages with their original timestamps, so file
# order and time order disagree. ISO 8601 UTC timestamps sort as text.
times=$(grep '^── line ' "$output" | awk -F ' · ' '$2 != "-" { print $2 }' | sort)
span=""
if [ -n "$times" ]; then
  span=", timestamps $(head -n 1 <<<"$times") to $(tail -n 1 <<<"$times")"
fi

# Read from the events, because the project directory name cannot be decoded
# back: `/` and `-` both become `-`, so -Users-toni-src-agent-git fits
# /Users/toni/src/agent-git and /Users/toni/src/agent/git alike. A session that
# changed directory lists every one it used.
cwds=$(sed -n "${first},${last}p" "$transcript" | jq -R -r 'fromjson? | .cwd // empty' | sort -u | paste -sd ',' - | sed 's/,/, /g')
where=""
if [ -n "$cwds" ]; then
  where=", cwd $cwds"
fi
echo "wrote $events events (source lines $first-$((first + events - 1))$where$span, $(wc -c < "$output" | tr -d ' ') bytes) to $output"
