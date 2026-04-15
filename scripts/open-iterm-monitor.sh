#!/usr/bin/env bash
# open-iterm-monitor.sh — Open the collab TUI monitor in a native iTerm2 split pane.
# Usage: open-iterm-monitor.sh <repo-dir> <team-id> [split|tab|window]
set -euo pipefail

REPO_DIR="${1:?Usage: open-iterm-monitor.sh <repo-dir> <team-id> [split|tab|window]}"
TEAM_ID="${2:?team-id required}"
MODE="${3:-split}"

LOG=/tmp/collab-iterm-last.log
echo "=== $(date '+%F %T') open-iterm-monitor ($MODE) team=$TEAM_ID ===" > "$LOG"

if [ "$(uname)" != "Darwin" ]; then
  echo "open-iterm-monitor: not macOS" >&2
  exit 2
fi

if ! osascript -e 'tell application "System Events" to (name of processes) contains "iTerm2"' | grep -q true; then
  echo "open-iterm-monitor: iTerm2 is not running" >&2
  exit 3
fi

REPO_DIR_Q=$(printf '%q' "$REPO_DIR")
CMD="cd $REPO_DIR_Q && ./node_modules/.bin/tsx cli/monitor.ts ${TEAM_ID}"

# iTerm2 sets ITERM_SESSION_ID like "w0t1p0:UUID" in every shell. Strip the
# prefix so we can match session ids via AppleScript.
SOURCE_SESSION_ID=""
if [ -n "${ITERM_SESSION_ID:-}" ]; then
  SOURCE_SESSION_ID="${ITERM_SESSION_ID##*:}"
fi
echo "source_session=$SOURCE_SESSION_ID" >> "$LOG"

case "$MODE" in
  split)
    if RESULT=$(osascript 2>>"$LOG" <<OSA
tell application "iTerm2"
  activate
  delay 0.15
  if (count of windows) is 0 then
    create window with default profile
  end if
  set winCount to count of windows
  -- Prefer splitting the session the user actually invoked collab from
  -- (via ITERM_SESSION_ID). Fall back to the current session of the
  -- frontmost window if that session cannot be found.
  set sourceId to "${SOURCE_SESSION_ID}"
  set foundSession to missing value
  set foundWindow to missing value
  if sourceId is not "" then
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if (id of s as string) is sourceId then
            set foundSession to s
            set foundWindow to w
            exit repeat
          end if
        end repeat
        if foundSession is not missing value then exit repeat
      end repeat
      if foundSession is not missing value then exit repeat
    end repeat
  end if
  if foundSession is missing value then
    set theWindow to first window
    set foundWindow to theWindow
    tell theWindow
      set foundSession to current session
    end tell
  end if
  set winId to id of foundWindow
  set tabCount to count of tabs of foundWindow
  tell foundSession
    set newSession to (split vertically with default profile)
    set newId to id of newSession
    tell newSession
      write text "${CMD}"
    end tell
  end tell
  return "windows=" & winCount & " window_id=" & winId & " tabs_in_window=" & tabCount & " new_session_id=" & newId
end tell
OSA
    ); then
      echo "rc=0 result=$RESULT" >> "$LOG"
      echo "$RESULT"
    else
      RC=$?
      echo "rc=$RC — zie $LOG" >&2
      exit 5
    fi
    ;;
  tab)
    osascript 2>>"$LOG" <<OSA
tell application "iTerm2"
  activate
  delay 0.1
  if (count of windows) is 0 then
    create window with default profile
  end if
  tell first window
    set newTab to (create tab with default profile)
    tell current session of newTab
      write text "${CMD}"
    end tell
  end tell
end tell
OSA
    ;;
  window)
    osascript 2>>"$LOG" <<OSA
tell application "iTerm2"
  activate
  delay 0.1
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
