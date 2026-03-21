#!/usr/bin/env bash
# Self-contained demo script — shows the full collab flow
# Run this inside asciinema or VHS for recording
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
G='\033[92m'; C='\033[96m'; D='\033[2m'; W='\033[97m'; BD='\033[1m'; R='\033[0m'; Y='\033[93m'

clear

# --- Part 1: Show the vulnerable code ---
echo -e "${BD}${W}  Let's look at this API...${R}"
echo ""
sleep 1

echo -e "${D}  demo/server.js:${R}"
echo ""
# Show key vulnerable lines with syntax highlighting feel
while IFS= read -r line; do
  echo -e "  ${W}$line${R}"
done < <(head -25 "$SCRIPT_DIR/server.js")
echo -e "  ${D}...${R}"
echo ""
sleep 3

echo -e "${BD}${Y}  Spotted the issues? Let's see what two AI agents find together.${R}"
echo ""
sleep 2

# --- Part 2: Launch the collab ---
echo -e "${BD}${W}  Launching Codex + Claude team...${R}"
echo ""
sleep 1

"$REPO_DIR/scripts/collab-launch.sh" "$SCRIPT_DIR" "Review all files in this directory for security vulnerabilities. List every issue you find with file, line number, and severity."

TEAM_ID=$(cat /tmp/collab-team-id.txt)
echo ""

# --- Part 3: Poll and show conversation ---
POLLS=0
MAX_POLLS=20

while [ "$POLLS" -lt "$MAX_POLLS" ]; do
  POLLS=$((POLLS + 1))

  if [ "$POLLS" -le 2 ]; then
    SLEEP_TIME=8
  else
    SLEEP_TIME=12
  fi

  OUTPUT=$("$REPO_DIR/scripts/collab-poll.sh" "$TEAM_ID" --sleep "$SLEEP_TIME" 2>/dev/null || true)

  if [ -z "$OUTPUT" ]; then
    continue
  fi

  # Check status
  if echo "$OUTPUT" | grep -q "STATUS:DONE"; then
    # Print final messages
    echo "$OUTPUT" | grep -v "^---STATUS:" | while IFS=$'\t' read -r sender content; do
      [ -z "$sender" ] && continue
      echo -e "  ${BD}${C}${sender}${R}: ${content}"
    done
    echo ""
    echo -e "  ${BD}${G}Team finished!${R}"
    echo ""
    # Show summary
    SUMMARY=$(echo "$OUTPUT" | sed -n '/^---STATUS:DONE/,$ { /^---STATUS:DONE/d; p; }')
    if [ -n "$SUMMARY" ]; then
      echo -e "${BD}${W}  Summary:${R}"
      echo "$SUMMARY" | head -20 | while IFS= read -r line; do
        echo -e "  ${W}$line${R}"
      done
    fi
    break
  fi

  if echo "$OUTPUT" | grep -q "STATUS:ACTIVE"; then
    echo "$OUTPUT" | grep -v "^---STATUS:" | while IFS=$'\t' read -r sender content; do
      [ -z "$sender" ] && continue
      echo -e "  ${BD}${C}${sender}${R}: ${content}"
    done
    echo ""
  fi

  if echo "$OUTPUT" | grep -q "STATUS:QUIET"; then
    echo -e "  ${D}Agents thinking...${R}"
  fi
done

# Cleanup
echo ""
echo -e "  ${D}Cleaning up...${R}"
RD="/tmp/ensemble/$TEAM_ID"
kill "$(cat "$RD/poller.pid" 2>/dev/null)" 2>/dev/null || true
kill "$(cat "$RD/bridge.pid" 2>/dev/null)" 2>/dev/null || true
tmux kill-session -t "ensemble-$TEAM_ID" 2>/dev/null || true
echo -e "  ${G}✓${R} Done"
echo ""
