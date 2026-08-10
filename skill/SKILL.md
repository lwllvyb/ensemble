---
name: collab
description: Start a collaborative AI team (Codex + Claude) to work on a task together. Use when the user says "werk samen met Codex", "collab", "team onderzoek", "laat Codex en Claude samenwerken", or wants multiple AI agents to analyze, research, or solve something together autonomously.
allowed-tools: Bash, Read, Write, Agent, TaskOutput
metadata:
  author: michel
  version: 6.2.0
---

# Collab: Autonomous AI Team Collaboration

**Language rule:** ALWAYS respond in the same language the user used to invoke /collab. If the user writes in English, all your output (status updates, summaries, everything) must be in English. If Dutch, respond in Dutch. Never mix languages.

Launch a Codex + Claude team. Runtime files are namespaced under `/tmp/ensemble/<TEAM_ID>/`.

## Script Paths

Every script lives in `__ENSEMBLE_DIR__/scripts/` and MUST be called with its full path and
`.sh` extension. They are not on `$PATH`, and the permission allowlist installed by
`setup-claude-code.sh` only covers the full paths. Calling a bare `collab-launch` fails.

Set this once per session and reuse it:

```bash
ES="__ENSEMBLE_DIR__/scripts"
```

| Script | Purpose |
|---|---|
| `collab-launch.sh` | Start a team (runs preflight, opens the monitor, arms postcheck) |
| `collab-poll.sh` | Single-shot message poll with seen-state tracking |
| `collab-status.sh` | Dashboard of active and recent collabs |
| `collab-rescue.sh` | Re-inject prompts when `messages.jsonl` stays empty |
| `collab-replay.sh` | Replay a finished session in the terminal |
| `collab-livefeed.sh` | Live colored feed (non-tmux) |
| `collab-cleanup.sh` | Remove old finished runtime dirs (dry-run by default) |
| `collab-preflight.sh` | Auth/DNS/service checks, auto-run by launch |
| `collab-postcheck.sh` | Agent health check ~30s after spawn, auto-armed by launch |

## Path Convention
All collab artifacts live in `/tmp/ensemble/<TEAM_ID>/`:
- `messages.jsonl` — agent + ensemble message log
- `summary.txt` — written on disband by ensemble-service
- `bridge.pid`, `bridge.log` — bridge process
- `poller.pid`, `feed.txt` — background poller
- `postcheck.log`: output of the automatic post-spawn health check
- `prompts/`, `delivery/` — agent prompt/delivery files
- `.finished` — written by ensemble-service AFTER summary.txt
- `team-id` — team ID marker

## Workflow

### Step 0: Detect environment
```bash
if [ -n "$TMUX" ]; then
  echo "TMUX_YES"
elif [ "$(uname)" = "Darwin" ] && [ "${TERM_PROGRAM:-}" = "iTerm.app" ]; then
  echo "ITERM_NATIVE"
else
  echo "TMUX_NO"
fi
```

Three monitor modes:
- `TMUX_YES` — already inside tmux; `collab-launch.sh` opens a split pane right
- `ITERM_NATIVE` — macOS iTerm2 without tmux; `collab-launch.sh` uses `osascript` to open a native iTerm split pane (no `tmux attach` needed)
- `TMUX_NO` — fallback: detached tmux session the user must attach to

Force a specific mode with `COLLAB_MONITOR=tmux|iterm|none` or change iTerm layout with `COLLAB_ITERM_MODE=split|tab|window` (default `split`).

### Step 1: Launch the team
```bash
"$ES/collab-launch.sh" "$(pwd)" "$TASK_DESCRIPTION" [AGENTS] [TEMPLATE]
```

**Agent selection (3rd argument, optional).** Comma-separated keys from `agents.json`;
the first one becomes lead. Default when omitted: `codex` (lead) + `claude code` (worker).
Available keys: `codex`, `claude`, `fable`, `gemini`, `aider`, `opencode`.
Only pass this when the user explicitly names agents in the task ("laat gemini en claude…").

**Template selection (4th argument, optional).** A key from `collab-templates.json` that
gives each agent an explicit role instead of the generic lead/worker prompt. Also settable
via `COLLAB_TEMPLATE`. Pick one when the task clearly matches:

| Template | Roles | Use when the task is |
|---|---|---|
| `review` | REVIEWER + CRITIC | reviewing existing code |
| `implement` | ARCHITECT + DEVELOPER | building a feature |
| `research` | RESEARCHER-A + RESEARCHER-B | comparing options or exploring a topic |
| `debug` | REPRODUCER + ANALYST | chasing a bug |

Leave it empty if the task does not fit cleanly. A wrong template is worse than none.

**Extract TEAM_ID** from the launch output (last line is `TEAM_ID=<id>`):
```bash
TEAM_ID=$(printf '%s\n' "$LAUNCH_OUTPUT" | sed -n 's/^TEAM_ID=//p' | tail -1)
```
Do not read `/tmp/collab-team-id.txt` unless you have no launch output: it is a single
global file that a concurrent collab overwrites.

### Step 1b: Health checks (automatic, do not re-run)

- **Preflight** runs inside `collab-launch.sh` before the team is created. It checks the
  service, agent CLI auth, and DNS. Non-zero exit means launch aborted with the fix command
  printed. Do not paper over it with `COLLAB_SKIP_PREFLIGHT=1` unless the user asks.
  Exit codes: `1` service down, `2` service started in an unauthenticated shell (restart it),
  `3` claude CLI broken, `4` codex CLI broken, `5` DNS/network.
