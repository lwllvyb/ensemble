# ensemble

**Multi-agent collaboration engine** — AI agents that work as one.

Ensemble orchestrates multiple AI agents (Claude Code, Codex, etc.) into collaborative teams that communicate, share findings, and solve problems together in real time. Built on tmux-based session management for transparent, observable agent interactions.

> **Status:** Experimental developer tool. Not a production framework (yet).

## Features

- **Team orchestration** — Spawn multi-agent teams with a single API call
- **Real-time messaging** — Agents communicate via a structured message bus
- **TUI monitor** — Watch agent collaboration live from your terminal
- **Multi-host support** — Run agents across local and remote machines
- **Runtime abstraction** — Pluggable agent runtimes (tmux today, Docker/API later)
- **CLI & HTTP API** — Full control via command line or REST endpoints

## Quick Start

### Prerequisites

- Node.js 18+
- [tmux](https://github.com/tmux/tmux) installed
- At least one AI agent CLI available (e.g., `claude`, `codex`)

### Install & Run

```bash
git clone https://github.com/yourusername/ensemble.git
cd ensemble
npm install
npm run dev
```

The server starts on `http://localhost:23000`.

### CLI Usage

```bash
# Check server status
npx ensemble status

# List active teams
npx ensemble teams

# Watch a team's collaboration live
npx ensemble monitor --latest

# Send a steering message to a team
npx ensemble steer <team-id> "focus on the auth module"
```

### API

```bash
# Health check
curl http://localhost:23000/api/v1/health

# Create a team
curl -X POST http://localhost:23000/api/orchestra/teams \
  -H "Content-Type: application/json" \
  -d '{
    "name": "review-team",
    "description": "Review the authentication module",
    "agents": [
      { "program": "claude" },
      { "program": "codex" }
    ]
  }'

# List teams
curl http://localhost:23000/api/orchestra/teams

# Get team feed
curl http://localhost:23000/api/orchestra/teams/<id>/feed
```

## Architecture

```
ensemble/
├── server.ts              # HTTP server (API entry point)
├── services/
│   └── orchestra-service  # Team lifecycle & message routing
├── lib/
│   ├── agent-runtime      # AgentRuntime interface + TmuxRuntime
│   ├── agent-spawner      # Local (tmux) & remote agent lifecycle
│   ├── orchestra-registry # Team & message persistence (JSONL)
│   └── hosts-config       # Multi-host configuration
├── types/
│   └── orchestra          # TypeScript type definitions
├── cli/
│   ├── ensemble.ts        # CLI entrypoint
│   └── monitor.ts         # TUI monitor (live team view)
└── scripts/
    └── orchestra-bridge   # Shell bridge for agent communication
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `ORCHESTRA_PORT` | `23000` | Server port |
| `ENSEMBLE_URL` | `http://localhost:23000` | CLI target URL |
| `ENSEMBLE_DATA_DIR` | `~/.aimaestro` | Data directory for teams & messages |

## How It Works

1. **Create a team** — Define agents and their task via API or programmatically
2. **Agents spawn** — Each agent gets a tmux session with the task prompt
3. **Communication** — Agents use `team-say` / `team-read` shell commands to exchange messages
4. **Orchestration** — The server routes messages, tracks status, and manages lifecycle
5. **Monitor** — Watch the collaboration unfold in real-time via the TUI monitor
6. **Disband** — Wrap up the team; results are summarized and persisted

## License

[MIT](LICENSE)
