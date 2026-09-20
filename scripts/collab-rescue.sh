#!/usr/bin/env bash
# collab-rescue.sh — handmatig prompts injecteren als ensemble-service het oversloeg
#
# Symptoom: team draait, agents zichtbaar in tmux/iTerm, maar messages.jsonl is leeg
# en /tmp/ensemble-server.log toont "did not become ready within 60s".
#
# Oorzaak: ensemble-service wacht op een readiness-pattern voor injectie. Codex CLI's
# patroon matcht soms niet, dus prompts blijven in prompts/<agent>.txt liggen zonder
# ooit naar de agent te gaan.
#
# Deze rescue paste de prompts handmatig via tmux load-buffer / paste-buffer / send-keys
# en submit met een extra Enter voor Claude (die "[Pasted text" toont).
#
# Gebruik:
#   collab-rescue.sh <TEAM_ID>
#   collab-rescue.sh         # gebruikt /tmp/collab-team-id.txt
#
# Verifieer dat het werkt:
#   wc -l /tmp/ensemble/<TEAM_ID>/messages.jsonl   # moet >0 worden binnen 30s

set -euo pipefail

TEAM_ID="${1:-$(cat /tmp/collab-team-id.txt 2>/dev/null || true)}"

if [ -z "$TEAM_ID" ]; then
  echo "FOUT: geen team-id opgegeven en /tmp/collab-team-id.txt niet gevonden" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=collab-paths.sh
. "$SCRIPT_DIR/collab-paths.sh"
RD="$(collab_runtime_dir "$TEAM_ID")"

if [ ! -d "$RD" ]; then
  echo "FOUT: team-dir bestaat niet: $RD" >&2
  exit 1
fi

if [ ! -d "$RD/prompts" ]; then
  echo "FOUT: prompts/ ontbreekt in team-dir; niets te redden" >&2
  exit 1
fi

# De sessies van dit team staan in het register dat de service wegschrijft
# (services/ensemble-service.ts, vlak voor Phase 2). Hiervoor pakte rescue de
# eerste tmux-sessie met een codex-1 erin, zonder enige vergelijking met het
# gevraagde team-id: de prompts van dit team belandden dan in de panes van een
# willekeurig ander team. En een team zonder codex werd nooit gevonden, terwijl
# dat nou juist het geval is waarvoor rescue bedoeld is.
if [ ! -f "$RD/sessions" ]; then
  echo "FOUT: geen sessieregister voor $TEAM_ID; dit team is niet door deze launcher gestart" >&2
  exit 1
fi

if [ ! -s "$RD/sessions" ]; then
  echo "FOUT: sessieregister voor $TEAM_ID is leeg" >&2
  exit 1
fi

echo "team-id: $TEAM_ID"
echo "sessies: $(tr '\n' ' ' < "$RD/sessions")"
echo

CURRENT_COUNT=$(wc -l < "$RD/messages.jsonl" 2>/dev/null | tr -d ' ' || echo 0)
echo "messages.jsonl current: $CURRENT_COUNT lines"

if [ "$CURRENT_COUNT" -gt 2 ]; then
  echo "Team is al communicatief actief — rescue waarschijnlijk niet nodig. Aborteer."
  exit 0
fi

deliver_to_session() {
  local SESSION="$1"
  local PROMPT_FILE="$2"
  local AGENT_NAME="$3"

  if [ ! -f "$PROMPT_FILE" ]; then
    echo "  $AGENT_NAME: prompt bestand ontbreekt: $PROMPT_FILE" >&2
    return 1
  fi

  if ! tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "  $AGENT_NAME: tmux sessie '$SESSION' bestaat niet" >&2
    return 1
  fi

  local BUFNAME="rescue-${AGENT_NAME}-$$"
  tmux load-buffer -b "$BUFNAME" "$PROMPT_FILE"
  tmux paste-buffer -b "$BUFNAME" -t "$SESSION"
  sleep 1

  # Eerste Enter na paste
  tmux send-keys -t "$SESSION" Enter
  sleep 1

  # Claude toont vaak "[Pasted text" en wil extra Enter om te submitten
  if [[ "$AGENT_NAME" == *claude* ]]; then
    for delay in 1 2 3; do
      sleep "$delay"
      local pane
      pane="$(tmux capture-pane -t "$SESSION" -p | tail -20)"
      if [[ "$pane" == *"[Pasted text"* || "$pane" == *"paste again to expand"* ]]; then
        tmux send-keys -t "$SESSION" Enter
      else
        break
      fi
    done
  fi

  tmux delete-buffer -b "$BUFNAME" 2>/dev/null || true
  echo "  $AGENT_NAME: prompt afgeleverd"
}

echo "=== prompt-injectie ==="
# Sessie naar promptbestand: de sessie heet altijd "<teamnaam>-<agentnaam>", en
# <agentnaam> is precies de bestandsnaam in prompts/ (zonder .txt). Een
# teamnaam kan zelf koppeltekens of cijfers bevatten, dus een generieke regex
# op de sessienaam terugrekenen naar de agentnaam is niet betrouwbaar. De
# bekende agentnamen uit prompts/ vergelijken met het staartje van de
# sessienaam is dat wel: die naam is nooit dubbelzinnig binnen één team, en dit
# levert ook meteen de echte agentnaam op in plaats van alleen het stukje na
# de laatste streep (dat zou de claude-detectie in deliver_to_session hieronder
# stilletjes hebben uitgeschakeld).
while IFS= read -r SESSION; do
  [ -n "$SESSION" ] || continue
  AGENT_NAME=""
  PROMPT_FILE=""
  for candidate in "$RD/prompts/"*.txt; do
    [ -f "$candidate" ] || continue
    NAME="$(basename "$candidate" .txt)"
    case "$SESSION" in
      *"-${NAME}")
        AGENT_NAME="$NAME"
        PROMPT_FILE="$candidate"
        break
        ;;
    esac
  done
  if [ -z "$AGENT_NAME" ]; then
    echo "  $SESSION: geen promptbestand voor deze sessie gevonden, overgeslagen"
    continue
  fi
  deliver_to_session "$SESSION" "$PROMPT_FILE" "$AGENT_NAME"
done < "$RD/sessions"

echo
echo "=== verifieer (wacht 10s) ==="
sleep 10
NEW_COUNT=$(wc -l < "$RD/messages.jsonl" 2>/dev/null | tr -d ' ' || echo 0)
echo "messages.jsonl now: $NEW_COUNT lines (was $CURRENT_COUNT)"

if [ "$NEW_COUNT" -gt "$CURRENT_COUNT" ]; then
  echo "✓ Rescue succesvol — team communiceert nu"
  exit 0
else
  echo "! Nog geen nieuwe berichten — controleer panes handmatig:"
  while IFS= read -r SESSION; do
    [ -n "$SESSION" ] || continue
    echo "    tmux attach -t $SESSION"
  done < "$RD/sessions"
  exit 2
fi