- **Postcheck** is armed automatically and fires ~25s after spawn. If an agent is stuck in an
  error state it kills the team and writes the diagnosis to `/tmp/ensemble/<TEAM_ID>/postcheck.log`.
  If a team dies within the first minute, read that file before guessing.

### Step 2: Tell the user where the monitor is

- `TMUX_YES`: "Team is live in the right tmux pane."
- `ITERM_NATIVE`: "Team is live in the new iTerm pane on the right."
- `TMUX_NO`: "`tmux attach -t ensemble-$TEAM_ID` — live TUI monitor (steer, disband, scroll)"

### Step 3: Monitoring — the user MUST see the conversation

**CRITICAL RULE**: The user wants to SEE the team's conversation as it happens. Every poll result must be presented clearly and formatted as a readable conversation. Do NOT just dump raw output — format it as a proper dialogue.

#### If `TMUX_NO`: poll and PRESENT messages inline

Use `collab-poll.sh` — a single-shot poller that tracks state automatically and gives clean output.

**Poll command:**
```bash
"$ES/collab-poll.sh" "$TEAM_ID" --sleep <seconds>
```

Output format: `sender\tcontent` lines, ending with one of:
- `---STATUS:ACTIVE` — new messages were found
- `---STATUS:QUIET` — no new messages (agents in deep work)
- `---STATUS:DONE` — team finished, followed by summary.txt content
- `---STATUS:WAITING` — messages file not yet created

**Presentation rules — THIS IS THE KEY PART:**
After each poll, present the new messages to the user like this:

> **codex-1**: [message content]
>
> **claude-2**: [message content]

Use markdown bold for agent names. Show the FULL message content (up to 500 chars), not truncated summaries. Between polls, add a brief status line like "Team is working... next check in 15s."

**Polling cadence:**
- First poll: `--sleep 10`
- Normal: `--sleep 15` to `--sleep 20`
- If 3+ polls QUIET: `--sleep 30` (agents in deep work)
- On `---STATUS:DONE`: stop polling, present final summary

**When done**, present structured summary + clean up:
```bash
TEAM_ID="<id>" && RD="/tmp/ensemble/$TEAM_ID" && kill "$(cat "$RD/poller.pid" 2>/dev/null)" 2>/dev/null || true; kill "$(cat "$RD/bridge.pid" 2>/dev/null)" 2>/dev/null || true; tmux kill-session -t "ensemble-$TEAM_ID" 2>/dev/null || true
```

#### If `ITERM_NATIVE`: background summary watcher

Same as `TMUX_YES`: the monitor pane is visible to the user, so don't inline-poll. Wait for completion in the background (same snippet as below) and present the final summary when done. On cleanup, the iTerm pane lives on — the user closes it with `q` or Cmd+W. Do NOT try to `tmux kill-session` (no tmux session exists in this mode).

#### If `TMUX_YES`: background summary watcher

Monitor visible in right pane. Wait in background:
```bash
TEAM_ID="<id>" && RD="/tmp/ensemble/$TEAM_ID" && while [ ! -f "$RD/.finished" ] && [ ! -f "$RD/summary.txt" ]; do sleep 8; done && echo "COLLAB_COMPLETE" && cat "$RD/summary.txt" 2>/dev/null
```
Run with `run_in_background: true`, `timeout: 600000`.

When done: summarize + cleanup poller/bridge PIDs.

## How a team ends

Auto-disband triggers on one of two paths:

1. **Explicit sentinel (preferred).** Two different active agents each send a team-say whose
   entire content is `<<COLLAB_DONE>>`. This bypasses the message-count minimum and the idle
   wait. The agent prompts already instruct this.
2. **Idle + completion signals.** Only after a minimum number of exchanged messages, when the
   transcript has gone quiet and multiple agents signalled completion.

Because path 1 requires an exact-match sentinel, ordinary words like "done" or "klaar" in a
status update no longer kill a team. Do not warn agents to avoid those words.

## Troubleshooting

Work through these in order before reporting a failure to the user.

| Symptom | Action |
|---|---|
| Team died within a minute | `cat /tmp/ensemble/$TEAM_ID/postcheck.log`, it names the broken agent |
| Agents visible but `messages.jsonl` stays empty | `"$ES/collab-rescue.sh" "$TEAM_ID"`, re-injects the prompts the service failed to deliver |
| Launch aborted before creating a team | Preflight printed the fix command; run it, then relaunch |
| Not sure what is still running | `"$ES/collab-status.sh"` |
| `/tmp` filling up with old runs | `"$ES/collab-cleanup.sh"` (dry-run), then `--force` |
| Want to review a finished session | `"$ES/collab-replay.sh" "$TEAM_ID"`, or open the auto-generated HTML replay |

**Escalation.** Two failed rescue or relaunch attempts on the same task is the limit. Stop,
report to the user what was tried, what the logs said (`postcheck.log`, `bridge.log`,
`/tmp/ensemble-server.log`), and ask how to proceed. Never keep relaunching a team that
fails the same way. Each retry spawns real CLI sessions and burns real tokens.

## Important Notes
- Agents run with auto-accept permissions (configured in agents.json: codex `--dangerously-bypass-approvals-and-sandbox`, claude `--permission-mode auto`). They should NEVER ask for file write approval.
- Do not modify project code during a collab session unless the user explicitly asks
- Do not truncate or remove `messages.jsonl`
- Multiple collabs can run simultaneously — each has own `/tmp/ensemble/<TEAM_ID>/` namespace
- `team-say.sh` uses `fcntl.flock` for atomic JSONL writes
- `ensemble-bridge.sh` has single-instance guard, health check, exponential backoff
- `.finished` and `summary.txt` are written by ensemble-service, NOT by scripts
- Bridge auto-stops when it sees `.finished` marker
