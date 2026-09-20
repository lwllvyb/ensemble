#!/usr/bin/env bash
# collab-poller.sh — Copies new lines from messages.jsonl into feed.txt for one team.
# Usage: collab-poller.sh <team-id> [api-url]
#
# Started in the background by collab-launch.sh. Stops on its own when the team
# is finished or gone, so it can never outlive its team:
#   * the .finished marker appears (written by disbandTeam),
#   * the runtime directory is removed (collab-cleanup.sh),
#   * the service answers 404 or reports the team as disbanded,
#   * the service stays unreachable for COLLAB_POLLER_MAX_API_FAILURES checks.
#
# Env: COLLAB_POLL_SECS (default 5), COLLAB_POLLER_CHECK_EVERY (default 12, so
# the service is asked once a minute), COLLAB_POLLER_MAX_API_FAILURES (default 10).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./collab-paths.sh
source "$SCRIPT_DIR/collab-paths.sh"

TEAM_ID="${1:?Usage: collab-poller.sh <team-id> [api-url]}"
API="${2:-${ENSEMBLE_URL:-http://localhost:23000}}"
RUNTIME_DIR="$(collab_runtime_dir "$TEAM_ID")"
MESSAGES_FILE="$(collab_messages_file "$TEAM_ID")"
FEED_FILE="$(collab_feed_file "$TEAM_ID")"
PID_FILE="$(collab_poller_pid "$TEAM_ID")"
FINISHED_FILE="$(collab_finished_marker "$TEAM_ID")"

POLL_SECS="${COLLAB_POLL_SECS:-5}"
CHECK_EVERY="${COLLAB_POLLER_CHECK_EVERY:-12}"
MAX_API_FAILURES="${COLLAB_POLLER_MAX_API_FAILURES:-10}"

[ -d "$RUNTIME_DIR" ] || exit 0
printf '%s\n' "$$" > "$PID_FILE"
# INT/TERM zetten alleen een vlag: de hoofdlus checkt die na elke sleep en
# sluit dan zelf af. De vorige "trap ... INT TERM" deed niets aan het stoppen
# zelf: bash voert de trap-actie uit en gaat gewoon door met de lus, want
# alleen een expliciete exit beëindigt het proces echt.
STOPPEN=0
trap 'rm -f "$PID_FILE"' EXIT
trap 'STOPPEN=1' INT TERM

flush() {
  local m
  m=$(wc -l < "$MESSAGES_FILE" 2>/dev/null | tr -d ' '); [ -z "$m" ] && m=0
  if [ "$m" -gt "$SEEN" ]; then
    tail -n +"$((SEEN + 1))" "$MESSAGES_FILE" >> "$FEED_FILE" 2>/dev/null
    SEEN=$m
  fi
}

# Prints "gone" when the service says the team is over, "down" when the service
# cannot be reached, and "alive" otherwise.
team_state() {
  local code body
  body=$(curl -s -o - -w '\n%{http_code}' --max-time 5 "$API/api/ensemble/teams/$TEAM_ID" 2>/dev/null) || { echo down; return; }
  code="${body##*$'\n'}"
  case "$code" in
    404) echo gone ;;
    200) if printf '%s' "$body" | grep -q '"status":[[:space:]]*"disbanded"'; then echo gone; else echo alive; fi ;;
    *) echo down ;;
  esac
}

SEEN=0
TICK=0
API_FAILURES=0
while true; do
  flush
  [ -d "$RUNTIME_DIR" ] || exit 0
  [ -f "$FINISHED_FILE" ] && exit 0

  TICK=$((TICK + 1))
  if [ "$TICK" -ge "$CHECK_EVERY" ]; then
    TICK=0
    case "$(team_state)" in
      gone) exit 0 ;;
      down)
        API_FAILURES=$((API_FAILURES + 1))
        [ "$API_FAILURES" -ge "$MAX_API_FAILURES" ] && exit 0
        ;;
      alive) API_FAILURES=0 ;;
    esac
  fi
  # Backgrounden en op de eigen pid wachten: bash onderbreekt de wait-builtin
  # direct zodra het signaal binnenkomt, in plaats van te wachten tot de sleep
  # zelf afloopt.
  sleep "$POLL_SECS" &
  SLEEP_PID=$!
  wait "$SLEEP_PID" 2>/dev/null
  if [ "$STOPPEN" -eq 1 ]; then
    kill "$SLEEP_PID" 2>/dev/null || true
    echo "[$(basename "$0")] gestopt op signaal" >&2
    exit 0
  fi
done
