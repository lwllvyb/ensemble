# Contributing to Ensemble

Thanks for your interest in contributing! Ensemble is an experimental multi-agent collaboration engine, and we welcome contributions of all kinds.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/<your-username>/ensemble.git`
3. Install dependencies: `npm install`
4. Start the dev server: `npm run dev`
5. Run the type checker: `npm run build`

## Development

```bash
npm run dev       # Start server with hot reload (tsx)
npm run build     # Type check (tsc --noEmit)
npx vitest run    # Run the test suite
npm run monitor   # Launch TUI monitor
```

### Enable the git hooks (please do this first)

```bash
git config core.hooksPath .githooks
```

The hooks keep AI session transcripts and personal details out of this public repository.

- `commit-msg` strips `Claude-Session:` trailers, which some AI harnesses append automatically
- `pre-commit` refuses a commit that stages a transcript file, or any file containing a
  `claude.ai/code/session_...` link
- Both hooks optionally check private words in staged files and commit messages. Set
  `ENSEMBLE_PRIVE_WOORDEN` to a file outside the repository, or use the default
  `~/.config/ensemble/prive-woorden.txt`. Put one word or phrase per line. Blank lines and
  lines starting with `#` are ignored. Keep personal names and paths out of commits.

A transcript is a full record of a working session. It can contain paths, hostnames, customer
names, credentials read aloud and half-finished reasoning that nobody reviewed for publication.

This is enforced rather than requested because it is not recoverable. On 2026-08-11 ten commits
carrying session links reached this repo. History was rewritten, and it only half worked: forks
share an object store with the parent, so the old commits stayed reachable through any of the 28
forks. A pushed transcript cannot be taken back.

Use `git commit --no-verify` if you are certain a file is a false positive.

### Editing the Claude Code skill

`skill/SKILL.md` is the source of truth. The installed copy at
`~/.claude/skills/collab/SKILL.md` is generated from it by `scripts/setup-claude-code.sh`, which
substitutes `__ENSEMBLE_DIR__` for your repo path. That substitution is why the installed copy
must never be edited directly, and why the installer has to be re-run after every skill change:

```bash
./scripts/setup-claude-code.sh   # re-install after editing skill/SKILL.md
```

Skip it and your session keeps running the old skill while the repo says otherwise, which is
exactly how the two files drifted apart before.

### Prerequisites

- Node.js 18+
- tmux
- TypeScript 5.5+

## Making Changes

1. Create a branch: `git checkout -b my-change`
2. Make your changes
3. Ensure `npm run build` passes with no errors
4. Commit with a clear message (e.g., `feat: add agent timeout config`)
5. Push and open a Pull Request

## Code Style

- TypeScript with `strict: true`
- Use the existing patterns in `lib/` and `services/`
- Keep agent runtimes behind the `AgentRuntime` interface
- Sanitize all external input (tmux names, file paths, shell args)

## Reporting Issues

Open an issue with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Environment (OS, Node version, tmux version)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
