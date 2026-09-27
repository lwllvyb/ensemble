# ensemble

**Multi-agent collaboration engine** — AI agents that work as one.

Ensemble orchestrates AI agents into collaborative teams. Out of the box it pairs **Codex (lead) + Claude Code (worker)**. They communicate, share findings, and solve problems together in real time. Teams of three (adding Grok) work too. The live TUI monitor opens where you are already looking: a **herdr pane** inside a herdr workspace, a **native iTerm split pane** on macOS + iTerm2 (no tmux needed), or a tmux session elsewhere. Agents themselves are orchestrated via the ensemble bridge. The monitor is just a viewer.

> **Status:** Experimental developer tool. macOS and Linux only.

## Features

- **Team orchestration**: spawn multi-agent teams with a single command
- **Real-time messaging**: agents communicate via a structured message bus
- **TUI monitor**: live viewer that opens in a herdr pane, a native iTerm2 split pane on macOS, or tmux elsewhere
- **Auto-disband**: completion detection ends teams when every agent has signalled done
- **Multi-host support**: run agents across local and remote machines
- **CLI & HTTP API**: full control via command line or REST endpoints

**[Full documentation →](https://michelhelsdingen.github.io/ensemble/)**

## Quick Start

### Prerequisites

- Node.js 18+, Python 3.6+, curl
- [tmux](https://github.com/tmux/tmux) — required on Linux; optional on macOS (only used as a fallback if iTerm2 is not available)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and [Codex](https://github.com/openai/codex) CLIs installed

### Install & Run

```bash
git clone https://github.com/michelhelsdingen/ensemble.git
cd ensemble
npm install

# Start the server (keep this running)
npm run dev
# ...or on macOS, once, to keep it running across reboots:
./scripts/install-launchd.sh
```

### Verify (in a second terminal)

```bash
curl http://localhost:23000/api/v1/health
# → {"status":"healthy","version":"1.0.0"}
```

### Create your first team

```bash
# Via CLI
npx ensemble status

# Via API — create a team of two agents
curl -X POST http://localhost:23000/api/ensemble/teams \
  -H "Content-Type: application/json" \
  -d '{
    "name": "review-team",
    "description": "Review the authentication module",
    "agents": [
      { "program": "claude", "role": "lead" },
      { "program": "codex", "role": "worker" }
    ],
    "workingDirectory": "'$(pwd)'"
  }'

# Watch the collaboration live
npx ensemble monitor --latest

# Steer the team
npx ensemble steer <team-id> "focus on the auth module"
```

Or use the all-in-one collab script:

```bash
./scripts/collab-launch.sh "$(pwd)" "Review the authentication module"
```

## Claude Code: `/collab` command

Ensemble ships with a skill for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Once installed, just type:

```
/collab "Review the auth module for security issues"
```

Claude spawns a Codex + Claude team, shows their conversation live in your terminal, and presents a summary when done. One-command setup:

```bash
./scripts/setup-claude-code.sh
```

This installs the skill, configures permissions, and verifies prerequisites. See the [full setup guide](https://michelhelsdingen.github.io/ensemble/configuration#claude-code-integration) for details.

## Supported Agents

The default team is **Codex (lead) + Claude Code (worker)**. This is the tested, production-ready combination.

| Agent | Status | How to use |
|---|---|---|
| **Codex + Claude Code** | Fully tested | Default, just run `/collab` or `collab-launch.sh` |
| **Grok CLI** | Tested in three-agent teams | Add explicitly (see below) |
| **GLM** | Tested in four-agent teams | Add explicitly (see below) |
| **Antigravity CLI (`agy`)** | Configured | Add explicitly (see below) |
| **Gemini CLI** | Legacy | Configuration retained |
| **opencode** | Untested | Add explicitly (see below) |
| **Any CLI tool** | Via `agents.json` | [Add a custom agent](https://michelhelsdingen.github.io/ensemble/configuration#adding-a-custom-agent) |

### Using a different team composition

Four ways to change which agents are on your team:

**1. Name them in your `/collab` prompt:**
```
/collab "Review the auth module with agy and claude"
```

**2. Pass them as the third argument to `collab-launch.sh`:**
```bash
# Comma-separated. First agent = lead, rest = workers.
./scripts/collab-launch.sh "$(pwd)" "Security audit" codex,claude,grok
```

**3. Set `COLLAB_AGENTS` once in your shell**, for a line-up you do not want to retype:
```bash
export COLLAB_AGENTS="codex,claude,grok"
./scripts/collab-launch.sh "$(pwd)" "Security audit"   # runs all three
```

Precedence is: third argument > `COLLAB_AGENTS` > the default pair. Naming your agents as an
argument turns off the auto-fallback: a dead agent then fails preflight loudly (exit 7 with the
healthy alternatives) instead of being swapped for a working one. `COLLAB_AGENTS` is a standing
preference, so it keeps the auto-fallback; every swap is printed as a warning
(`Auto-fallback: codex -> glm`), so you still hear that an agent was unavailable.

**4. Specify agents in the API call:**
```bash
curl -X POST http://localhost:23000/api/ensemble/teams \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-team",
    "description": "Security audit",
    "agents": [
      { "program": "codex", "role": "lead" },
      { "program": "claude", "role": "worker" },
      { "program": "agy", "role": "worker" }
    ],
    "workingDirectory": "'$(pwd)'"
  }'
```

> **Antigravity CLI (`agy`):** Starts with `--dangerously-skip-permissions` and receives prompts through `sendKeys`. Ensemble unsets `GEMINI_API_KEY` and `GOOGLE_API_KEY` after all environment exports so agy uses subscription authentication rather than paid API tokens. In an untrusted directory, the existing startup gate confirms the preselected "Yes, I trust this folder" option. Gemini CLI configuration remains available for existing setups.

## How It Works

1. **Create a team**: define agents and their task via API or CLI
2. **Agents spawn**: each agent is started by the ensemble bridge with the task prompt
3. **Communication**: agents use `team-say`/`team-read` scripts to exchange messages
4. **Monitor**: watch the collaboration unfold in real time via the TUI monitor (herdr pane, iTerm split pane on macOS, or tmux)
5. **Auto-disband**: when every agent signals completion, results are summarized and persisted

### Monitor selection

`collab-launch` picks the best viewer automatically:

| Situation | Monitor |
|---|---|
| Inside a [herdr](https://github.com/herdrdev/herdr) workspace | **herdr pane** (checked first) |
| Already inside tmux | tmux split pane (right) |
| macOS + iTerm2, no tmux | **native iTerm2 split pane** |
| Linux, or no iTerm2 | detached tmux session (`tmux attach -t ensemble-<id>`) |

herdr is checked before iTerm2 on purpose: herdr draws its own panes inside a host iTerm
session but passes `TERM_PROGRAM=iTerm.app` through unchanged. Trusting that would open a real
iTerm split *outside* the layout you are looking at, so the monitor would never be seen.
`HERDR_ENV=1` is the reliable signal. The pane is labelled after your project directory and
closes itself when the team disbands.

Override with env vars:

- `COLLAB_MONITOR=herdr\|tmux\|iterm\|none`: force a specific mode (or disable the monitor)
- `COLLAB_ITERM_MODE=split\|tab\|window`: iTerm layout (default `split`)
- `COLLAB_HERDR_MODE=split\|tab`: herdr layout (default `split`)

On macOS, you never need `tmux attach` for the monitor.

## Configuration

All team settings are optional. The service and preflight share
`~/.config/ensemble/config.json`; set `ENSEMBLE_CONFIG` to use another file.
Environment variables override file values. Missing or invalid settings use defaults.

| JSON key | Environment override | Default |
|---|---|---|
| `alertHubUrl` | `ENSEMBLE_ALERT_HUB_URL` | Empty (hub alerts disabled) |
| `healthCommand` | `ENSEMBLE_HEALTH_CMD` | No hook |
| `fallbackOrder` | `ENSEMBLE_FALLBACK_ORDER` (comma-separated) | `["codex","claude","glm","grok","agy","gemini"]` |
| `maxTeamMinutes` | `ENSEMBLE_MAX_TEAM_MINUTES` | No time limit |
| `graceMinutes` | `ENSEMBLE_GRACE_MINUTES` | `3` |
| `agentEnv` | None | No additional variables |
| `taskPreamble` | `ENSEMBLE_TASK_PREAMBLE` | No preamble |

`agentEnv` adds environment variables to each locally spawned agent, including
when the tmux server is already running. For example,
`{"agentEnv":{"MY_TOOL_NESTED":"1"}}` tells a tool it is running inside a team.
Configured values override forwarded process variables. Names must match
`^[A-Z_][A-Z0-9_]*$`; values must be strings without carriage returns or newlines.
Invalid entries are ignored with one warning listing names only.

Set `alertHubUrl` and `ALERT_HUB_SECRET` to enable summary notifications through
an alert hub. An explicitly empty `ENSEMBLE_ALERT_HUB_URL` disables the hub, even
when a URL exists in the file. Without a hub, direct Telegram notifications remain
opt-in through `ENSEMBLE_TELEGRAM_BOT_TOKEN` and `ENSEMBLE_TELEGRAM_CHAT_ID`.

`healthCommand` is a trusted shell command. Preflight appends requested agent keys
and fallback candidates as separate arguments. It must return a JSON object on stdout:

```json
{"codex":{"status":"ok","detail":"Ready"},"claude":{"status":"limit","detail":"Quota exhausted"}}
```

Each status is `ok`, `down`, `limit`, `slow`, or `unknown`; `detail` is optional text.
Missing agents count as `unknown`. A command failure, invalid JSON, or a 60-second
timeout warns and continues with the existing checks. Explicitly selected `down` or
`limit` agents abort with exit code `7`, listing healthy alternatives. For the default
pair and agents selected through `COLLAB_AGENTS`, preflight replaces unavailable agents in `fallbackOrder`, without duplicates;
no healthy replacement also exits `7`. `slow` and `unknown` only warn.

`maxTeamMinutes` must be positive. At the limit the service asks all agents for a
final conclusion and the exact `<<COLLAB_DONE>>` sentinel within two minutes.
It stops the team after `graceMinutes` (nonnegative, measured from the warning),
preserving the summary and time-limit reason. `taskPreamble` is inserted before
each team's task in agent startup prompts, including solo and staged teams.

Copy `.env.example` to `.env` and adjust as needed. Key server variables:

| Variable | Default | Description |
|---|---|---|
| `ENSEMBLE_PORT` | `23000` | Server port |
| `ENSEMBLE_URL` | `http://localhost:23000` | CLI target URL |
| `ENSEMBLE_DATA_DIR` | `~/.ensemble` | Data directory |
| `ENSEMBLE_CORS_ORIGIN` | localhost only | Allowed CORS origins |

See [full configuration docs](https://michelhelsdingen.github.io/ensemble/configuration) for all options including Telegram notifications, multi-host setup, and agent customization.

## Documentation

- [Getting Started](https://michelhelsdingen.github.io/ensemble/getting-started) — Prerequisites, install, first team
- [Configuration](https://michelhelsdingen.github.io/ensemble/configuration) — Environment variables, agents, hosts
- [API Reference](https://michelhelsdingen.github.io/ensemble/api) — All HTTP endpoints
- [CLI Reference](https://michelhelsdingen.github.io/ensemble/cli) — Commands and monitor keybindings
- [Collab Scripts](https://michelhelsdingen.github.io/ensemble/collab-scripts) — Shell scripts for automation
- [Architecture](https://michelhelsdingen.github.io/ensemble/architecture) — How it all fits together

## License

[MIT](LICENSE)
