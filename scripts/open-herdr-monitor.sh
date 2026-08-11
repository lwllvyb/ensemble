#!/usr/bin/env bash
# open-herdr-monitor.sh — Open the collab TUI monitor in a herdr pane.
# Usage: open-herdr-monitor.sh <repo-dir> <team-id> [split|tab]
#
# herdr (https://github.com/herdrdev/herdr) is a terminal workspace manager that
# owns the terminal itself: it draws its own panes, tabs and sidebar inside a
# single host terminal session. Splitting the HOST terminal (iTerm2 AppleScript)
# puts the monitor outside the layout the user is looking at, so inside herdr we
# have to ask herdr for the split instead.
#
# Detection note: herdr passes TERM_PROGRAM through unchanged, so a shell inside
# herdr still reports TERM_PROGRAM=iTerm.app. HERDR_ENV is the reliable signal.
set -euo pipefail

REPO_DIR="${1:?Usage: open-herdr-monitor.sh <repo-dir> <team-id> [split|tab]}"
TEAM_ID="${2:?team-id required}"
MODE="${3:-split}"

LOG=/tmp/collab-herdr-last.log
echo "=== $(date '+%F %T') open-herdr-monitor ($MODE) team=$TEAM_ID ===" > "$LOG"

if [ "${HERDR_ENV:-}" != "1" ]; then
  echo "open-herdr-monitor: not running inside herdr (HERDR_ENV unset)" >&2
  exit 2
fi

if ! command -v herdr > /dev/null 2>&1; then
  echo "open-herdr-monitor: herdr binary not in PATH" >&2
  exit 3
fi

echo "source_pane=${HERDR_PANE_ID:-unknown} tab=${HERDR_TAB_ID:-unknown} workspace=${HERDR_WORKSPACE_ID:-unknown}" >> "$LOG"

# ─── Create the pane ───
case "$MODE" in
  split)
    if [ -n "${HERDR_PANE_ID:-}" ]; then
      CREATE_JSON=$(herdr pane split --pane "$HERDR_PANE_ID" --direction right --cwd "$REPO_DIR" 2>>"$LOG")
    else
      CREATE_JSON=$(herdr pane split --current --direction right --cwd "$REPO_DIR" 2>>"$LOG")
    fi
    ;;
  tab)
    CREATE_JSON=$(herdr tab create --cwd "$REPO_DIR" 2>>"$LOG")
    ;;
  *)
    echo "open-herdr-monitor: unknown mode '$MODE' (expected split|tab)" >&2
    exit 4
    ;;
esac

printf '%s\n' "$CREATE_JSON" >> "$LOG"

# The socket API answers with a JSON envelope; the pane id lives under
# .result.pane.pane_id for a split and .result.tab (first pane) for a tab.
NEW_PANE=$(printf '%s' "$CREATE_JSON" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(1)
result = data.get('result', {})
pane = result.get('pane') or {}
pane_id = pane.get('pane_id')
if not pane_id:
    tab = result.get('tab') or {}
    panes = tab.get('panes') or []
    if panes:
        pane_id = panes[0].get('pane_id')
if not pane_id:
    sys.exit(1)
print(pane_id)
" 2>>"$LOG") || {
  echo "open-herdr-monitor: could not read new pane id from herdr response" >&2
  exit 5
}

echo "new_pane=$NEW_PANE" >> "$LOG"

# ─── Start the monitor in it ───
# herdr runs the command directly, so there is no shell prompt to race against
# and none of the zsh autocorrect trouble the iTerm path has to work around.
herdr pane run "$NEW_PANE" \
  bash -lc "cd $(printf '%q' "$REPO_DIR") && exec ./node_modules/.bin/tsx cli/monitor.ts $(printf '%q' "$TEAM_ID")" \
  >> "$LOG" 2>&1

herdr pane rename "$NEW_PANE" "collab monitor" >> "$LOG" 2>&1 || true

echo "rc=0 pane=$NEW_PANE" >> "$LOG"
echo "new_pane_id=$NEW_PANE"
