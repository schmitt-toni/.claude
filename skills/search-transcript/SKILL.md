---
name: search-transcript
description: Search Claude Code session transcripts and the prompt history for what was asked, said, decided, run or changed in a past or the current session. Runs in the transcript-search subagent.
context: fork
agent: transcript-search
background: false
---

Find the following in the Claude Code session transcripts and prompt history:

$ARGUMENTS

If the line above is empty, search nothing and report back that the search query is missing.
