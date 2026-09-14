---
name: macos-notify
description: Send a native macOS desktop notification (via osascript) to alert the user. Use ONLY when the user explicitly asks to be notified/alerted/pinged/pinged-when-done — e.g. "notify me when this is done", "let me know when the build finishes", "ping me once tests pass", "send me a desktop notification when finished". This is an agent-only action triggered by Claude itself at the right moment in the conversation — never invoke it proactively, speculatively, or for tasks the user didn't ask to be notified about.
---

# macOS Desktop Notification

Fires a native macOS notification banner via `osascript`. This skill exists so
Claude can alert the user (sound + banner) when something they asked to be
notified about actually happens — most commonly "let me know when you're
done."

## When to use

Only when the user has explicitly asked for a notification/alert/ping for
**this** task or session, for example:

- "Notify me when this finishes."
- "Let me know when the build/tests/deploy is done — I'll be afk."
- "Ping me once you're done researching."
- "Send a desktop notification when this completes."

If the user asked earlier in the conversation ("let me know when it's done")
and you're now finishing that task, that counts as an explicit request — fire
the notification at completion without re-asking.

## When NOT to use

- Never invoke this speculatively "just in case" or as a default habit at the
  end of every task — only when notification was actually requested.
- Don't fire it for intermediate progress updates unless the user asked for
  per-step notifications; default to one notification when the requested work
  is actually done (or has failed, if that's what matters to the user).
- Not a general-purpose alerting/logging tool for arbitrary events the user
  didn't ask about.

## How to invoke

Call the bundled script with Bash:

```bash
/Users/toni/.claude/skills/macos-notify/scripts/notify.sh "MESSAGE" "TITLE" "SUBTITLE" "SOUND"
```

- `MESSAGE` (required) — the notification body. Keep it short and specific,
  e.g. `"Build finished: 0 errors"` or `"Tests passed (42/42)"`.
- `TITLE` (optional, default `"Claude Code"`) — set to something meaningful
  when it helps, e.g. the project or task name.
- `SUBTITLE` (optional) — pass `""` to omit.
- `SOUND` (optional, default `"Glass"`) — a macOS system sound name (`Glass`,
  `Ping`, `Pop`, `Sosumi`, `Basso`, …). Pass `"none"` for a silent banner.

The script escapes quotes/backslashes for you — pass the raw message text,
don't pre-escape it.

Example:

```bash
/Users/toni/.claude/skills/macos-notify/scripts/notify.sh "The migration finished with no errors." "Claude Code" "db-migrate" "Glass"
```

Minimal call (title/subtitle/sound all default):

```bash
/Users/toni/.claude/skills/macos-notify/scripts/notify.sh "Work's done."
```

## Troubleshooting

If the command exits `0` but no banner appears, notification permissions are
usually the cause: macOS ties notification permission to the app that ran
`osascript` (Terminal, iTerm2, etc.), not to Claude Code itself. Tell the user
to check **System Settings → Notifications → [their terminal app]** and
ensure notifications are allowed, and that Focus/Do Not Disturb isn't
suppressing banners.
