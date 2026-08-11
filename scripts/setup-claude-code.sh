#!/usr/bin/env bash
# setup-claude-code.sh — Install ensemble as /collab skill in Claude Code
# Usage: ./scripts/setup-claude-code.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILL_DIR="$HOME/.claude/skills/collab"
SETTINGS_FILE="$HOME/.claude/settings.json"

# Colors
G='\033[92m'; W='\033[97m'; D='\033[2m'; BD='\033[1m'; R='\033[0m'
CHECK="${G}✓${R}"
WARN='\033[93m⚠${R}'

echo ""
echo -e "  ${BD}${W}◈ ensemble — Claude Code setup${R}"
echo -e "  ${D}Installing /collab skill${R}"
echo ""

# ─── 1. Install skill ───
mkdir -p "$SKILL_DIR"
if [ -f "$REPO_DIR/skill/SKILL.md" ]; then
  sed "s|__ENSEMBLE_DIR__|${REPO_DIR}|g" "$REPO_DIR/skill/SKILL.md" > "$SKILL_DIR/SKILL.md"
  # Guard against a hand-copied skill: an unresolved placeholder means every script
  # path in the installed skill is broken.
  if grep -q '__ENSEMBLE_DIR__' "$SKILL_DIR/SKILL.md"; then
    echo -e "  \033[91m✗${R} Placeholder __ENSEMBLE_DIR__ survived substitution, aborting"
    exit 1
  fi
  echo -e "  ${CHECK} Skill installed → ${D}${SKILL_DIR}/SKILL.md${R}"
else
  echo -e "  \033[91m✗${R} skill/SKILL.md not found in repo"
  exit 1
fi

# ─── 2. Add permissions ───
# Must cover every script the skill tells Claude to run. A missing entry turns a
# routine troubleshooting step into a permission prompt mid-collab.
SCRIPTS=(
  "Bash(${REPO_DIR}/scripts/collab-launch.sh:*)"
  "Bash(${REPO_DIR}/scripts/collab-poll.sh:*)"
  "Bash(${REPO_DIR}/scripts/collab-status.sh:*)"
  "Bash(${REPO_DIR}/scripts/collab-cleanup.sh:*)"
  "Bash(${REPO_DIR}/scripts/collab-replay.sh:*)"
  "Bash(${REPO_DIR}/scripts/collab-livefeed.sh:*)"
  "Bash(${REPO_DIR}/scripts/collab-preflight.sh:*)"
  "Bash(${REPO_DIR}/scripts/collab-postcheck.sh:*)"
  "Bash(${REPO_DIR}/scripts/collab-rescue.sh:*)"
  "Bash(${REPO_DIR}/scripts/ensemble-bridge.sh:*)"
)

# Merge the permissions in one pass. Path and permission strings go in as argv
# inside a quoted heredoc: building the Python source by interpolation broke the
# installer outright for anyone whose repo path contains a quote.
ADDED=$(python3 - "$SETTINGS_FILE" "${SCRIPTS[@]}" <<'PY'
import json, sys

settings_path = sys.argv[1]
new_perms = sys.argv[2:]

try:
    with open(settings_path) as f:
        settings = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    settings = {}

allow = settings.setdefault('permissions', {}).setdefault('allow', [])
added = 0
for p in new_perms:
    if p not in allow:
        allow.append(p)
        added += 1

with open(settings_path, 'w') as f:
    json.dump(settings, f, indent=2)
    f.write('\n')

print(added)
PY
)

if [ "${ADDED:-0}" -gt 0 ] 2>/dev/null; then
  echo -e "  ${CHECK} Permissions added (${ADDED}) → ${D}${SETTINGS_FILE}${R}"
else
  echo -e "  ${CHECK} Permissions already configured"
fi

# ─── 3. Check prerequisites ───
echo ""
MISSING=0

if command -v node &>/dev/null; then
  echo -e "  ${CHECK} Node.js $(node --version)"
else
  echo -e "  ${WARN} Node.js not found"
  MISSING=$((MISSING + 1))
fi

if command -v tmux &>/dev/null; then
  echo -e "  ${CHECK} tmux $(tmux -V | cut -d' ' -f2)"
else
  echo -e "  ${WARN} tmux not found — install with: brew install tmux"
  MISSING=$((MISSING + 1))
fi

if command -v python3 &>/dev/null; then
  echo -e "  ${CHECK} Python $(python3 --version | cut -d' ' -f2)"
else
  echo -e "  ${WARN} Python 3 not found"
  MISSING=$((MISSING + 1))
fi

HAS_AGENT=0
for cmd in claude codex aider; do
  if command -v "$cmd" &>/dev/null; then
    echo -e "  ${CHECK} ${cmd} CLI found"
    HAS_AGENT=1
  fi
done
if [ "$HAS_AGENT" -eq 0 ]; then
  echo -e "  ${WARN} No agent CLI found (install claude, codex, or aider)"
  MISSING=$((MISSING + 1))
fi

# ─── 4. Check npm install ───
if [ -d "$REPO_DIR/node_modules" ]; then
  echo -e "  ${CHECK} npm dependencies installed"
else
  echo -e "  ${WARN} Run 'npm install' in ${REPO_DIR}"
  MISSING=$((MISSING + 1))
fi

# ─── Done ───
echo ""
if [ "$MISSING" -eq 0 ]; then
  echo -e "  ${BD}${G}Setup complete!${R}"
  echo ""
  echo -e "  In any Claude Code session, type:"
  echo ""
  echo -e "    ${BD}/collab \"your task description\"${R}"
  echo ""
  echo -e "  ${D}Example: /collab \"Review the auth module for security issues\"${R}"
else
  echo -e "  ${BD}${G}Skill installed${R}, but $MISSING prerequisite(s) missing."
  echo -e "  ${D}Fix the warnings above, then use /collab in Claude Code.${R}"
fi
echo ""
