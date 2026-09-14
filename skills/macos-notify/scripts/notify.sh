#!/bin/bash
# Send a macOS desktop notification via osascript.
#
# Usage: notify.sh MESSAGE [TITLE] [SUBTITLE] [SOUND]
#   MESSAGE   required. Notification body text.
#   TITLE     optional. Defaults to "Claude Code".
#   SUBTITLE  optional. Defaults to none.
#   SOUND     optional. macOS system sound name (e.g. Glass, Ping, Pop,
#             Sosumi). Defaults to "Glass". Pass "none" for a silent
#             notification.
#
# Values are escaped for safe inclusion in an AppleScript string literal.

set -euo pipefail

if [ "${1:-}" = "" ]; then
  echo "Usage: notify.sh MESSAGE [TITLE] [SUBTITLE] [SOUND]" >&2
  exit 1
fi

MESSAGE="$1"
TITLE="${2:-Claude Code}"
SUBTITLE="${3:-}"
SOUND="${4:-Glass}"

escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

ESC_MESSAGE=$(escape "$MESSAGE")
ESC_TITLE=$(escape "$TITLE")

SCRIPT="display notification \"$ESC_MESSAGE\" with title \"$ESC_TITLE\""

if [ -n "$SUBTITLE" ]; then
  ESC_SUBTITLE=$(escape "$SUBTITLE")
  SCRIPT="$SCRIPT subtitle \"$ESC_SUBTITLE\""
fi

if [ "$SOUND" != "none" ]; then
  ESC_SOUND=$(escape "$SOUND")
  SCRIPT="$SCRIPT sound name \"$ESC_SOUND\""
fi

osascript -e "$SCRIPT"
