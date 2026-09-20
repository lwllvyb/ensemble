#!/usr/bin/env bash
# collab-postcheck.sh — Verify agents are healthy AFTER spawning.
#
# Run 30 seconds after collab-launch to detect early failures.
# Usage: collab-postcheck.sh <team-id> [wait-seconds]
#
# Exit codes:
#   0 — agents healthy (or messages already exchanged)
#   1 — team-id not found
#   2 — agent stuck in error state (kills team, prints diagnosis)

set -uo pipefail

TEAM_ID="${1:?Usage: collab-postcheck.sh <team-id> [wait-seconds]}"
WAIT="${2:-30}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=collab-paths.sh
. "$SCRIPT_DIR/collab-paths.sh"
RD="$(collab_runtime_dir "$TEAM_ID")"

R='\033[0m'; RED='\033[91m'; GRN='\033[92m'; YEL='\033[93m'; BD='\033[1m'

if [ ! -d "$RD" ]; then
  echo -e "${RED}✗${R} Team $TEAM_ID not found at $RD" >&2
  exit 1
fi

# Alleen de sessies van dit team. Eerder stond hier een tmux-scan op de vorm van
# de sessienaam, waardoor een fout in team A alle sessies van team B meenam.
if [ -f "$RD/sessions" ]; then
  SESSIONS=$(cat "$RD/sessions")
else
  echo -e "${YEL}!${R} Geen sessieregister voor $TEAM_ID (ouder team?), postcheck slaat over"
  exit 0
fi
if [ -z "$SESSIONS" ]; then
  echo -e "${YEL}!${R} Sessieregister is leeg, niets te controleren"
  exit 0
fi

echo -e "${BD}collab postcheck (waiting ${WAIT}s for agents to settle)${R}"
sleep "$WAIT"

ERRORS_FOUND=0
ERROR_LOG=""

for s in $SESSIONS; do
  PANE_OUT=$(tmux capture-pane -t "$s" -p 2>/dev/null || true)
  if [ -z "$PANE_OUT" ]; then continue; fi

  # Check for known fatal error patterns
  if echo "$PANE_OUT" | grep -qiE "Not logged in|Please run /login"; then
    ERRORS_FOUND=$((ERRORS_FOUND + 1))
    ERROR_LOG="$ERROR_LOG\n  $s: NOT LOGGED IN — claude session expired"
  fi

  if echo "$PANE_OUT" | grep -qiE "stream disconnected before completion|failed to lookup address"; then
    ERRORS_FOUND=$((ERRORS_FOUND + 1))
    ERROR_LOG="$ERROR_LOG\n  $s: NETWORK/DNS FAILURE — codex couldn't reach API"
  fi

  if echo "$PANE_OUT" | grep -qiE "401 Unauthorized|authentication required|invalid api key"; then
    ERRORS_FOUND=$((ERRORS_FOUND + 1))
    ERROR_LOG="$ERROR_LOG\n  $s: AUTH FAILURE — invalid credentials"
  fi
done

# Also check if messages.jsonl has any traffic — if 0 messages after $WAIT secs, suspect
MSG_COUNT=0
if [ -f "$RD/messages.jsonl" ]; then
  MSG_COUNT=$(wc -l < "$RD/messages.jsonl" | tr -d ' ')
fi

if [ "$ERRORS_FOUND" -gt 0 ]; then
  echo -e "${RED}✗ Postcheck FAILED — $ERRORS_FOUND agent(s) in error state${R}" >&2
  echo -e "$ERROR_LOG" >&2
  echo -e "\n${YEL}Disbanding team $TEAM_ID...${R}" >&2
  for s in $SESSIONS; do tmux kill-session -t "$s" 2>/dev/null || true; done
  [ -f "$RD/bridge.pid" ] && kill "$(cat $RD/bridge.pid)" 2>/dev/null || true
  [ -f "$RD/poller.pid" ] && kill "$(cat $RD/poller.pid)" 2>/dev/null || true
  echo -e "${YEL}Suggested fix:${R}" >&2
  echo "  pkill -f 'tsx server.ts' && cd ~/Documents/ensemble && nohup ./node_modules/.bin/tsx server.ts > /tmp/ensemble-server.log 2>&1 &" >&2
  echo "  Then re-run /collab" >&2
  exit 2
fi

if [ "$MSG_COUNT" -eq 0 ]; then
  echo -e "${YEL}!${R} No messages after ${WAIT}s — agents may be in deep work, monitor manually"
else
  echo -e "${GRN}✓${R} $MSG_COUNT messages exchanged — agents healthy"
fi

exit 0
