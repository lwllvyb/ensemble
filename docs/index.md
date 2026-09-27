---
title: Home
nav_order: 1
---

# Ensemble

**Multi-agent collaboration engine** — AI agents that work as one.

Ensemble orchestrates AI agents into collaborative teams. Out of the box it pairs **Codex (lead) + Claude Code (worker)**, and they communicate, share findings, and solve problems together in real time. Teams of three (adding Grok) work too.

> **Status:** Experimental developer tool. Not a production framework (yet).
>
> **Default team:** Codex (lead) + Claude Code (worker). You can [add other agents](configuration#supported-agents) like Grok, GLM, Antigravity CLI (`agy`) or any custom CLI tool, and run teams of three.

---

## What does it do?

You give a task. Ensemble spawns a team of AI agents, each in their own tmux session, that **talk to each other** to solve it. You watch the conversation unfold in real time via a TUI monitor or inline feed.

```
You: "Review the auth module for security issues"

  codex-1: I'll audit the config, entitlements, and privacy settings.
  claude-2: Got it. I'll focus on the Swift code, crash risks, dead code, performance.
  grok-3:  Then I'll take the network layer and cross-check what you two find.
  codex-1: Found hardcoded API key in NetworkService.swift line 42...
  claude-2: Confirmed. Also found unvalidated user input in AuthHandler.swift...
```

## Which agents can join

Any CLI-based coding agent can be a team member. These ship in `agents.json`:

| Agent | Status | Notes |
|---|---|---|
| **Codex** | Fully tested, default lead | OpenAI Codex CLI |
| **Claude Code** | Fully tested, default worker | Anthropic Claude Code |
| **Grok** | Tested in three-agent teams | Needs the project-picker hint, see [Configuration](configuration#supported-agents) |
| **GLM** | Tested in four-agent teams | Claude Code pointed at the Z.ai endpoint, so a GLM model joins as a regular agent |
| **Antigravity CLI (`agy`)** | Configured | Uses subscription authentication |
| **Gemini CLI** | Legacy | Configuration retained |
| **opencode** | Untested | Config included, not battle-tested |
| **Any CLI tool** | Custom | [Add your own](configuration#adding-a-custom-agent) |

Pick them per run, or set a line-up once:

```bash
./scripts/collab-launch.sh "$(pwd)" "Security audit" codex,claude,grok
export COLLAB_AGENTS="codex,claude,grok"    # same thing, every run
```

## Use with Claude Code

Ensemble ships with a `/collab` skill for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Just type:

```
/collab "Review the auth module for security issues"
```

Claude spawns a team, shows the agent conversation live, and presents results when they're done. Setup in one command:

```bash
./scripts/setup-claude-code.sh
```

See [Configuration → Claude Code integration](configuration#claude-code-integration) for details.

## Quick links

- [Getting Started](getting-started) — Install & run your first team
- [Configuration](configuration) — Environment variables, agents, hosts, **Claude Code setup**
- [API Reference](api) — HTTP endpoints
- [CLI Reference](cli) — Command line usage
- [Collab Scripts](collab-scripts) — Shell scripts for automation
- [Architecture](architecture) — How it all fits together

---

## Key features

- **Team orchestration** — Spawn multi-agent teams with a single command
- **Real-time messaging** — Agents communicate via a structured message bus
- **TUI monitor** — Watch agent collaboration live from your terminal
- **Extensible** — Add any CLI-based AI agent via `agents.json`
- **Multi-host support** — Run agents across local and remote machines
- **Auto-disband** — Intelligent completion detection ends teams when work is done
- **Telegram notifications** — Get notified when teams finish
