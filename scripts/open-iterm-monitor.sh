#!/usr/bin/env bash
# open-iterm-monitor.sh — Open the collab TUI monitor in a native iTerm2 split pane.
# Usage: open-iterm-monitor.sh <repo-dir> <team-id> [mode]
#   mode: split (default) | tab | window
#
# Requires: macOS + iTerm2. Returns non-zero if iTerm2 is not available.
set -euo pipefail

REPO_DIR="${1:?Usage: open-iterm-monitor.sh <repo-dir> <team-id> [split|tab|window]}"
TEAM_ID="${2:?team-id required}"
MODE="${3:-split}"

if [ "$(uname)" != "Darwin" ]; then
  echo "open-iterm-monitor: not macOS" >&2
  exit 2
fi

if ! osascript -e 'tell application "System Events" to (name of processes) contains "iTerm2"' | grep -q true; then
  echo "open-iterm-monitor: iTerm2 is not running" >&2
  exit 3
fi

# Command that will run inside the new pane. Quote-safe: TEAM_ID is alphanumeric/hyphen.
# Use printf %q instead of ${var@Q} — macOS /bin/bash is 3.2, @Q needs 4.4+.
REPO_DIR_Q=$(printf '%q' "$REPO_DIR")
CMD="cd $REPO_DIR_Q && ./node_modules/.bin/tsx cli/monitor.ts ${TEAM_ID}"

case "$MODE" in
  split)
    osascript <<OSA
tell application "iTerm2"
  if (count of windows) is 0 then
    create window with default profile
  end if
  tell current window
    tell current session
      set newSession to (split vertically with default profile)
      tell newSession
        write text "${CMD}"
      end tell
    end tell
  end tell
end tell
OSA
    ;;
  tab)
    osascript <<OSA
tell application "iTerm2"
  if (count of windows) is 0 then
    create window with default profile
  end if
  tell current window
    set newTab to (create tab with default profile)
    tell current session of newTab
      write text "${CMD}"
    end tell
  end tell
end tell
OSA
    ;;
  window)
    osascript <<OSA
tell application "iTerm2"
  set newWindow to (create window with default profile)
  tell current session of newWindow
    write text "${CMD}"
  end tell
end tell
OSA
    ;;
  *)
    echo "open-iterm-monitor: unknown mode '$MODE' (expected split|tab|window)" >&2
    exit 4
    ;;
esac
