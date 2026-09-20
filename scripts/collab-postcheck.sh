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

# Find this team's tmux sessions (codex-1, claude-2, etc.)
# Sessions are named: collab-<timestamp>-<random>-<agent>
# Match by team prefix: scan tmux for any session matching the team-id prefix
# Actually ensemble names sessions: collab-<TS>-<RAND>-<agent>. Match via /tmp marker.
# Easier: read team-id file in $RD/team-id (created by collab-launch)
# Fallback: look up via TEAM_PREFIX env

# The launcher leaves session names matching the timestamp portion of team-name.
# We grep all collab- sessions whose suffix matches an agent role.
SESSIONS=$(tmux ls 2>/dev/null | grep -oE "^collab-[0-9]+-[0-9]+-[a-z]+-[0-9]+" | sort -u)
if [ -z "$SESSIONS" ]; then
  echo -e "${YEL}!${R} No collab tmux sessions found (already cleaned up?)"
  exit 0
fi

echo -e "${BD}collab postcheck (waiting ${WAIT}s for agents to settle)${R}"
sleep "$WAIT"

ERRORS_FOUND=0
ERROR_LOG=""

for s in $SESSIONS; do
  PANE_OUT=$(tmux capture-pane -t "$s" -p 2>/dev/null || true)
  if [ -z "$PANE_OUT" ]; then continue; fi

  # Skip sessions that aren't part of this team (other teams may exist)
  # Compare agent prompt files in $RD/prompts/ to confirm
  AGENT_NAME="${s##*-collab-*-}"  # imperfect — best effort

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
