#!/usr/bin/env bash
# Shared runtime paths for collab infrastructure.

collab_runtime_dir() {
  local team_id="${1:?team id required}"
  printf '%s/%s\n' "${COLLAB_RUNTIME_ROOT:-/tmp/ensemble}" "$team_id"
}

collab_messages_file() {
  local team_id="${1:?team id required}"
  printf '%s/messages.jsonl\n' "$(collab_runtime_dir "$team_id")"
}

collab_summary_file() {
  local team_id="${1:?team id required}"
  printf '%s/summary.txt\n' "$(collab_runtime_dir "$team_id")"
}

collab_bridge_pid() {
  local team_id="${1:?team id required}"
  printf '%s/bridge.pid\n' "$(collab_runtime_dir "$team_id")"
}

collab_bridge_log() {
  local team_id="${1:?team id required}"
  printf '%s/bridge.log\n' "$(collab_runtime_dir "$team_id")"
}

collab_poller_pid() {
  local team_id="${1:?team id required}"
  printf '%s/poller.pid\n' "$(collab_runtime_dir "$team_id")"
}

collab_feed_file() {
  local team_id="${1:?team id required}"
  printf '%s/feed.txt\n' "$(collab_runtime_dir "$team_id")"
}

collab_prompt_file() {
  local team_id="${1:?team id required}"
  local agent_name="${2:?agent name required}"
  printf '%s/prompts/%s.txt\n' "$(collab_runtime_dir "$team_id")" "$agent_name"
}

collab_delivery_file() {
  local team_id="${1:?team id required}"
  local session_name="${2:?session name required}"
  printf '%s/delivery/%s.txt\n' "$(collab_runtime_dir "$team_id")" "$session_name"
}

collab_bridge_posted_file() {
  local team_id="${1:?team id required}"
  printf '%s/bridge-posted\n' "$(collab_runtime_dir "$team_id")"
}

collab_bridge_result_file() {
  local team_id="${1:?team id required}"
  printf '%s/bridge-result\n' "$(collab_runtime_dir "$team_id")"
}

collab_team_id_file() {
  local team_id="${1:?team id required}"
  printf '%s/team-id\n' "$(collab_runtime_dir "$team_id")"
}

collab_finished_marker() {
  local team_id="${1:?team id required}"
  printf '%s/.finished\n' "$(collab_runtime_dir "$team_id")"
}

# Bewijs dat een team echt leeft: minstens één regel in messages.jsonl.
# Zonder deze functie meldde launch "Team is live!" terwijl hij net zelf had
# vastgesteld dat er nul berichten waren.
team_has_evidence() {
  local rd="$1"
  [ -s "$rd/messages.jsonl" ]
}

# Stop de achtergrondprocessen van een team. Cleanup gooide alleen de map weg,
# waarna de bridge doorliep zonder map: dagenlang, in een lus die nooit
# eindigt (want die lus reageerde tot voor kort ook niet op een gewoon
# SIGTERM). Stuurt eerst TERM, wacht tot 2 seconden, escaleert dan naar KILL
# voor de processen die dat negeren.
#
# Een pid-bestand kan dagen oud zijn en het besturingssysteem hergebruikt
# pids: voor het schieten wordt de commandoregel van het proces gecontroleerd
# op de scriptnaam die bij bridge/poller hoort. Komt die niet overeen, dan is
# de pid vermoedelijk hergebruikt door iets anders; het pid-bestand wordt dan
# opgeruimd zonder dat proces aan te raken.
stop_team_processes() {
  local rd="$1" naam pid wacht verwacht cmd
  for naam in bridge poller; do
    [ -f "$rd/$naam.pid" ] || continue
    pid=$(cat "$rd/$naam.pid" 2>/dev/null)
    case "$pid" in ''|*[!0-9]*) rm -f "$rd/$naam.pid"; continue ;; esac

    case "$naam" in
      bridge) verwacht="ensemble-bridge.sh" ;;
      poller) verwacht="collab-poller.sh" ;;
    esac
    cmd=$(ps -p "$pid" -o command= 2>/dev/null)
    case "$cmd" in
      *"$verwacht"*) ;;
      *) rm -f "$rd/$naam.pid"; continue ;;
    esac

    kill "$pid" 2>/dev/null || true
    wacht=0
    while [ "$wacht" -lt 20 ] && kill -0 "$pid" 2>/dev/null; do
      sleep 0.1
      wacht=$((wacht + 1))
    done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
    rm -f "$rd/$naam.pid"
  done
}
