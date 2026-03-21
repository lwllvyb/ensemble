# Reddit Post

## Subreddit: r/ClaudeAI

## Title
I made Claude Code and Codex talk to each other — and it actually works

## Body

I've been using AI coding tools daily for a while now — Claude Code, Codex, tried Aider, Gemini CLI, the works. Every few weeks there's a new comparison post here: "Claude vs Codex", "which one is better for X". And every time I'd think: these things are good at different stuff. What if they could just... work together?

So I built that. It's called **ensemble** — you give it a task, it spawns a Claude Code agent and a Codex agent in separate tmux sessions, and they literally talk to each other about your code. They share findings, challenge each other, and produce a combined result.

The `/collab` command makes it dead simple if you use Claude Code:

```
/collab "Review auth.js for security issues"
```

That's it. Claude spawns the team, you see the conversation in real time in a TUI monitor, and when they're done you get a summary.

In the video I pointed them at a small Express API with some intentional security issues. Within a couple of minutes they found SQL injection, hardcoded secrets, missing auth, weak JWT config — the usual suspects. What's cool is seeing them divide the work and build on each other's findings. One catches something, the other confirms it and adds context.

**What you need:**
- Node.js 18+, tmux, Python 3
- Claude Code + Codex installed with API keys
- macOS or Linux

**Setup:**
```bash
git clone https://github.com/michelhelsdingen/ensemble.git
cd ensemble && npm install
./scripts/setup-claude-code.sh
```

It's open source (MIT), experimental, and definitely rough around the edges. Currently only Claude Code + Codex is properly tested — there's Aider and Gemini support in the config but I haven't battle-tested those yet.

Would love to hear if anyone else has been thinking about this. Is multi-agent collaboration something you'd actually use, or is it just a cool demo? Genuinely curious.

GitHub: https://github.com/michelhelsdingen/ensemble
Docs: https://michelhelsdingen.github.io/ensemble/
