#!/usr/bin/env bash
# Manual recording guide for the ensemble demo
# This sets up the perfect tmux layout for screen recording
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo ""
echo "  ◈ Ensemble Demo Recording Setup"
echo ""
echo "  This script sets up a tmux session optimized for recording."
echo "  Use a screen recorder (QuickTime, OBS, or Kap) to capture the window."
echo ""

# Kill any existing demo session
tmux kill-session -t demo 2>/dev/null || true

# Create session with a nice size
tmux new-session -d -s demo -x 120 -y 35 -c "$REPO_DIR"

# Make sure ensemble server is running
if ! curl -sf http://localhost:23000/api/v1/health > /dev/null 2>&1; then
  tmux send-keys -t demo "npm run dev &" Enter
  sleep 3
fi

echo "  ✓ tmux session 'demo' created"
echo ""
echo "  Next steps:"
echo "  1. Open your screen recorder (Cmd+Shift+5 on macOS for QuickTime)"
echo "  2. Run: tmux attach -t demo"
echo "  3. In the session, type:"
echo '     claude -p "/collab Review the demo/ directory for security vulnerabilities"'
echo "  4. Wait for agents to communicate (~60s)"
echo "  5. Stop recording when you see the summary"
echo ""
echo "  Tip: Set terminal font to 14pt+ for readability"
echo "  Tip: Use a dark theme for best contrast"
echo ""
echo "  Convert to GIF with ffmpeg:"
echo "  ffmpeg -i recording.mov -vf 'fps=10,scale=800:-1' -loop 0 demo.gif"
echo ""
