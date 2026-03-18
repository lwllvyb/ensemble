#!/usr/bin/env bash
# collab-launch.sh — All-in-one team launcher with clean output
# Usage: collab-launch.sh <working-dir> <task-description>
set -euo pipefail

CWD="${1:-.}"
TASK="${2:?Usage: collab-launch.sh <cwd> <task>}"
API="http://localhost:23000"
HOST_ID="${ENSEMBLE_HOST_ID:-local}"

# ─── Colors ───
G='\033[92m'; C='\033[96m'; D='\033[2m'; W='\033[97m'; BD='\033[1m'; R='\033[0m'
CHECK="${G}✓${R}"
SPIN="${C}●${R}"

echo ""
echo -e "  ${BD}${W}◈ ensemble collab${R}"
echo -e "  ${D}${TASK:0:80}${R}"
echo ""

# ─── 1. Server ───
if curl -sf "$API/api/v1/health" > /dev/null 2>&1; then
  echo -e "  ${CHECK} Server running"
else
  echo -ne "  ${SPIN} Starting server..."
  cd ~/Documents/ensemble && ./node_modules/.bin/tsx server.ts > /tmp/ensemble-server.log 2>&1 &
  for _ in $(seq 1 8); do sleep 1; curl -sf "$API/api/v1/health" > /dev/null 2>&1 && break; done
  if curl -sf "$API/api/v1/health" > /dev/null 2>&1; then
    echo -e "\r  ${CHECK} Server started       "
  else
    echo -e "\r  \033[91m✗${R} Server failed to start"; exit 1
  fi
fi

# ─── 2. Create team (use env vars to avoid quoting hell) ───
TEAM_NAME="collab-$(date +%s)"
PAYLOAD_FILE=$(mktemp)
TNAME="$TEAM_NAME" TDESC="$TASK" TCWD="$CWD" THOST="$HOST_ID" PFILE="$PAYLOAD_FILE" python3 -c "
import json, os
json.dump({
    'name': os.environ['TNAME'],
    'description': os.environ['TDESC'],
    'agents': [
        {'program': 'codex', 'role': 'lead', 'hostId': os.environ['THOST']},
        {'program': 'claude code', 'role': 'worker', 'hostId': os.environ['THOST']}
    ],
    'feedMode': 'live',
    'workingDirectory': os.environ['TCWD']
}, open(os.environ['PFILE'], 'w'))
"
RESULT=$(curl -sf -X POST "$API/api/orchestra/teams" \
  -H "Content-Type: application/json" \
  -d @"$PAYLOAD_FILE")
rm -f "$PAYLOAD_FILE"

TEAM_ID=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin)['team']['id'])")
echo "$TEAM_ID" > /tmp/collab-team-id.txt
echo -e "  ${CHECK} Team created ${D}(${TEAM_NAME})${R}"

# ─── 3. Bridge ───
nohup ~/Documents/ensemble/scripts/orchestra-bridge.sh "$TEAM_ID" "$API" > /tmp/orchestra-bridge-$TEAM_ID.log 2>&1 &
echo $! > /tmp/orchestra-bridge-$TEAM_ID.pid
echo -e "  ${CHECK} Bridge started"

# ─── 4. Monitor ───
MONITOR_CMD="cd ~/Documents/ensemble && ./node_modules/.bin/tsx cli/monitor.ts $TEAM_ID"
if [ -n "${TMUX:-}" ]; then
  tmux split-window -h -l '40%' "$MONITOR_CMD"
  echo -e "  ${CHECK} Monitor opened ${D}(right panel)${R}"
  MONITOR_MODE="split"
else
  tmux kill-session -t ensemble-monitor 2>/dev/null || true
  tmux new-session -d -s ensemble-monitor -c ~/Documents/ensemble \
    "./node_modules/.bin/tsx cli/monitor.ts $TEAM_ID"
  echo -e "  ${CHECK} Monitor ready ${D}(tmux attach -t ensemble-monitor)${R}"
  MONITOR_MODE="session"
fi

# ─── 5. Background poller ───
nohup bash -c '
TID="'"$TEAM_ID"'"; FF="/tmp/collab-feed-'"$TEAM_ID"'.txt"; S=0
while true; do
  M=$(wc -l < "/tmp/orchestra-msgs/$TID.jsonl" 2>/dev/null | tr -d " "); [ -z "$M" ] && M=0
  if [ "$M" -gt "$S" ]; then
    tail -n +"$((S+1))" "/tmp/orchestra-msgs/$TID.jsonl" >> "$FF" 2>/dev/null
    S=$M
  fi
  sleep 5
done' > /dev/null 2>&1 &
echo $! > /tmp/collab-poller-$TEAM_ID.pid

# ─── 6. Wait for agents ───
echo -ne "  ${SPIN} Agents spawning..."
for _ in $(seq 1 12); do
  sleep 1
  MC=$(wc -l < "/tmp/orchestra-msgs/$TEAM_ID.jsonl" 2>/dev/null | tr -d ' ' || echo "0")
  [ "${MC:-0}" -gt "0" ] && break
done
MC=$(wc -l < "/tmp/orchestra-msgs/$TEAM_ID.jsonl" 2>/dev/null | tr -d ' ' || echo "0")
if [ "${MC:-0}" -gt "0" ]; then
  echo -e "\r  ${CHECK} Agents communicating ${D}(${MC} messages)${R}"
else
  echo -e "\r  ${SPIN} Agents warming up...       "
fi

# ─── Output ───
echo ""
echo -e "  ${BD}${G}Team is live!${R} ${W}codex-1${R} + ${W}claude-2${R} are collaborating."
echo ""
if [ "$MONITOR_MODE" = "split" ]; then
  echo -e "  ${D}┌─ Monitor (right panel) ───────────────┐${R}"
else
  echo -e "  ${D}┌─ Monitor ─────────────────────────────┐${R}"
  echo -e "  ${D}│${R}  ${D}tmux attach -t ensemble-monitor${R}      ${D}│${R}"
fi
echo -e "  ${D}│${R}  ${W}s${R}     ${D}steer team${R}                     ${D}│${R}"
echo -e "  ${D}│${R}  ${W}1${R}/${W}2${R}   ${D}steer codex / claude${R}           ${D}│${R}"
echo -e "  ${D}│${R}  ${W}j${R}/${W}k${R}   ${D}scroll${R}                         ${D}│${R}"
echo -e "  ${D}│${R}  ${W}d${R}     ${D}disband team${R}                   ${D}│${R}"
echo -e "  ${D}│${R}  ${W}q${R}     ${D}quit monitor${R}                   ${D}│${R}"
echo -e "  ${D}└───────────────────────────────────────┘${R}"
echo ""
